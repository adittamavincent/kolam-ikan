import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureDocumentSchema,
  isMissingDocumentSchemaError,
} from "@/lib/documents/bootstrap";
import { Document, DocumentImportJob } from "@/lib/types";
import { CreateDocumentImportSchema } from "@/lib/validation/document";

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function ensureDocumentBucket() {
  const admin = createAdminClient();
  const bucketId = "document-files";

  const { data: existingBucket, error: getBucketError } =
    await admin.storage.getBucket(bucketId);
  if (!getBucketError && existingBucket) {
    return;
  }

  const { error: createBucketError } = await admin.storage.createBucket(
    bucketId,
    {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: ["application/pdf"],
    },
  );

  if (
    createBucketError &&
    !createBucketError.message.toLowerCase().includes("already exists")
  ) {
    throw createBucketError;
  }
}

function getAppUrl(request: Request) {
  return (
    process.env.DOCUMENT_IMPORT_APP_URL?.replace(/\/$/, "") ??
    new URL(request.url).origin
  );
}

async function dispatchImportJob(
  request: Request,
  params: {
    jobId: string;
    documentId: string;
    streamId: string;
    title: string;
    fileName: string;
    contentType: string;
    fileSizeBytes: number;
    storagePath: string;
    parserConfig: {
      flavor: "lattice" | "stream";
      enableTableStructure: boolean;
      debugDoclingTables: boolean;
    };
  },
) {
  const admin = createAdminClient();
  const serviceUrl = process.env.DOCUMENT_IMPORT_SERVICE_URL?.replace(
    /\/$/,
    "",
  );
  const callbackToken = process.env.DOCUMENT_IMPORT_CALLBACK_SECRET;

  if (!serviceUrl) {
    throw new Error("DOCUMENT_IMPORT_SERVICE_URL is not configured");
  }

  if (!callbackToken) {
    throw new Error("DOCUMENT_IMPORT_CALLBACK_SECRET is not configured");
  }

  const signedUrlResult = await admin.storage
    .from("document-files")
    .createSignedUrl(params.storagePath, 60 * 60);
  if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
    throw new Error(
      signedUrlResult.error?.message ??
        "Failed to create signed URL for document import",
    );
  }

  const appUrl = getAppUrl(request);
  const response = await fetch(`${serviceUrl}/imports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId: params.jobId,
      documentId: params.documentId,
      streamId: params.streamId,
      title: params.title,
      fileName: params.fileName,
      contentType: params.contentType,
      fileSizeBytes: params.fileSizeBytes,
      parserConfig: params.parserConfig,
      fileUrl: signedUrlResult.data.signedUrl,
      callbackUrl: `${appUrl}/api/documents/imports/callback`,
      callbackToken,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(
      payload?.error ??
        payload?.message ??
        "Document import worker rejected the job",
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const streamId = formData.get("streamId");
  const title = formData.get("title");
  const flavor = formData.get("flavor");
  const enableTableStructure = formData.get("enableTableStructure");
  const debugDoclingTables = formData.get("debugDoclingTables");

  if (!(file instanceof File) || typeof streamId !== "string") {
    return NextResponse.json(
      { error: "File and streamId are required" },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "PDF file is empty" }, { status: 400 });
  }

  const input = CreateDocumentImportSchema.safeParse({
    streamId,
    title: typeof title === "string" ? title : undefined,
    flavor: typeof flavor === "string" ? flavor : "lattice",
    enableTableStructure: enableTableStructure === "true",
    debugDoclingTables: debugDoclingTables === "true",
  });

  if (!input.success) {
    return NextResponse.json(
      { error: "Invalid import parameters", details: input.error.flatten() },
      { status: 400 },
    );
  }

  const { data: streamAccess, error: streamAccessError } = await supabase
    .from("streams")
    .select("id")
    .eq("id", input.data.streamId)
    .single();

  if (streamAccessError || !streamAccess) {
    return NextResponse.json(
      { error: "You do not have access to this stream" },
      { status: 403 },
    );
  }

  const filename = sanitizeFilename(file.name || "document.pdf");
  const documentId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const storagePath = `${input.data.streamId}/${documentId}/${filename}`;
  const titleValue =
    input.data.title?.trim() || filename.replace(/\.pdf$/i, "");

  try {
    await ensureDocumentBucket();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to prepare document storage bucket";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from("document-files")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const sourceMetadata = {
    uploadOrigin: "kolam-ikan-app",
    workerStatus: "awaiting-pickup",
  };
  const parserConfig = {
    flavor: input.data.flavor,
    enableTableStructure: input.data.enableTableStructure,
    debugDoclingTables: input.data.debugDoclingTables,
  };
  let activeDocument: Document | null = null;
  let activeJob: DocumentImportJob | null = null;

  const { data: document, error: documentError } = await admin
    .from("documents")
    .insert({
      id: documentId,
      stream_id: input.data.streamId,
      created_by: authData.user.id,
      title: titleValue,
      original_filename: file.name,
      content_type: file.type || "application/pdf",
      file_size_bytes: file.size,
      storage_bucket: "document-files",
      storage_path: storagePath,
      import_status: "queued",
      source_metadata: sourceMetadata,
    })
    .select("*")
    .single();

  if (documentError && isMissingDocumentSchemaError(documentError.message)) {
    try {
      await ensureDocumentSchema();
    } catch (error) {
      await admin.storage.from("document-files").remove([storagePath]);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to bootstrap document schema";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const retriedDocumentInsert = await admin
      .from("documents")
      .insert({
        id: documentId,
        stream_id: input.data.streamId,
        created_by: authData.user.id,
        title: titleValue,
        original_filename: file.name,
        content_type: file.type || "application/pdf",
        file_size_bytes: file.size,
        storage_bucket: "document-files",
        storage_path: storagePath,
        import_status: "queued",
        source_metadata: sourceMetadata,
      })
      .select("*")
      .single();

    if (retriedDocumentInsert.error || !retriedDocumentInsert.data) {
      await admin.storage.from("document-files").remove([storagePath]);
      return NextResponse.json(
        {
          error:
            retriedDocumentInsert.error?.message ??
            "Failed to create document row",
        },
        { status: 500 },
      );
    }

    const retriedJobInsert = await admin
      .from("document_import_jobs")
      .insert({
        id: jobId,
        document_id: documentId,
        stream_id: input.data.streamId,
        created_by: authData.user.id,
        provider: "docling",
        status: "queued",
        parser_config: parserConfig,
      })
      .select("*")
      .single();

    if (retriedJobInsert.error || !retriedJobInsert.data) {
      await admin.from("documents").delete().eq("id", documentId);
      await admin.storage.from("document-files").remove([storagePath]);
      return NextResponse.json(
        {
          error:
            retriedJobInsert.error?.message ??
            "Failed to create import job row",
        },
        { status: 500 },
      );
    }

    activeDocument = retriedDocumentInsert.data;
    activeJob = retriedJobInsert.data;
  }

  if (!activeDocument && (documentError || !document)) {
    await admin.storage.from("document-files").remove([storagePath]);
    return NextResponse.json(
      { error: documentError?.message ?? "Failed to create document row" },
      { status: 500 },
    );
  }

  if (!activeDocument) {
    activeDocument = document;
  }

  if (!activeJob) {
    const { data: job, error: jobError } = await admin
      .from("document_import_jobs")
      .insert({
        id: jobId,
        document_id: documentId,
        stream_id: input.data.streamId,
        created_by: authData.user.id,
        provider: "docling",
        status: "queued",
        parser_config: parserConfig,
      })
      .select("*")
      .single();

    if (jobError || !job) {
      await admin.from("documents").delete().eq("id", documentId);
      await admin.storage.from("document-files").remove([storagePath]);
      return NextResponse.json(
        { error: jobError?.message ?? "Failed to create import job row" },
        { status: 500 },
      );
    }

    activeJob = job;
  }

  try {
    await dispatchImportJob(request, {
      jobId,
      documentId,
      streamId: input.data.streamId,
      title: titleValue,
      fileName: file.name,
      contentType: file.type || "application/pdf",
      fileSizeBytes: file.size,
      storagePath,
      parserConfig,
    });

    await admin
      .from("document_import_jobs")
      .update({
        status: "processing",
        progress_percent: 5,
        progress_message: "Worker accepted import and started processing",
        eta_seconds: Math.max(15, Math.ceil(file.size / (512 * 1024)) * 10),
        started_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await admin
      .from("documents")
      .update({
        import_status: "processing",
        source_metadata: {
          ...sourceMetadata,
          workerStatus: "processing",
        },
      })
      .eq("id", documentId);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to dispatch document import to worker";

    await admin
      .from("document_import_jobs")
      .update({
        status: "failed",
        progress_percent: 0,
        progress_message: "Worker dispatch failed",
        eta_seconds: null,
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await admin
      .from("documents")
      .update({
        import_status: "failed",
        source_metadata: {
          ...sourceMetadata,
          workerStatus: "dispatch_failed",
        },
      })
      .eq("id", documentId);

    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: refreshedJob } = await admin
    .from("document_import_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  const { data: refreshedDocument } = await admin
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();

  return NextResponse.json(
    {
      document: refreshedDocument ?? activeDocument,
      job: refreshedJob ?? activeJob,
    },
    { status: 201 },
  );
}
