"use client";

import { Copy, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useBridgePayload } from "./bridge-payload";
import type { BridgePayloadVariant } from "./bridge-config";

interface XMLGeneratorProps {
  streamId: string;
  interactionMode: string;
  selectedEntries: string[];
  includeCanvas: boolean;
  includeGlobalStream: boolean;
  globalStreamIds: string[];
  globalStreamName: string | null;
  userInput: string;
  payloadVariant?: BridgePayloadVariant;
  onXMLGenerated?: (xml: string) => void;
  onPayloadReadyChange?: (ready: boolean) => void;
  compact?: boolean;
}

export function XMLGenerator({
  streamId,
  interactionMode,
  selectedEntries,
  includeCanvas,
  includeGlobalStream,
  globalStreamIds,
  globalStreamName,
  userInput,
  payloadVariant = "full",
  onXMLGenerated,
  onPayloadReadyChange,
  compact = false,
}: XMLGeneratorProps) {
  const [copied, setCopied] = useState(false);
  const { payload: currentXML, isReady } = useBridgePayload({
    streamId,
    interactionMode,
    selectedEntries,
    includeCanvas,
    includeGlobalStream,
    globalStreamIds,
    globalStreamName,
    userInput,
    payloadVariant,
    onPayloadGenerated: onXMLGenerated,
  });

  useEffect(() => {
    onPayloadReadyChange?.(isReady);
  }, [isReady, onPayloadReadyChange]);

  const copyToClipboard = async () => {
    if (!isReady) return;
    await navigator.clipboard.writeText(currentXML);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={compact ? "space-y-3" : "mt-6 space-y-3"}>
      <div>
        <label className="text-sm font-semibold text-text-default">
          Ready-to-Send Payload
        </label>
        <p className="text-xs text-text-muted mt-0.5 mb-2">
          {isReady
            ? "Review and copy this payload before switching to your AI destination."
            : "Loading bridge context before the payload is ready to send."}
        </p>
      </div>

      <div className="relative group border border-border-default bg-[#0d1117] overflow-hidden">
        <textarea
          readOnly
          rows={6}
          value={currentXML}
          className="min-h-35 w-full resize-y bg-[#0d1117] p-4 font-mono text-[13px] leading-relaxed text-[#c9d1d9]"
        />
        <div className="absolute top-2 right-2">
          <button
            onClick={copyToClipboard}
            disabled={!isReady}
            className={`flex items-center gap-1.5 border px-3 py-1.5 text-xs font-semibold transition-all ${
              copied
                ? "bg-status-success-bg text-status-success-text border border-status-success-bg"
                : "border-border-default bg-surface-elevated text-white hover:bg-surface-hover"
            } ${!isReady ? "cursor-not-allowed opacity-60" : ""}`}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
