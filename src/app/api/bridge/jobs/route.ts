import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CreateBridgeJobSchema } from "@/lib/validation/bridge";
import { buildBridgeSessionKey } from "@/lib/bridge/bridge-jobs";
import type { Json } from "@/lib/types/database.types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = CreateBridgeJobSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bridge job payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const sessionKey =
    input.sessionKey || buildBridgeSessionKey(input.streamId, input.provider);

  const { data: existingJob, error: existingJobError } = await supabase
    .from("bridge_jobs")
    .select("*")
    .eq("stream_id", input.streamId)
    .eq("provider", input.provider)
    .eq("session_key", sessionKey)
    .in("status", ["queued", "running"])
    .eq("payload", input.payload)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingJobError) {
    return NextResponse.json(
      { error: existingJobError.message ?? "Failed to inspect existing bridge jobs" },
      { status: 400 },
    );
  }

  if (existingJob) {
    return NextResponse.json({ job: existingJob, deduped: true }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("bridge_jobs")
    .insert({
      stream_id: input.streamId,
      provider: input.provider,
      payload: input.payload,
      payload_variant: input.payloadVariant,
      session_key: sessionKey,
      runner_details: (input.runnerDetails ?? {}) as Json,
    })
    .select("*")
    .single();

  if (error) {
    const providerConstraintError = error.message?.includes(
      "bridge_jobs_provider_check",
    );
    return NextResponse.json(
      {
        error: providerConstraintError
          ? "Bridge provider is not enabled in the database yet. Run the latest bridge_jobs migration."
          : error.message ?? "Failed to queue bridge job",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ job: data }, { status: 201 });
}
