import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type DeletePayload = {
  streamId?: string;
  documentId?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as DeletePayload | null;
  if (!body?.streamId || !body?.documentId) {
    return NextResponse.json(
      { error: "streamId and documentId are required" },
      { status: 400 },
    );
  }

  const { data: streamAccess, error: streamError } = await supabase
    .from("streams")
    .select("id")
    .eq("id", body.streamId)
    .single();

  if (streamError || !streamAccess) {
    return NextResponse.json(
      { error: "You do not have access to this stream" },
      { status: 403 },
    );
  }

  const { data: document, error: documentError } = await admin
    .from("documents")
    .select(
      "id, stream_id, import_status, storage_bucket, storage_path, deleted_at",
    )
    .eq("id", body.documentId)
    .eq("stream_id", body.streamId)
    .single();

  if (documentError || !document) {
    return NextResponse.json(
      { error: "Document not found in this stream" },
      { status: 404 },
    );
  }

  if (document.deleted_at) {
    return NextResponse.json({ deleted: true, alreadyDeleted: true });
  }

  if (document.import_status !== "canceled") {
    return NextResponse.json(
      { error: "Only canceled documents can be deleted" },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("documents")
    .update({ deleted_at: nowIso })
    .eq("id", body.documentId)
    .eq("stream_id", body.streamId)
    .is("deleted_at", null);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (document.storage_bucket && document.storage_path) {
    await admin.storage
      .from(document.storage_bucket)
      .remove([document.storage_path]);
  }

  return NextResponse.json({ deleted: true, documentId: body.documentId });
}
