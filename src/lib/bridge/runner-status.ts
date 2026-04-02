export const DEFAULT_BRIDGE_RUNNER_HEALTH_PORT = 3001;
export const BRIDGE_STATUS_TIMEOUT_MS = 2_000;

export interface BridgeRunnerHealthPayload {
  status: "ok";
  runnerId: string;
  providers: string[];
}

export interface BridgeStatusResult {
  online: boolean;
  runnerId?: string;
  providers?: string[];
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

export function buildHealthUrlFromPort(port: number) {
  return `http://127.0.0.1:${port}/health`;
}

export function resolveServerHealthUrl() {
  return buildHealthUrlFromPort(DEFAULT_BRIDGE_RUNNER_HEALTH_PORT);
}

export function resolveBrowserHealthCandidates() {
  return [
    normalizeBaseUrl(
      buildHealthUrlFromPort(DEFAULT_BRIDGE_RUNNER_HEALTH_PORT),
    ),
  ];
}

export function isBridgeRunnerHealthPayload(
  value: unknown,
): value is BridgeRunnerHealthPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.status === "ok" &&
    typeof payload.runnerId === "string" &&
    payload.runnerId.trim().length > 0 &&
    Array.isArray(payload.providers) &&
    payload.providers.every((provider) => typeof provider === "string")
  );
}
