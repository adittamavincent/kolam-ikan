import { NextResponse } from "next/server";
import { ClaimBridgeJobSchema } from "@/lib/validation/bridge";
import {
  getRunnerIdFromRequest,
  isBridgeRunnerAuthorized,
  unauthorizedRunnerResponse,
} from "@/lib/bridge/runner-auth";
import { claimNextBridgeJob } from "@/lib/bridge/jobs.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isBridgeRunnerAuthorized(request)) {
    return unauthorizedRunnerResponse();
  }

  const { searchParams } = new URL(request.url);
  const parsed = ClaimBridgeJobSchema.safeParse({
    provider: searchParams.get("provider") ?? undefined,
    runnerId: searchParams.get("runnerId") ?? getRunnerIdFromRequest(request),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bridge claim request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const job = await claimNextBridgeJob({
    provider: parsed.data.provider,
    runnerId: parsed.data.runnerId ?? getRunnerIdFromRequest(request),
  });

  return NextResponse.json({ job });
}
