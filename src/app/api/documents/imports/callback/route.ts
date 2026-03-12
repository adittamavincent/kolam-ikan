import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureDocumentSchema,
  isMissingDocumentSchemaError,
} from "@/lib/documents/bootstrap";
import { DocumentImportCallbackSchema } from "@/lib/validation/document";

function isAuthorized(request: Request) {
  const expected = process.env.DOCUMENT_IMPORT_CALLBACK_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = DocumentImportCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid callback payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const payload = parsed.data;

  const { data: document, error: documentFetchError } = await admin
    .from("documents")
    .select("id, stream_id")
    .eq("id", payload.documentId)
    .single();

  if (documentFetchError || !document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { data: currentJob, error: currentJobError } = await admin
    .from("document_import_jobs")
    .select("status")
    .eq("id", payload.jobId)
    .eq("document_id", payload.documentId)
    .single();

  if (currentJobError || !currentJob) {
    return NextResponse.json(
      { error: "Import job not found" },
      { status: 404 },
    );
  }

  if (currentJob.status === "canceled" && payload.status !== "canceled") {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "job already canceled",
    });
  }

  const now = new Date().toISOString();
  const jobPatch = {
    status: payload.status,
    progress_percent:
      payload.progressPercent ??
      (payload.status === "completed" ? 100 : undefined),
    progress_message: payload.progressMessage ?? null,
    eta_seconds: payload.etaSeconds ?? null,
    warning_messages: payload.warningMessages ?? [],
    error_message: payload.errorMessage ?? null,
    started_at: payload.status === "processing" ? now : undefined,
    completed_at:
      payload.status === "completed" ||
      payload.status === "failed" ||
      payload.status === "canceled"
        ? now
        : null,
  };

  let { error: jobError } = await admin
    .from("document_import_jobs")
    .update(jobPatch)
    .eq("id", payload.jobId)
    .eq("document_id", payload.documentId);

  if (jobError && isMissingDocumentSchemaError(jobError.message)) {
    await ensureDocumentSchema();

    const retryResult = await admin
      .from("document_import_jobs")
      .update(jobPatch)
      .eq("id", payload.jobId)
      .eq("document_id", payload.documentId);

    jobError = retryResult.error;
  }

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  const documentPatch = {
    import_status: payload.status,
    extracted_markdown: payload.extractedMarkdown,
    extraction_metadata: payload.extractionMetadata ?? {},
  };

  const { error: documentError } = await admin
    .from("documents")
    .update(documentPatch)
    .eq("id", payload.documentId);

  if (documentError) {
    return NextResponse.json({ error: documentError.message }, { status: 500 });
  }

  if (payload.status === "completed" && payload.chunks) {
    const { error: deleteError } = await admin
      .from("document_chunks")
      .delete()
      .eq("document_id", payload.documentId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (payload.chunks.length > 0) {
      const { error: insertError } = await admin.from("document_chunks").insert(
        payload.chunks.map((chunk) => ({
          document_id: payload.documentId,
          stream_id: document.stream_id,
          chunk_index: chunk.chunkIndex,
          chunk_markdown: chunk.chunkMarkdown,
          token_count: chunk.tokenCount ?? null,
          page_start: chunk.pageStart ?? null,
          page_end: chunk.pageEnd ?? null,
          heading_path: chunk.headingPath ?? [],
          chunk_metadata: chunk.metadata ?? {},
        })),
      );

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}
