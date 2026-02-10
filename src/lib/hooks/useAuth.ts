"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  AuthStatus,
  clearAuthClientStorage,
  clearDevAuthCookie,
  getAuthStorageKey,
  readStoredAuthState,
  writeStoredAuthState,
} from "@/lib/utils/authStorage";

const EXPIRY_POLL_INTERVAL_MS = 30000;

export function useAuth() {
  const initialStored = readStoredAuthState();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    initialStored?.status ?? "signed_out",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const expiryRef = useRef<number | null>(initialStored?.expiresAt ?? null);
  const supabase = createClient();

  const handleSessionUpdate = useCallback((session: Session | null) => {
    setError(null);
    const nextStatus: AuthStatus = session?.user ? "signed_in" : "signed_out";
    const nextState = {
      status: nextStatus,
      updatedAt: Date.now(),
      userId: session?.user?.id,
      email: session?.user?.email ?? undefined,
      expiresAt: session?.expires_at ? session.expires_at * 1000 : undefined,
    };

    setUser(session?.user ?? null);
    setStatus(nextStatus);
    setLoading(false);
    expiryRef.current = nextState.expiresAt ?? null;
    writeStoredAuthState(nextState);
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    let success = true;
    let errorSet = false;

    try {
      await fetch("/api/auth/signout", { method: "POST", keepalive: true });
    } catch {
      success = false;
      errorSet = true;
      setError("Unable to sign out. Check your network and try again.");
    }

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      success = false;
      if (!errorSet) {
        setError("Unable to sign out. Check your network and try again.");
      }
    }

    clearAuthClientStorage();
    clearDevAuthCookie();
    handleSessionUpdate(null);
    return success;
  }, [handleSessionUpdate, supabase]);

  const validateSession = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      // If the session is invalid (e.g. DB reset), force sign out
      if (sessionError.message.includes("Invalid Refresh Token") || 
          sessionError.message.includes("Refresh Token Not Found")) {
        console.warn("[Auth] Session invalid, forcing sign out:", sessionError.message);
        await signOut();
        return;
      }
      
      setError("Unable to refresh session. Check your network and try again.");
      setLoading(false);
      return;
    }

    if (!data.session) {
      // Ensure local state is cleared if no session exists
      if (status === 'signed_in') {
        await signOut();
      } else {
        handleSessionUpdate(null);
      }
      return;
    }

    handleSessionUpdate(data.session);
  }, [handleSessionUpdate, supabase, signOut, status]);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) {
        setError("Unable to refresh session. Check your network and try again.");
        setLoading(false);
        return;
      }
      handleSessionUpdate(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSessionUpdate(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [handleSessionUpdate, supabase]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!expiryRef.current) {
        return;
      }

      if (Date.now() >= expiryRef.current) {
        void validateSession();
      }
    }, EXPIRY_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [validateSession]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== getAuthStorageKey()) {
        return;
      }

      const stored = readStoredAuthState();
      if (!stored) {
        return;
      }

      if (stored.status === "signed_out") {
        handleSessionUpdate(null);
        return;
      }

      if (stored.status === "signed_in" && !user) {
        void validateSession();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [handleSessionUpdate, user, validateSession]);

  return { user, status, loading, error, signOut };
}
