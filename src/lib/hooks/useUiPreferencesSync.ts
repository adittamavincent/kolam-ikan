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
  type BridgeStreamSession,
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

export function shouldApplyFetchedPreferences(
  fetchedAt: number,
  localUpdatedAt: number | null,
  lastSyncedAt: number | null,
) {
  const hasUnsyncedLocalChanges =
    localUpdatedAt !== null &&
    (lastSyncedAt === null || localUpdatedAt > lastSyncedAt);

  return !hasUnsyncedLocalChanges || fetchedAt > (lastSyncedAt ?? 0);
}

export function didBridgePhaseChange(
  current: Record<string, BridgeStreamSession>,
  previous: Record<string, BridgeStreamSession>,
) {
  const streamIds = new Set([
    ...Object.keys(current),
    ...Object.keys(previous),
  ]);

  for (const streamId of streamIds) {
    const currentSession = current[streamId];
    const previousSession = previous[streamId];
    if (
      currentSession?.quickUiPhase !== previousSession?.quickUiPhase ||
      currentSession?.detailedUiPhase !== previousSession?.detailedUiPhase
    ) {
      return true;
    }
  }

  return false;
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

    const loadCloudPreferences = async () => {
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

      if (
        data?.preferences &&
        shouldApplyFetchedPreferences(
          fetchedAt,
          state.localUpdatedAt,
          state.lastSyncedAt,
        )
      ) {
        state.applyCloudPreferences(
          data.preferences as unknown as UiPreferencesPayload,
          user.id,
          fetchedAt,
        );
      } else {
        state.setCloudHydrated(user.id);
      }

      initializedRef.current = true;
    };

    void loadCloudPreferences();

    const handleVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      initializedRef.current = false;
      void loadCloudPreferences();
    };

    const handleFocusRefresh = () => {
      initializedRef.current = false;
      void loadCloudPreferences();
    };

    window.addEventListener("visibilitychange", handleVisibilityRefresh);
    window.addEventListener("focus", handleFocusRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", handleVisibilityRefresh);
      window.removeEventListener("focus", handleFocusRefresh);
    };
  }, [loading, status, supabase, user?.id]);

  useEffect(() => {
    if (loading || status !== "signed_in" || !user?.id) return;
    if (cloudSyncDisabledRef.current) return;

    const persistPreferences = async (payload: UiPreferencesPayload, userId: string) => {
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
    };

    const savePreferences = debounce(
      persistPreferences,
      900,
    );

    const unsubscribe = useUiPreferencesStore.subscribe((state, previousState) => {
      if (state.cloudHydratedUserId !== user.id) return;
      if (state.localUpdatedAt === previousState.localUpdatedAt) return;
      if (state.localUpdatedAt === null) return;

      const payload = buildUiPreferencesPayload(state);
      if (
        didBridgePhaseChange(
          state.bridgeSessionsByStream,
          previousState.bridgeSessionsByStream,
        )
      ) {
        savePreferences.cancel();
        void persistPreferences(payload, user.id);
        return;
      }

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
