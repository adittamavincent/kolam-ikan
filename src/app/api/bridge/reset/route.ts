import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export const runtime = "nodejs";

const ResetBridgeSchema = z.object({
  streamId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = ResetBridgeSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bridge reset payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { streamId } = parsed.data;

  const { data: streamAccess, error: streamAccessError } = await supabase.rpc(
    "user_can_access_stream",
    { p_stream_id: streamId },
  );

  if (streamAccessError || !streamAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: deleteError } = await admin
    .from("bridge_jobs")
    .delete()
    .eq("stream_id", streamId);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message ?? "Failed to reset bridge session" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
