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

export function getConfiguredHealthPort(
  value: string | undefined,
  fallback = DEFAULT_BRIDGE_RUNNER_HEALTH_PORT,
) {
  const parsed = Number(value || `${fallback}`);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildHealthUrlFromPort(port: number) {
  return `http://127.0.0.1:${port}/health`;
}

export function resolveServerHealthUrl() {
  const explicit = process.env.BRIDGE_RUNNER_HEALTH_URL?.trim();
  if (explicit) return explicit;
  return buildHealthUrlFromPort(
    getConfiguredHealthPort(process.env.BRIDGE_RUNNER_HEALTH_PORT),
  );
}

export function resolveBrowserHealthCandidates() {
  const explicit = process.env.NEXT_PUBLIC_BRIDGE_RUNNER_HEALTH_URL?.trim();
  const port = getConfiguredHealthPort(
    process.env.NEXT_PUBLIC_BRIDGE_RUNNER_HEALTH_PORT,
  );
  const candidates = [
    explicit,
    buildHealthUrlFromPort(port),
  ].filter((value): value is string => Boolean(value?.trim()));

  return [...new Set(candidates.map(normalizeBaseUrl))];
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

