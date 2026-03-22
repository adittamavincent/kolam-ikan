import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type DeletePayload = {
  documentId?: string;
};

const DOCUMENT_IN_USE_ERROR = "Cannot delete a document while it is still attached to one or more sections";

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as DeletePayload | null;
  if (!body?.documentId) {
    return NextResponse.json(
      { error: "documentId is required" },
      { status: 400 },
    );
  }

  const { data: document, error: documentError } = await admin
    .from("documents")
    .select(
      "id, stream_id, import_status, storage_bucket, storage_path, deleted_at",
    )
    .eq("id", body.documentId)
    .eq("created_by", authData.user.id)
    .single();

  if (documentError || !document) {
    return NextResponse.json(
      { error: "Document not found" },
      { status: 404 },
    );
  }

  if (document.deleted_at) {
    return NextResponse.json({ deleted: true, alreadyDeleted: true });
  }

  if (["queued", "processing"].includes(document.import_status)) {
    return NextResponse.json(
      { error: "Cannot delete a document while it is still processing" },
      { status: 409 },
    );
  }

  const { count: usageCount, error: usageError } = await admin
    .from("section_attachments")
    .select("id", { count: "exact", head: true })
    .eq("document_id", body.documentId);

  if (usageError) {
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  if ((usageCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `${DOCUMENT_IN_USE_ERROR} (${usageCount} reference${usageCount === 1 ? "" : "s"})`,
      },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("documents")
    .update({ deleted_at: nowIso })
    .eq("id", body.documentId)
    .eq("created_by", authData.user.id)
    .is("deleted_at", null);

  if (updateError) {
    if (updateError.message.includes(DOCUMENT_IN_USE_ERROR)) {
      return NextResponse.json({ error: updateError.message }, { status: 409 });
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (document.storage_bucket && document.storage_path) {
    await admin.storage
      .from(document.storage_bucket)
      .remove([document.storage_path]);
  }

  return NextResponse.json({ deleted: true, documentId: body.documentId });
}
