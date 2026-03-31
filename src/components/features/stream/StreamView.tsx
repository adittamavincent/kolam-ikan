"use client";

import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
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
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import {
  Check,
  ChevronDown,
  Globe,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useLatestBridgeJob } from "@/lib/hooks/useBridgeJobs";
import { useResetBridgeSession } from "@/lib/hooks/useResetBridgeSession";

interface BridgeModalSeed {
  openedFromQuickManual?: boolean;
}

export function StreamView({ streamId }: { streamId: string }) {
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const [bridgeModalSeed, setBridgeModalSeed] = useState<BridgeModalSeed | null>(null);
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
  const setBridgeDefaults = useUiPreferencesStore(
    (state) => state.setBridgeDefaults,
  );
  const defaultProviderId = useUiPreferencesStore(
    (state) => state.bridgeDefaults.providerId,
  );
  const upsertBridgeSession = useUiPreferencesStore(
    (state) => state.upsertBridgeSession,
  );
  const hasHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  useRealtimeEntries(streamId);

  const effectiveBridgeSession = hasHydrated ? bridgeSession : undefined;
  const selectedProviderId =
    effectiveBridgeSession?.providerId ?? defaultProviderId;
  const selectedProviderLabel =
    BRIDGE_PROVIDER_PRESETS.find((provider) => provider.id === selectedProviderId)
      ?.label ?? "Gemini";
  useLatestBridgeJob(streamId, selectedProviderId, 4_000);
  const resetBridgeSession = useResetBridgeSession(streamId);
  const hasActiveSession = !!effectiveBridgeSession?.isExternalSessionActive;
  const hasSessionMemory =
    !!effectiveBridgeSession?.sessionMemory.trim() ||
    !!effectiveBridgeSession?.lastInstruction.trim();
  const automationStatus = effectiveBridgeSession?.automationStatus ?? "idle";
  const isAutomationActive =
    automationStatus === "queued" || automationStatus === "running";
  const shouldShowReset =
    hasSessionMemory ||
    !!effectiveBridgeSession?.lastJobId ||
    automationStatus !== "idle" ||
    hasActiveSession;

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
        <Menu as="div" className="relative">
          <MenuButton
            className="inline-flex h-8 items-center gap-2 px-2 text-text-default transition-all hover:bg-surface-hover focus:"
            title="Preferred web LLM"
            aria-label="Preferred web LLM"
          >
            <Globe className="h-3.5 w-3.5 text-text-muted" />
            <span className="text-[11px] font-semibold text-text-default">
              {selectedProviderLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
          </MenuButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <MenuItems
              anchor={{ to: "bottom end", gap: 6 }}
              portal
              className="z-9999 w-44 overflow-hidden border border-border-default bg-surface-elevated p-1 focus:"
            >
              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                Preferred web LLM
              </div>
              {BRIDGE_PROVIDER_PRESETS.map((provider) => (
                <MenuItem key={provider.id}>
                  {({ focus }) => (
                    <button
                      type="button"
                      onClick={() => {
                        const providerId = provider.id;
                        setBridgeDefaults({ providerId });
                        if (effectiveBridgeSession) {
                          upsertBridgeSession(streamId, { providerId });
                        }
                      }}
                      className={`${
                        focus
                          ? "bg-surface-subtle text-text-default"
                          : "text-text-subtle"
                      } flex w-full items-center justify-between px-2 py-1.5 text-xs transition-all duration-200`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Globe className="h-3 w-3" />
                        {provider.label}
                      </span>
                      {selectedProviderId === provider.id && (
                        <Check className="h-3 w-3 text-action-primary-bg" />
                      )}
                    </button>
                  )}
                </MenuItem>
              ))}
            </MenuItems>
          </Transition>
        </Menu>

        <div className="flex items-stretch gap-0.5">
          <QuickBridgeControl
            streamId={streamId}
            onOpenDetailed={() => {
              setBridgeModalSeed({ openedFromQuickManual: true });
              setIsBridgeOpen(true);
            }}
          />
          <button
            onClick={() => {
              setBridgeModalSeed(null);
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
            title={
              isAutomationActive
                ? "Stop and reset current bridge session"
                : "Reset current bridge session"
            }
            disabled={resetBridgeSession.isPending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {resetBridgeSession.isPending
                ? "Stopping"
                : isAutomationActive
                  ? "Stop"
                  : "Reset"}
            </span>
          </button>
        )}
      </div>

      <BridgeModal
        isOpen={isBridgeOpen}
        onClose={() => {
          setIsBridgeOpen(false);
          setBridgeModalSeed(null);
        }}
        streamId={streamId}
        initialManualMode={bridgeModalSeed?.openedFromQuickManual ?? false}
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
