"use client";

import { LogPane } from "@/components/features/log/LogPane";
import { CanvasPane } from "@/components/features/canvas/CanvasPane";
import { BridgeModal } from "@/components/features/bridge/BridgeModal";
import { QuickBridgeDialog } from "@/components/features/bridge/QuickBridgeDialog";
import { DocumentImportModal } from "@/components/features/documents/DocumentImportModal";
import { WhatsAppImportModal } from "@/components/features/log/WhatsAppImportModal";
import { useRealtimeEntries } from "@/lib/hooks/useRealtimeEntries";
import { useLayout } from "@/lib/hooks/useLayout";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import { BRIDGE_PROVIDER_PRESETS } from "@/components/features/bridge/bridge-config";
import { useEffect, useState } from "react";
import { Globe, Link2, RotateCcw, Sparkles, Wand2 } from "lucide-react";

export function StreamView({ streamId }: { streamId: string }) {
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const [isQuickBridgeOpen, setIsQuickBridgeOpen] = useState(false);
  const [isDocumentImportOpen, setIsDocumentImportOpen] = useState(false);
  const [incomingDocumentFiles, setIncomingDocumentFiles] = useState<Array<{
    file: File;
    hash?: string;
  }> | null>(null);
  const [isWhatsAppImportOpen, setIsWhatsAppImportOpen] = useState(false);
  const { logWidth } = useLayout();
  const bridgeSession = useUiPreferencesStore(
    (state) => state.bridgeSessionsByStream[streamId],
  );
  const bridgeDefaults = useUiPreferencesStore((state) => state.bridgeDefaults);
  const clearBridgeSession = useUiPreferencesStore(
    (state) => state.clearBridgeSession,
  );
  const setBridgeDefaults = useUiPreferencesStore(
    (state) => state.setBridgeDefaults,
  );
  const upsertBridgeSession = useUiPreferencesStore(
    (state) => state.upsertBridgeSession,
  );
  useRealtimeEntries(streamId);

  const selectedProviderId =
    bridgeSession?.providerId ?? bridgeDefaults.providerId;
  const hasActiveSession = !!bridgeSession?.isExternalSessionActive;
  const hasSessionMemory =
    !!bridgeSession?.sessionMemory.trim() ||
    !!bridgeSession?.lastInstruction.trim();

  useEffect(() => {
    const onOpenDocumentImport = (ev?: Event) => {
      if (ev && ev instanceof CustomEvent && ev.detail?.files) {
        const files = ev.detail.files as File[];
        setIncomingDocumentFiles(files.map((f) => ({ file: f })));
      }
      setIsDocumentImportOpen(true);
    };

    const onOpenWhatsAppImport = () => setIsWhatsAppImportOpen(true);

    window.addEventListener(
      "kolam_header_documents_import",
      onOpenDocumentImport as EventListener,
    );
    window.addEventListener(
      "kolam_header_whatsapp_import",
      onOpenWhatsAppImport,
    );

    return () => {
      window.removeEventListener(
        "kolam_header_documents_import",
        onOpenDocumentImport as EventListener,
      );
      window.removeEventListener(
        "kolam_header_whatsapp_import",
        onOpenWhatsAppImport,
      );
    };
  }, []);

  return (
    <div className="flex flex-1 relative min-w-0 min-h-0 h-full w-full">
      <LogPane streamId={streamId} logWidth={logWidth} />
      <CanvasPane streamId={streamId} />

      <div className="fixed bottom-4 right-4 z-40 flex flex-wrap items-center gap-2 border border-border-default bg-surface-default px-3 py-2 shadow-lg">
        <div
          className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[11px] font-semibold ${
            hasActiveSession
              ? "border-status-success-bg bg-status-success-bg/40 text-status-success-text"
              : "border-border-subtle bg-surface-subtle text-text-muted"
          }`}
          title={
            hasActiveSession
              ? "Active web session. Quick will send follow-up payloads."
              : "No active web session. Quick will send a full payload."
          }
        >
          <Link2 className="h-3.5 w-3.5" />
          <span>{hasActiveSession ? "Live" : "Fresh"}</span>
        </div>

        <label className="inline-flex items-center gap-2 border border-border-subtle bg-surface-subtle px-2 py-1">
          <Globe className="h-3.5 w-3.5 text-text-muted" />
          <select
            value={selectedProviderId}
            onChange={(event) => {
              const providerId = event.target.value as
                | "chatgpt"
                | "gemini"
                | "claude";
              setBridgeDefaults({ providerId });
              if (bridgeSession) {
                upsertBridgeSession(streamId, { providerId });
              }
            }}
            className="bg-transparent text-[11px] font-semibold text-text-default outline-none"
            title="Preferred web LLM"
          >
            {BRIDGE_PROVIDER_PRESETS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsQuickBridgeOpen(true);
            }}
            className="flex items-center gap-1.5 bg-action-primary-bg px-3 py-2 text-sm font-semibold text-action-primary-text transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-lg"
          >
            <Wand2 className="h-4 w-4" />
            <span>Quick</span>
          </button>
          <button
            onClick={() => {
              setIsBridgeOpen(true);
            }}
            className="flex items-center gap-1.5 border border-border-default bg-surface-subtle px-3 py-2 text-sm font-semibold text-text-default transition-[background-color,box-shadow] hover:bg-surface-hover hover:shadow-lg"
          >
            <Sparkles className="h-4 w-4" />
            <span>Detailed</span>
          </button>
        </div>

        {hasSessionMemory && (
          <button
            onClick={() => clearBridgeSession(streamId)}
            className="inline-flex items-center gap-1.5 border border-border-subtle bg-surface-subtle px-2 py-2 text-[11px] font-semibold text-text-muted hover:bg-surface-hover hover:text-text-default"
            title="Reset current bridge session"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        )}
      </div>

      <QuickBridgeDialog
        isOpen={isQuickBridgeOpen}
        onClose={() => setIsQuickBridgeOpen(false)}
        onOpenDetailed={() => setIsBridgeOpen(true)}
        streamId={streamId}
      />

      <BridgeModal
        isOpen={isBridgeOpen}
        onClose={() => setIsBridgeOpen(false)}
        streamId={streamId}
      />

      <DocumentImportModal
        isOpen={isDocumentImportOpen}
        onClose={() => {
          setIsDocumentImportOpen(false);
          setIncomingDocumentFiles(null);
        }}
        initialQueuedFiles={incomingDocumentFiles ?? undefined}
        streamId={streamId}
      />

      <WhatsAppImportModal
        isOpen={isWhatsAppImportOpen}
        onClose={() => setIsWhatsAppImportOpen(false)}
        streamId={streamId}
      />
    </div>
  );
}
