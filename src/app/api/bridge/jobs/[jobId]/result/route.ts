import { NextResponse } from "next/server";
import { CompleteBridgeJobSchema } from "@/lib/validation/bridge";
import {
  isBridgeRunnerAuthorized,
  unauthorizedRunnerResponse,
} from "@/lib/bridge/runner-auth";
import {
  mergeRunnerDetails,
  updateBridgeJobResult,
} from "@/lib/bridge/jobs.server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isBridgeRunnerAuthorized(request)) {
    return unauthorizedRunnerResponse();
  }

  const payload = await request.json().catch(() => null);
  const parsed = CompleteBridgeJobSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bridge result payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { jobId } = await context.params;
  const admin = createAdminClient();
  const { data: current, error: fetchError } = await admin
    .from("bridge_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchError || !current) {
    return NextResponse.json({ error: "Bridge job not found" }, { status: 404 });
  }

  const job = await updateBridgeJobResult(jobId, {
    status: "succeeded",
    raw_response: parsed.data.rawResponse,
    error_code: null,
    error_message: null,
    completed_at: new Date().toISOString(),
    runner_details: mergeRunnerDetails(
      current.runner_details,
      parsed.data.runnerDetails,
    ),
  });

  return NextResponse.json({ job });
}
