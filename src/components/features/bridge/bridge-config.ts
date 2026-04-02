import type {
  BridgeInteractionMode,
  BridgeProviderId,
  BridgeQuickPresetId,
  BridgeStreamSession,
} from "@/lib/hooks/useUiPreferencesStore";

export interface BridgeProviderPreset {
  id: BridgeProviderId;
  label: string;
  hostLabel: string;
  launchUrl: string;
}

export interface QuickBridgePreset {
  id: BridgeQuickPresetId;
  label: string;
  interactionMode: BridgeInteractionMode;
  entrySelection: "all" | "last-5";
  includeCanvas: boolean;
  includeGlobalStream: boolean;
}

export type BridgePayloadVariant = "full" | "followup";

export const BRIDGE_PROVIDER_PRESETS: BridgeProviderPreset[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    hostLabel: "chatgpt.com",
    launchUrl: "https://chatgpt.com/",
  },
  {
    id: "gemini",
    label: "Gemini",
    hostLabel: "gemini.google.com",
    launchUrl: "https://gemini.google.com/",
  },
  {
    id: "claude",
    label: "Claude",
    hostLabel: "claude.ai",
    launchUrl: "https://claude.ai/",
  },
];

export function getBridgeProviderPreset(providerId: BridgeProviderId) {
  return (
    BRIDGE_PROVIDER_PRESETS.find((provider) => provider.id === providerId) ??
    BRIDGE_PROVIDER_PRESETS[0]
  );
}

export function buildQuickBridgePreset(
  session?: BridgeStreamSession | null,
): QuickBridgePreset {
  return {
    id: "recommended",
    label: "Recommended",
    interactionMode: session?.lastMode ?? "BOTH",
    entrySelection: session?.lastContextRecipe.entrySelection ?? "all",
    includeCanvas: session?.lastContextRecipe.includeCanvas ?? true,
    includeGlobalStream: session?.lastContextRecipe.includeGlobalStream ?? true,
  };
}

export function composeBridgeInstruction(
  instruction: string,
  sessionMemory: string,
) {
  const trimmedInstruction = instruction.trim();
  const trimmedMemory = sessionMemory.trim();
  if (!trimmedMemory) return trimmedInstruction;
  if (!trimmedInstruction) return trimmedMemory;
  return `${trimmedMemory}\n\nCurrent request: ${trimmedInstruction}`;
}

export function getQuickPayloadVariant(
  session?: BridgeStreamSession | null,
): BridgePayloadVariant {
  return session?.isExternalSessionActive ? "followup" : "full";
}

export function getBridgeSessionLaunchUrl(
  providerId: BridgeProviderId,
  session?: BridgeStreamSession | null,
) {
  const provider = getBridgeProviderPreset(providerId);
  return session?.externalSessionUrl?.trim() || provider.launchUrl;
}

export function buildManualSessionActivationPatch(
  providerId: BridgeProviderId,
  session?: BridgeStreamSession | null,
) {
  return {
    isExternalSessionActive: true,
    externalSessionLoadedAt:
      session?.externalSessionLoadedAt?.trim() || new Date().toISOString(),
    externalSessionUrl: getBridgeSessionLaunchUrl(providerId, session),
  };
}
