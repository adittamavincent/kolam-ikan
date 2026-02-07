export type AuthStatus = "signed_in" | "signed_out";

export interface StoredAuthState {
  status: AuthStatus;
  userId?: string;
  email?: string;
  expiresAt?: number;
  updatedAt: number;
}

const STORAGE_KEY = "kolam.auth.state.v1";
const REMEMBER_ME_KEY = "kolam.auth.rememberMe";
const REMEMBER_ME_COOKIE = "kolam-remember-me";
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

  const rememberMe = getRememberMe();
  const maxAge = rememberMe ? 60 * 60 * 24 * 30 : undefined; // 30 days or session
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";

  const cookieStr = maxAge 
    ? `${DEV_AUTH_COOKIE}=1; path=/; max-age=${maxAge}; SameSite=Lax${secureFlag}`
    : `${DEV_AUTH_COOKIE}=1; path=/; SameSite=Lax${secureFlag}`;

  document.cookie = cookieStr;
}

export function clearDevAuthCookie() {
  if (typeof document === "undefined") {
    return;
  }
  
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  document.cookie = `${DEV_AUTH_COOKIE}=; path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
}

export function clearAuthClientStorage() {
  if (typeof window === "undefined") {
    return;
  }

  clearStoredAuthState();

  for (const key of Object.keys(window.localStorage)) {
    if ((key.startsWith("sb-") || key.includes("supabase")) && key !== REMEMBER_ME_KEY) {
      window.localStorage.removeItem(key);
    }
  }

  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith("sb-") || key.includes("supabase")) {
      window.sessionStorage.removeItem(key);
    }
  }
}

export function setRememberMe(value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(REMEMBER_ME_KEY, String(value));
  
  // Also set as a cookie so the server (middleware) can read it
  if (typeof document !== "undefined") {
    const maxAge = value ? 60 * 60 * 24 * 30 : undefined; // 30 days or session
    const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
    
    const cookieStr = maxAge 
      ? `${REMEMBER_ME_COOKIE}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${secureFlag}`
      : `${REMEMBER_ME_COOKIE}=${value}; path=/; SameSite=Lax${secureFlag}`;
    document.cookie = cookieStr;
  }
}

export function getRememberMe(): boolean {
  if (typeof window === "undefined") {
    return true; // Default to true for SSR
  }
  
  // Try localStorage first
  const stored = window.localStorage.getItem(REMEMBER_ME_KEY);
  if (stored !== null) {
    return stored === "true";
  }
  
  // Fall back to cookie
  if (typeof document !== "undefined") {
    const cookies = document.cookie.split('; ');
    const rememberMeCookie = cookies.find(c => c.startsWith(`${REMEMBER_ME_COOKIE}=`));
    if (rememberMeCookie) {
      const value = rememberMeCookie.split('=')[1];
      return value === "true";
    }
  }
  
  // Default to true if not set
  return true;
}

export function clearRememberMe() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(REMEMBER_ME_KEY);
  
  // Also clear the cookie
  if (typeof document !== "undefined") {
    const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
    document.cookie = `${REMEMBER_ME_COOKIE}=; path=/; max-age=0; SameSite=Lax${secureFlag}`;
  }
}

export function getRememberMeCookieName() {
  return REMEMBER_ME_COOKIE;
}
