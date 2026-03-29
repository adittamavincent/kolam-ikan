export const BRIDGE_JOB_PROVIDERS = [
  "chatgpt",
  "gemini",
  "claude",
] as const;

export type BridgeJobProvider = (typeof BRIDGE_JOB_PROVIDERS)[number];

export const DEFAULT_BRIDGE_JOB_PROVIDER: BridgeJobProvider = "gemini";

export const BRIDGE_JOB_PROVIDER_LABELS: Record<BridgeJobProvider, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

export function isBridgeJobProvider(value: string): value is BridgeJobProvider {
  return (BRIDGE_JOB_PROVIDERS as readonly string[]).includes(value);
}
