const DEFAULT_DEV_SITE_URL = "http://localhost:3000";

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

export function getConfiguredSiteUrl(): string {
  return (
    normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeOrigin(process.env.VERCEL_URL) ??
    DEFAULT_DEV_SITE_URL
  );
}

export function getAppOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return getConfiguredSiteUrl();
}

export function buildAuthCallbackUrl(next?: string): string {
  const callbackUrl = new URL("/auth/callback", getAppOrigin());

  if (next && next.startsWith("/")) {
    callbackUrl.searchParams.set("next", next);
  }

  return callbackUrl.toString();
}
