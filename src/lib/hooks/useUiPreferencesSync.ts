"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import debounce from "lodash/debounce";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import type { Json } from "@/lib/types/database.types";
import {
  buildUiPreferencesPayload,
  getDeviceClassForWidth,
  type UiPreferencesPayload,
  useUiPreferencesStore,
} from "@/lib/hooks/useUiPreferencesStore";

type SupabaseUiPreferenceError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isMissingUiPreferencesStorage(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { code, details, hint, message } = error as SupabaseUiPreferenceError;
  const text = [code, details, hint, message].filter(Boolean).join(" ").toLowerCase();

  return (
    code === "42P01" ||
    text.includes("user_ui_preferences") ||
    text.includes("does not exist") ||
    text.includes("schema cache") ||
    text.includes("could not find the table")
  );
}

export function useUiPreferencesSync() {
  const { user, loading, status } = useAuth();
  const supabase = createClient();
  const initializedRef = useRef(false);
  const cloudSyncDisabledRef = useRef(false);

  useLayoutEffect(() => {
    try {
      useUiPreferencesStore.persist.rehydrate();
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncDeviceClass = () => {
      useUiPreferencesStore
        .getState()
        .setDeviceClass(getDeviceClassForWidth(window.innerWidth));
    };

    syncDeviceClass();
    window.addEventListener("resize", syncDeviceClass);
    return () => window.removeEventListener("resize", syncDeviceClass);
  }, []);

  useEffect(() => {
    if (!loading) {
      useUiPreferencesStore.getState().setActiveUser(user?.id ?? null);
    }
  }, [loading, user?.id]);

  useEffect(() => {
    if (loading || status !== "signed_in" || !user?.id) {
      if (!loading) {
        useUiPreferencesStore.getState().setCloudHydrated(null);
      }
      return;
    }

    let cancelled = false;

    void (async () => {
      if (cloudSyncDisabledRef.current) {
        useUiPreferencesStore.getState().setCloudHydrated(user.id);
        initializedRef.current = true;
        return;
      }

      const currentState = useUiPreferencesStore.getState();
      if (currentState.cloudHydratedUserId === user.id && initializedRef.current) {
        return;
      }

      const { data, error } = await supabase
        .from("user_ui_preferences")
        .select("preferences, updated_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        if (isMissingUiPreferencesStorage(error)) {
          cloudSyncDisabledRef.current = true;
        } else {
          console.error("[UI Preferences] Failed to fetch cloud preferences", error);
        }
        useUiPreferencesStore.getState().setCloudHydrated(user.id);
        initializedRef.current = true;
        return;
      }

      const fetchedAt = parseTimestamp(data?.updated_at) ?? Date.now();
      const state = useUiPreferencesStore.getState();
      const hasUnsyncedLocalChanges =
        state.localUpdatedAt !== null &&
        (state.lastSyncedAt === null || state.localUpdatedAt > state.lastSyncedAt);

      if (data?.preferences && (!hasUnsyncedLocalChanges || fetchedAt > (state.lastSyncedAt ?? 0))) {
        state.applyCloudPreferences(
          data.preferences as unknown as UiPreferencesPayload,
          user.id,
          fetchedAt,
        );
      } else {
        state.setCloudHydrated(user.id);
      }

      initializedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, status, supabase, user?.id]);

  useEffect(() => {
    if (loading || status !== "signed_in" || !user?.id) return;
    if (cloudSyncDisabledRef.current) return;

    const savePreferences = debounce(
      async (payload: UiPreferencesPayload, userId: string) => {
        useUiPreferencesStore.getState().setSyncStatus("syncing");

        const { data, error } = await supabase
          .from("user_ui_preferences")
          .upsert(
            {
              user_id: userId,
              preferences: payload as unknown as Json,
            },
            { onConflict: "user_id" },
          )
          .select("updated_at")
          .single();

        if (error) {
          if (isMissingUiPreferencesStorage(error)) {
            cloudSyncDisabledRef.current = true;
            useUiPreferencesStore.getState().setCloudHydrated(userId);
            useUiPreferencesStore.getState().setSyncStatus("idle");
            return;
          }

          console.error("[UI Preferences] Failed to save cloud preferences", error);
          useUiPreferencesStore.getState().setSyncStatus("error");
          return;
        }

        useUiPreferencesStore
          .getState()
          .markSynced(parseTimestamp(data.updated_at) ?? Date.now(), userId);

        window.setTimeout(() => {
          const state = useUiPreferencesStore.getState();
          if (state.syncStatus === "synced") {
            state.setSyncStatus("idle");
          }
        }, 2000);
      },
      900,
    );

    const unsubscribe = useUiPreferencesStore.subscribe((state, previousState) => {
      if (state.cloudHydratedUserId !== user.id) return;
      if (state.localUpdatedAt === previousState.localUpdatedAt) return;
      if (state.localUpdatedAt === null) return;

      const payload = buildUiPreferencesPayload(state);
      void savePreferences(payload, user.id);
    });

    const flushPendingSave = () => {
      savePreferences.flush();
    };

    window.addEventListener("beforeunload", flushPendingSave);
    window.addEventListener("pagehide", flushPendingSave);

    return () => {
      unsubscribe();
      savePreferences.flush();
      savePreferences.cancel();
      window.removeEventListener("beforeunload", flushPendingSave);
      window.removeEventListener("pagehide", flushPendingSave);
    };
  }, [loading, status, supabase, user?.id]);
}
