export type AuthStatus = "signed_in" | "signed_out";

export interface StoredAuthState {
  status: AuthStatus;
  userId?: string;
  email?: string;
  expiresAt?: number;
  updatedAt: number;
}

const STORAGE_KEY = "kolam.auth.state.v1";
const DEV_AUTH_COOKIE = "kolam-dev-auth";
const DEV_SESSION_FLAG = "kolam.dev.auth.cleared";

export function readStoredAuthState(): StoredAuthState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredAuthState;
    if (parsed.status !== "signed_in" && parsed.status !== "signed_out") {
      return null;
    }

    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      return {
        status: "signed_out",
        updatedAt: Date.now(),
      };
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredAuthState(state: StoredAuthState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearStoredAuthState() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

export function getAuthStorageKey() {
  return STORAGE_KEY;
}

export function getDevAuthCookieName() {
  return DEV_AUTH_COOKIE;
}

export function getDevSessionFlag() {
  return DEV_SESSION_FLAG;
}

export function isDevelopmentHost() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.location.hostname === "localhost" &&
    window.location.port === "3000"
  );
}

export function setDevAuthCookie() {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${DEV_AUTH_COOKIE}=1; path=/; SameSite=Lax`;
}

export function clearDevAuthCookie() {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${DEV_AUTH_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`;
}

export function clearAuthClientStorage() {
  if (typeof window === "undefined") {
    return;
  }

  clearStoredAuthState();

  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("sb-") || key.includes("supabase")) {
      window.localStorage.removeItem(key);
    }
  }

  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith("sb-") || key.includes("supabase")) {
      window.sessionStorage.removeItem(key);
    }
  }
}
