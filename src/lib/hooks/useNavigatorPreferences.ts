"use client";

import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

const EMPTY_EXPANDED_CABINET_IDS: string[] = [];

export function useNavigatorPreferences(domainId?: string) {
  const expandedCabinetIds = useUiPreferencesStore(
    (state) =>
      domainId
        ? state.navigatorExpandedByDomain[domainId] ??
          EMPTY_EXPANDED_CABINET_IDS
        : EMPTY_EXPANDED_CABINET_IDS,
  );

  return {
    expandedCabinetIds,
    setExpandedCabinets: useUiPreferencesStore(
      (state) => state.setExpandedCabinetsForDomain,
    ),
    addExpandedCabinet: useUiPreferencesStore((state) => state.addExpandedCabinet),
    removeExpandedCabinet: useUiPreferencesStore(
      (state) => state.removeExpandedCabinet,
    ),
    toggleExpandedCabinet: useUiPreferencesStore(
      (state) => state.toggleExpandedCabinet,
    ),
  };
}
