import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PdfUploadFormSchema } from "@/lib/validation/pdf";
import { extractPdfMetadata } from "@/lib/pdf/metadata";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

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
      fileSizeLimit: MAX_PDF_BYTES,
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

  if (!(file instanceof File) || typeof streamIdRaw !== "string") {
    return NextResponse.json(
      { error: "File and streamId are required" },
      { status: 400 },
    );
  }

  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return NextResponse.json(
      { error: "Only PDF files are supported" },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "PDF file is empty" }, { status: 400 });
  }

  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: "PDF exceeds 50MB limit" },
      { status: 400 },
    );
  }

  const parsed = PdfUploadFormSchema.safeParse({
    streamId: streamIdRaw,
    title: typeof titleRaw === "string" ? titleRaw : undefined,
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

  let pdfMetadata;
  try {
    pdfMetadata = await extractPdfMetadata(new Uint8Array(buffer));
  } catch {
    return NextResponse.json(
      { error: "Failed to parse PDF metadata" },
      { status: 400 },
    );
  }

  const safeFileName = sanitizeFilename(file.name || "attachment.pdf");
  const documentId = crypto.randomUUID();
  const storagePath = `${parsed.data.streamId}/${documentId}/${safeFileName}`;
  const fallbackTitle = safeFileName.replace(/\.pdf$/i, "");
  const title = parsed.data.title?.trim() || pdfMetadata.title || fallbackTitle;

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
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const sourceMetadata = {
    uploadOrigin: "entry-creator",
    extractedTitle: pdfMetadata.title,
    extractedAuthor: pdfMetadata.author,
    extractedCreationDate: pdfMetadata.creationDate,
    pageCount: pdfMetadata.pageCount,
  };

  const { data: inserted, error: insertError } = await admin
    .from("documents")
    .insert({
      id: documentId,
      stream_id: parsed.data.streamId,
      created_by: authData.user.id,
      title,
      original_filename: file.name,
      content_type: "application/pdf",
      file_size_bytes: file.size,
      storage_bucket: "document-files",
      storage_path: storagePath,
      import_status: "completed",
      source_metadata: sourceMetadata,
      extraction_metadata: {
        ...sourceMetadata,
        extractionKind: "metadata-only",
      },
      extracted_markdown: null,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    await admin.storage.from("document-files").remove([storagePath]);
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create PDF document row" },
      { status: 500 },
    );
  }

  const signed = await admin.storage
    .from("document-files")
    .createSignedUrl(storagePath, 60 * 30);

  return NextResponse.json({
    document: inserted,
    metadata: pdfMetadata,
    previewUrl: signed.data?.signedUrl ?? null,
  });
}
