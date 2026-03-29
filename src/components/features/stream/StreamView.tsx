"use client";

import { LogPane } from "@/components/features/log/LogPane";
import { CanvasPane } from "@/components/features/canvas/CanvasPane";
import { BridgeModal } from "@/components/features/bridge/BridgeModal";
import { QuickBridgeControl } from "@/components/features/bridge/QuickBridgeControl";
import { DocumentImportModal } from "@/components/features/documents/DocumentImportModal";
import { WhatsAppImportModal } from "@/components/features/log/WhatsAppImportModal";
import { useRealtimeEntries } from "@/lib/hooks/useRealtimeEntries";
import { useLayout } from "@/lib/hooks/useLayout";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import { BRIDGE_PROVIDER_PRESETS } from "@/components/features/bridge/bridge-config";
import { useEffect, useState } from "react";
import { Globe, Link2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useLatestBridgeJob } from "@/lib/hooks/useBridgeJobs";
import { useResetBridgeSession } from "@/lib/hooks/useResetBridgeSession";

export function StreamView({ streamId }: { streamId: string }) {
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
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
  const setBridgeDefaults = useUiPreferencesStore(
    (state) => state.setBridgeDefaults,
  );
  const upsertBridgeSession = useUiPreferencesStore(
    (state) => state.upsertBridgeSession,
  );
  useRealtimeEntries(streamId);
  useLatestBridgeJob(streamId, 4_000);
  const resetBridgeSession = useResetBridgeSession(streamId);

  const selectedProviderId =
    bridgeSession?.providerId ?? bridgeDefaults.providerId;
  const hasActiveSession = !!bridgeSession?.isExternalSessionActive;
  const hasSessionMemory =
    !!bridgeSession?.sessionMemory.trim() ||
    !!bridgeSession?.lastInstruction.trim();
  const automationStatus = bridgeSession?.automationStatus ?? "idle";
  const shouldShowReset =
    hasSessionMemory ||
    !!bridgeSession?.lastJobId ||
    automationStatus !== "idle" ||
    hasActiveSession;
  const queueLabel =
    automationStatus === "queued"
      ? "Queued"
      : automationStatus === "running"
        ? "Running"
        : automationStatus === "needs-login"
          ? "Login"
          : automationStatus === "succeeded"
            ? "Ready"
            : automationStatus === "failed"
              ? "Failed"
              : "Idle";

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

      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-0.5 border border-border-default bg-surface-default p-2 shadow-lg backdrop-blur-md transition-all">
        <div
          className={`inline-flex h-8 items-center gap-1.5 px-2 text-[11px] font-semibold ${
            hasActiveSession
              ? "bg-status-success-bg/40 text-status-success-text"
              : "text-text-muted hover:bg-surface-hover"
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

        <div
          className={`inline-flex h-8 items-center gap-1.5 px-2 text-[11px] font-semibold ${
            automationStatus === "succeeded"
              ? "bg-status-success-bg/40 text-status-success-text"
              : automationStatus === "queued" || automationStatus === "running"
                ? "text-text-default hover:bg-surface-hover"
                : automationStatus === "needs-login" || automationStatus === "failed"
                  ? "bg-status-error-bg text-status-error-text"
                  : "text-text-muted hover:bg-surface-hover"
          }`}
          title="Latest local Gemini sidecar queue state"
        >
          <Wand2 className="h-3.5 w-3.5" />
          <span>{queueLabel}</span>
        </div>

        <label className="inline-flex h-8 items-center gap-2 px-2 text-text-default hover:bg-surface-hover">
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

        <div className="flex items-stretch gap-0.5">
          <QuickBridgeControl streamId={streamId} />
          <button
            onClick={() => {
              setIsBridgeOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 px-2 text-[11px] font-semibold text-text-default transition-all hover:bg-surface-hover hover:text-text-default"
          >
            <Sparkles className="h-4 w-4" />
            <span>Detailed</span>
          </button>
        </div>

        {shouldShowReset && (
          <button
            onClick={() => void resetBridgeSession.mutateAsync()}
            className="inline-flex items-center gap-1.5 px-2 py-2 text-[11px] font-semibold text-text-muted hover:bg-surface-hover hover:text-text-default"
            title="Reset current bridge session"
            disabled={resetBridgeSession.isPending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {resetBridgeSession.isPending ? "Resetting" : "Reset"}
            </span>
          </button>
        )}
      </div>

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
