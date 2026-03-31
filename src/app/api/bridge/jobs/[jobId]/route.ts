import { NextResponse } from "next/server";
import {
  isBridgeRunnerAuthorized,
  unauthorizedRunnerResponse,
} from "@/lib/bridge/runner-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isBridgeRunnerAuthorized(request)) {
    return unauthorizedRunnerResponse();
  }

  const { jobId } = await context.params;
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("bridge_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return NextResponse.json({ error: "Bridge job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
