import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveDocumentImportCompatibility,
  stripImportFileExtension,
} from "@/lib/documents/importCompatibility";
import { FileUploadFormSchema } from "@/lib/validation/attachment";
import { extractPdfMetadata } from "@/lib/pdf/metadata";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function ensureDocumentBucket() {
  const admin = createAdminClient();
  const bucketId = "document-files";
  const bucketConfig = {
    public: false,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: null as string[] | null,
  };

  const { data: existingBucket, error: getBucketError } =
    await admin.storage.getBucket(bucketId);
  if (!getBucketError && existingBucket) {
    const needsUpdate =
      existingBucket.public !== bucketConfig.public ||
      existingBucket.file_size_limit !== bucketConfig.fileSizeLimit ||
      Array.isArray(existingBucket.allowed_mime_types);

    if (needsUpdate) {
      const { error: updateBucketError } = await admin.storage.updateBucket(
        bucketId,
        bucketConfig,
      );

      if (updateBucketError) {
        throw updateBucketError;
      }
    }

    return;
  }

  const { error: createBucketError } = await admin.storage.createBucket(
    bucketId,
    bucketConfig,
  );

  if (
    createBucketError &&
    !createBucketError.message.toLowerCase().includes("already exists")
  ) {
    throw createBucketError;
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
  const streamIdRaw = formData.get("streamId");
  const titleRaw = formData.get("title");
  const fileHashRaw = formData.get("fileHash");

  if (!(file instanceof File) || typeof streamIdRaw !== "string") {
    return NextResponse.json(
      { error: "File and streamId are required" },
      { status: 400 },
    );
  }

  if (!file.name) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "File exceeds 50MB limit" },
      { status: 400 },
    );
  }

  const parsed = FileUploadFormSchema.safeParse({
    streamId: streamIdRaw,
    title: typeof titleRaw === "string" ? titleRaw : undefined,
    fileHash: typeof fileHashRaw === "string" ? fileHashRaw : undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: streamAccess, error: streamError } = await supabase
    .from("streams")
    .select("id")
    .eq("id", parsed.data.streamId)
    .single();

  if (streamError || !streamAccess) {
    return NextResponse.json(
      { error: "You do not have access to this stream" },
      { status: 403 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      { error: "Failed to read uploaded file" },
      { status: 400 },
    );
  }

  const compatibility = resolveDocumentImportCompatibility({
    fileName: file.name,
    contentType: file.type,
  });
  const contentType = compatibility.contentType;
  const isPdf =
    contentType === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  let pdfMetadata = null;
  try {
    if (isPdf) {
      pdfMetadata = await extractPdfMetadata(new Uint8Array(buffer));
    }
  } catch {
    console.warn("Failed to parse PDF metadata, proceeding anyway");
  }

  const safeFileName = sanitizeFilename(file.name || "attachment");
  const documentId = crypto.randomUUID();
  const storagePath = `${parsed.data.streamId}/${documentId}/${safeFileName}`;
  const fallbackTitle = stripImportFileExtension(file.name || safeFileName);
  const title =
    parsed.data.title?.trim() || pdfMetadata?.title || fallbackTitle;

  try {
    await ensureDocumentBucket();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to prepare storage bucket";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { error: uploadError } = await admin.storage
    .from("document-files")
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const sourceMetadata =
    isPdf && pdfMetadata
      ? {
          uploadOrigin: "entry-creator",
          extractedTitle: pdfMetadata.title,
          extractedAuthor: pdfMetadata.author,
          extractedCreationDate: pdfMetadata.creationDate,
          pageCount: pdfMetadata.pageCount,
          fileHash: parsed.data.fileHash,
        }
      : {
          uploadOrigin: "entry-creator",
          fileHash: parsed.data.fileHash,
        };

  const { data: inserted, error: insertError } = await admin
    .from("documents")
    .insert({
      id: documentId,
      stream_id: parsed.data.streamId,
      created_by: authData.user.id,
      title,
      original_filename: file.name,
      content_type: contentType,
      file_size_bytes: file.size,
      storage_bucket: "document-files",
      storage_path: storagePath,
      import_status: "completed",
      thumbnail_status: "pending",
      source_metadata: sourceMetadata,
      extraction_metadata: {
        ...sourceMetadata,
        extractionKind: "none",
      },
      extracted_markdown: null,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    await admin.storage.from("document-files").remove([storagePath]);
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create file document row" },
      { status: 500 },
    );
  }

  const signed = await admin.storage
    .from("document-files")
    .createSignedUrl(storagePath, 60 * 30);

  if (signed.error) {
    console.warn(
      `Failed to create signed URL for ${storagePath}:`,
      signed.error,
    );
  }

  return NextResponse.json({
    document: inserted,
    metadata: pdfMetadata,
    previewUrl: signed.data?.signedUrl ?? null,
  });
}
