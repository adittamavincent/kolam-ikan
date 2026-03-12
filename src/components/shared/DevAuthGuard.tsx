"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  clearAuthClientStorage,
  clearDevAuthCookie,
  getDevSessionFlag,
  isDevelopmentHost,
  getRememberMe,
} from "@/lib/utils/authStorage";

export function DevAuthGuard() {
  useEffect(() => {
    if (!isDevelopmentHost()) {
      return;
    }

    const flagKey = getDevSessionFlag();
    const alreadyCleared = window.sessionStorage.getItem(flagKey) === "1";
    if (alreadyCleared) {
      return;
    }

    // If the user has "Remember Me" enabled, do not clear the session
    // even if it's a new browser session (tab/window).
    const rememberMe = getRememberMe();
    if (rememberMe) {
      window.sessionStorage.setItem(flagKey, "1");
      return;
    }

    const supabase = createClient();

    const clearDevAuth = async () => {
      try {
        await supabase.auth.signOut({ scope: "global" });
      } catch (error) {
        console.error("Dev auth guard sign-out failed.", error);
      } finally {
        clearAuthClientStorage();
        clearDevAuthCookie();
        window.sessionStorage.setItem(flagKey, "1");
      }
    };

    void clearDevAuth();
  }, []);

  return null;
}
