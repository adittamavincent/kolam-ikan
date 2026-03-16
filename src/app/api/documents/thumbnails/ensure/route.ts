import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/tiff",
]);

function isSupportedThumbnailType(contentType: string, fileName: string) {
  const lowered = fileName.toLowerCase();
  if (contentType === "application/pdf" || lowered.endsWith(".pdf")) return true;
  if (contentType.startsWith("image/")) return true;
  if (SUPPORTED_IMAGE_TYPES.has(contentType)) return true;
  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".avif",
    ".tiff",
  ].some((ext) => lowered.endsWith(ext));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.documentId || typeof body.documentId !== "string") {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }
  const force = Boolean(body.force);

  const { data: document, error } = await supabase
    .from("documents")
    .select(
      "id, content_type, original_filename, storage_bucket, storage_path, thumbnail_path, thumbnail_status, import_status",
    )
    .eq("id", body.documentId)
    .single();

  if (error || !document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (document.thumbnail_path) {
    return NextResponse.json({ status: "ready", thumbnailPath: document.thumbnail_path });
  }

  if (!isSupportedThumbnailType(document.content_type, document.original_filename)) {
    await admin
      .from("documents")
      .update({
        thumbnail_status: "unsupported",
        thumbnail_error: null,
        thumbnail_updated_at: new Date().toISOString(),
      })
      .eq("id", document.id);

    return NextResponse.json({ status: "unsupported" });
  }

  if (document.thumbnail_status === "processing") {
    return NextResponse.json({ status: "processing" });
  }
  if (document.thumbnail_status === "failed" && !force) {
    return NextResponse.json({ status: "failed" });
  }

  const serviceUrl = process.env.DOCUMENT_IMPORT_SERVICE_URL?.replace(/\/$/, "");
  if (!serviceUrl) {
    await admin
      .from("documents")
      .update({
        thumbnail_status: "failed",
        thumbnail_error: "DOCUMENT_IMPORT_SERVICE_URL is not configured",
        thumbnail_updated_at: new Date().toISOString(),
      })
      .eq("id", document.id);

    return NextResponse.json({ status: "failed", error: "Missing worker URL" }, { status: 500 });
  }

  const signed = await admin.storage
    .from(document.storage_bucket ?? "document-files")
    .createSignedUrl(document.storage_path, 60 * 60);

  if (signed.error || !signed.data?.signedUrl) {
    const message = signed.error?.message ?? "Failed to create signed URL";
    const lowered = message.toLowerCase();
    if (lowered.includes("not found") || lowered.includes("object")) {
      await admin
        .from("documents")
        .update({
          thumbnail_status: "pending",
          thumbnail_error: null,
          thumbnail_updated_at: new Date().toISOString(),
        })
        .eq("id", document.id);

      return NextResponse.json({ status: "pending" });
    }
    await admin
      .from("documents")
      .update({
        thumbnail_status: "failed",
        thumbnail_error: message,
        thumbnail_updated_at: new Date().toISOString(),
      })
      .eq("id", document.id);

    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }

  await admin
    .from("documents")
    .update({
      thumbnail_status: "processing",
      thumbnail_error: null,
      thumbnail_updated_at: new Date().toISOString(),
    })
    .eq("id", document.id);

  const workerResp = await fetch(`${serviceUrl}/thumbnails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      fileName: document.original_filename,
      contentType: document.content_type,
      fileUrl: signed.data.signedUrl,
    }),
  }).catch((err) => ({ ok: false, error: err } as const));

  if (!workerResp || !("ok" in workerResp) || !workerResp.ok) {
    const message =
      (workerResp as { error?: Error | null })?.error?.message ??
      "Worker thumbnail generation failed";

    await admin
      .from("documents")
      .update({
        thumbnail_status: "failed",
        thumbnail_error: message,
        thumbnail_updated_at: new Date().toISOString(),
      })
      .eq("id", document.id);

    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }

  const payload = (await workerResp.json().catch(() => null)) as {
    status?: string;
    thumbnailPath?: string;
    error?: string;
  } | null;

  return NextResponse.json({
    status: payload?.status ?? "processing",
    thumbnailPath: payload?.thumbnailPath ?? null,
    error: payload?.error ?? null,
  });
}
