import { NextResponse } from "next/server";

export function getBridgeRunnerSecret() {
  return process.env.BRIDGE_RUNNER_SECRET ?? "";
}

export function getRunnerIdFromRequest(request: Request) {
  return request.headers.get("x-bridge-runner-id")?.trim() || "local-runner";
}

export function isBridgeRunnerAuthorized(request: Request) {
  const secret = getBridgeRunnerSecret();
  if (!secret) return false;

  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length) === secret;
  }

  return request.headers.get("x-bridge-runner-secret") === secret;
}

export function unauthorizedRunnerResponse() {
  return NextResponse.json({ error: "Unauthorized bridge runner" }, { status: 401 });
}
