import { NextResponse } from "next/server";
import {
  BRIDGE_STATUS_TIMEOUT_MS,
  isBridgeRunnerHealthPayload,
  resolveServerHealthUrl,
} from "@/lib/bridge/runner-status";

export const runtime = "nodejs";

export async function GET() {
  const healthUrl = resolveServerHealthUrl();

  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(BRIDGE_STATUS_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ online: false });
    }

    const payload = await response.json().catch(() => null);

    if (!isBridgeRunnerHealthPayload(payload)) {
      return NextResponse.json({ online: false });
    }

    return NextResponse.json({
      online: true,
      runnerId: payload.runnerId,
      providers: payload.providers,
    });
  } catch {
    return NextResponse.json({ online: false });
  }
}
