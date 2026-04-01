"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  ModalHeader,
  ModalShell,
  type ModalFooterAction,
} from "@/components/shared/ModalShell";
import {
  ClipboardPaste,
  Globe,
  Layers3,
  Loader2,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { InteractionSwitcher } from "./InteractionSwitcher";
import { ContextBag } from "./ContextBag";
import { XMLGenerator } from "./XMLGenerator";
import { ResponseParser, type ResponseParserHandle } from "./ResponseParser";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { STREAM_KIND } from "@/lib/types";
import type { BridgeJobStatus } from "@/lib/types";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import {
  BRIDGE_PROVIDER_PRESETS,
  getBridgeSessionLaunchUrl,
  getBridgeProviderPreset,
} from "./bridge-config";
import {
  buildBridgeSessionKey,
  type BridgeRunnerStatus,
} from "@/lib/bridge/bridge-jobs";
import { useCreateBridgeJob, useLatestBridgeJob } from "@/lib/hooks/useBridgeJobs";
import { useResetBridgeSession } from "@/lib/hooks/useResetBridgeSession";
import { BridgeResponsePreviewModal } from "./BridgeResponsePreviewModal";
import { useBridgeRunnerStatus } from "@/lib/hooks/useBridgeRunnerStatus";

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamId: string;
  initialManualMode?: boolean;
}

export function BridgeModal({
  isOpen,
  onClose,
  streamId,
  initialManualMode = false,
}: BridgeModalProps) {
  void initialManualMode;
  const supabase = createClient();
  const bridgeDefaults = useUiPreferencesStore((state) => state.bridgeDefaults);
  const bridgeSession = useUiPreferencesStore(
    (state) => state.bridgeSessionsByStream[streamId],
  );
  const setBridgeDefaults = useUiPreferencesStore(
    (state) => state.setBridgeDefaults,
  );
  const upsertBridgeSession = useUiPreferencesStore(
    (state) => state.upsertBridgeSession,
  );
  const [interactionMode, setInteractionMode] = useState<"ASK" | "GO" | "BOTH">(
    bridgeSession?.lastMode ?? "ASK",
  );
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [includeCanvas, setIncludeCanvas] = useState(true);
  const [userGlobalStreamChoice, setUserGlobalStreamChoice] =
    useState<boolean>(true);
  const [userInput, setUserInput] = useState("");
  const [tokenOverLimit, setTokenOverLimit] = useState(false);
  const [generatedXML, setGeneratedXML] = useState("");
  const [payloadReady, setPayloadReady] = useState(false);
  const [pastedXML, setPastedXML] = useState("");
  const [providerId, setProviderId] = useState(
    bridgeSession?.providerId ?? bridgeDefaults.providerId,
  );
  const [parserStatus, setParserStatus] = useState({
    isApplying: false,
    canApply: false,
    canParse: false,
    hasParsed: false,
  });
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResponsePreviewOpen, setIsResponsePreviewOpen] = useState(false);

  const parserRef = useRef<ResponseParserHandle>(null);
  const currentProvider = getBridgeProviderPreset(providerId);
  const latestBridgeJob = useLatestBridgeJob(
    streamId,
    providerId,
    isOpen ? 3_000 : 8_000,
  );
  const createBridgeJob = useCreateBridgeJob(streamId);
  const resetBridgeSession = useResetBridgeSession(streamId);
  const runnerStatus = useBridgeRunnerStatus({
    enabled: isOpen,
    pollIntervalMs: isOpen ? 10_000 : undefined,
  });

  const { data: streamMeta, isLoading: isStreamMetaLoading } = useQuery({
    queryKey: ["bridge-stream-meta", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streams")
        .select("*")
        .eq("id", streamId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!streamId,
  });

  const { data: domainGlobalStreamsData, isLoading: isGlobalStreamLoading } =
    useQuery({
      queryKey: ["streams", streamMeta?.domain_id],
      queryFn: async () => {
        if (!streamMeta?.domain_id) return [];
        const { data, error } = await supabase
          .from("streams")
          .select("*")
          .eq("domain_id", streamMeta.domain_id)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true });
        if (error) throw error;
        return data ?? [];
      },
      placeholderData: [],
      enabled: !!streamMeta?.domain_id,
    });

  const isGlobal = (s: { stream_kind: string }) =>
    s.stream_kind === STREAM_KIND.GLOBAL;

  const currentStreamIsGlobal = streamMeta ? isGlobal(streamMeta) : false;
  const allDomainStreams = domainGlobalStreamsData ?? [];
  const domainGlobalStreams = allDomainStreams.filter(isGlobal);
  const domainGlobalStreamIds = domainGlobalStreams.map((stream) => stream.id);
  const includeGlobalAvailable = domainGlobalStreamIds.length > 0;
  const includeGlobalStream = includeGlobalAvailable && userGlobalStreamChoice;
  const globalStreamName =
    domainGlobalStreams.length === 1
      ? (domainGlobalStreams[0]?.name ?? null)
      : domainGlobalStreams.length > 1
        ? `${domainGlobalStreams.length} global streams`
        : null;

  const handleCopyXML = async () => {
    if (!generatedXML) return;
    await navigator.clipboard.writeText(generatedXML);
  };

  const handlePasteResult = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPastedXML(text);
        // Small delay to ensure state update is processed before parsing
        setTimeout(() => {
          parserRef.current?.parse();
        }, 50);
      }
    } catch (err) {
      console.error("Failed to read clipboard", err);
    }
  };

  const handleApply = () => parserRef.current?.apply();
  const handleReset = () => {
    setIsResetDialogOpen(true);
  };

  const resetLocalState = () => {
    setInteractionMode("ASK");
    setSelectedEntries([]);
    setIncludeCanvas(true);
    setUserGlobalStreamChoice(true);
    setUserInput("");
    setTokenOverLimit(false);
    setGeneratedXML("");
    setPastedXML("");
    setProviderId(bridgeDefaults.providerId);
    parserRef.current?.reset();
  };

  const confirmReset = async () => {
    setIsResetDialogOpen(false);
    await resetBridgeSession.mutateAsync();
    resetLocalState();
  };

  const handleOpenProvider = () => {
    if (typeof window === "undefined") return;
    const launchUrl = getBridgeSessionLaunchUrl(providerId, bridgeSession);
    window.open(launchUrl, "_blank", "noopener,noreferrer");
    setBridgeDefaults({
      providerId,
      quickPreset: bridgeDefaults.quickPreset,
    });
    upsertBridgeSession(streamId, {
      providerId,
      lastMode: interactionMode,
      lastInstruction: userInput,
      lastContextRecipe: {
        entrySelection: "last-5",
        includeCanvas,
        includeGlobalStream,
      },
      lastUsedAt: new Date().toISOString(),
      externalSessionUrl: launchUrl,
    });
  };

  const automatedResponse = latestBridgeJob.data?.raw_response?.trim() ?? "";
  const effectivePastedXML = pastedXML.trim() ? pastedXML : automatedResponse;
  const responsePreviewText = effectivePastedXML;
  const effectiveInteractionMode =
    !pastedXML.trim() && automatedResponse
      ? (bridgeSession?.lastMode ?? interactionMode)
      : interactionMode;
  const effectiveProviderId =
    !pastedXML.trim() && automatedResponse
      ? (bridgeSession?.providerId ?? providerId)
      : providerId;
  const currentSessionKey = buildBridgeSessionKey(streamId, providerId);
  const latestJobMatchesCurrentPayload =
    latestBridgeJob.data?.session_key === currentSessionKey &&
    latestBridgeJob.data?.payload === generatedXML;
  const automationStatus = bridgeSession?.automationStatus ?? "idle";
  const shouldShowReset =
    !!bridgeSession?.sessionMemory.trim() ||
    !!bridgeSession?.lastInstruction.trim() ||
    !!bridgeSession?.lastJobId ||
    automationStatus !== "idle" ||
    !!bridgeSession?.isExternalSessionActive ||
    !!pastedXML.trim() ||
    !!responsePreviewText;
  const isAutomationActive =
    automationStatus === "queued" || automationStatus === "running";
  const resetDialogTitle = isAutomationActive
    ? "Stop and reset this bridge run?"
    : "Clear all inputs and results?";
  const resetDialogDescription = isAutomationActive
    ? "This stops the active bridge run, clears the current bridge session, and removes queued or running jobs for this stream."
    : "This resets your instructions and parsed output. Changes cannot be undone.";

  const handleDone = () => {
    setBridgeDefaults({
      providerId,
      quickPreset: bridgeDefaults.quickPreset,
    });
    upsertBridgeSession(streamId, {
      providerId,
      lastMode: interactionMode,
      lastInstruction: userInput,
      lastContextRecipe: {
        entrySelection: "last-5",
        includeCanvas,
        includeGlobalStream,
      },
      lastUsedAt: new Date().toISOString(),
    });
    onClose();
  };

  const handleQueueDetailed = async () => {
    if (!payloadReady || !generatedXML.trim()) return;
    if (
      latestJobMatchesCurrentPayload &&
      (latestBridgeJob.data?.status === "queued" ||
        latestBridgeJob.data?.status === "running")
    ) {
      return;
    }

    const result = await createBridgeJob.mutateAsync({
      provider: providerId,
      payload: generatedXML,
      payloadVariant: bridgeSession?.isExternalSessionActive ? "followup" : "full",
      sessionKey: currentSessionKey,
      runnerDetails: {
        source: "detailed-bridge",
      },
    });

    setBridgeDefaults({
      providerId,
      quickPreset: bridgeDefaults.quickPreset,
    });
    upsertBridgeSession(streamId, {
      providerId,
      lastMode: interactionMode,
      lastInstruction: userInput,
      lastContextRecipe: {
        entrySelection: "last-5",
        includeCanvas,
        includeGlobalStream,
      },
      lastUsedAt: new Date().toISOString(),
      automationSessionKey: currentSessionKey,
      automationStatus: "queued",
      lastJobId: result.job.id,
      lastJobStatus: result.job.status as BridgeJobStatus,
      lastJobError: "",
      sentEntryIds: selectedEntries,
    });
  };
  const responseText = latestBridgeJob.data?.raw_response?.trim() ?? "";
  const hasPendingResponse =
    !!bridgeSession &&
    latestBridgeJob.data?.status === "succeeded" &&
    !!responseText &&
    latestBridgeJob.data?.id !== bridgeSession?.lastAppliedJobId;
  const isApplyingLatestAutomatedResponse =
    hasPendingResponse &&
    !pastedXML.trim() &&
    !!latestBridgeJob.data?.id;

  const isContinuing =
    !!bridgeSession &&
    (bridgeSession?.isExternalSessionActive ||
      latestBridgeJob.data?.status === "succeeded");

  const queueStatus = bridgeSession?.automationStatus ?? "idle";

  const phase =
    !runnerStatus.online && !runnerStatus.isChecking && !hasPendingResponse
      ? "send"
      : hasPendingResponse
        ? "apply"
        : bridgeSession?.automationStatus === "queued" ||
          bridgeSession?.automationStatus === "running"
          ? "waiting"
          : "send";

  // Sync job status back to session preferences
  useEffect(() => {
    if (
      latestBridgeJob.data?.status &&
      latestBridgeJob.data.status !== bridgeSession?.automationStatus
    ) {
      upsertBridgeSession(streamId, {
        automationStatus: latestBridgeJob.data.status as BridgeRunnerStatus,
        lastJobId: latestBridgeJob.data.id,
        lastJobStatus: latestBridgeJob.data.status as BridgeJobStatus,
        lastJobError: latestBridgeJob.data.error_message || "",
        lastJobCompletedAt: latestBridgeJob.data.completed_at || null,
      });
    }
  }, [
    latestBridgeJob.data?.status,
    latestBridgeJob.data?.id,
    latestBridgeJob.data?.error_message,
    latestBridgeJob.data?.completed_at,
    streamId,
    bridgeSession?.automationStatus,
    upsertBridgeSession,
  ]);



  const label =
    !runnerStatus.online && !runnerStatus.isChecking
      ? "Manual"
      : phase === "waiting"
        ? "Waiting"
        : phase === "apply"
          ? parserStatus.isApplying
            ? "Applying"
            : "Apply"
          : isContinuing
            ? "Continue"
            : "Quick";

  const detail =
    !runnerStatus.online && !runnerStatus.isChecking
      ? "Runner offline"
      : phase === "apply"
        ? "Apply latest response"
        : phase === "waiting"
          ? queueStatus === "running"
            ? "Executing"
            : "Queued"
          : isContinuing
            ? "Continue current session"
            : "Send full detailed payload";

  const icon =
    phase === "waiting" || parserStatus.isApplying ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <Wand2 className="h-4 w-4" />
    );

  const buttonDisabled =
    phase === "waiting" ||
    (phase === "send" &&
      (!payloadReady || !generatedXML.trim()) &&
      runnerStatus.online) ||
    (phase === "apply" && !hasPendingResponse) ||
    createBridgeJob.isPending ||
    resetBridgeSession.isPending ||
    parserStatus.isApplying;

  const handleActionClick = () => {
    if (phase === "waiting" || parserStatus.isApplying) return;

    if (!runnerStatus.online && !runnerStatus.isChecking) {
      // Stay in manual mode, user handles XML manually
      return;
    }

    if (phase === "apply") {
      void handleApply();
      return;
    }

    void handleQueueDetailed();
  };

  const footerActions: ModalFooterAction[] = [
    ...(shouldShowReset
      ? [
        {
          label: resetBridgeSession.isPending
            ? "Stopping..."
            : isAutomationActive
              ? "Stop & Reset"
              : "Reset",
          onClick: handleReset,
          disabled: resetBridgeSession.isPending,
          tone: "secondary" as const,
        },
      ]
      : []),
    {
      label: "Done",
      onClick: handleDone,
      tone: "secondary" as const,
    },
    {
      label,
      title: `${label} · ${detail}`,
      icon,
      onClick: handleActionClick,
      disabled: buttonDisabled,
      tone: phase === "waiting" ? ("secondary" as const) : ("primary" as const),
      "data-phase": phase === "send" || phase === "apply" ? "active" : "idle",
    },
  ];

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={onClose}
        panelClassName="mx-auto flex max-h-[90vh] w-full flex-col overflow-hidden"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        footerActions={footerActions}
      >
        <ModalHeader
          title="Detailed Bridge"
          description="Build the payload, choose context deliberately, then bring the AI response back here to parse and apply."
          icon={<Sparkles className="h-5 w-5" />}
          onClose={onClose}
          meta={
            streamMeta?.name ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                <span>on</span>
                <span className="font-semibold text-text-default">
                  {streamMeta.name}
                </span>
                {currentStreamIsGlobal && (
                  <div className="flex items-center gap-1 border border-border-subtle bg-primary-950 px-2 py-0.5 text-[10px] font-semibold text-action-primary-bg">
                    <Globe className="h-3 w-3" />
                    Global
                  </div>
                )}
              </div>
            ) : null
          }
        />

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
          {/* Left Sidebar: Configuration & Context */}
          <aside className="w-full lg:w-[320px] xl:w-95 shrink-0 border-b lg:border-b-0 lg:border-r border-border-default overflow-y-auto bg-surface-subtle flex flex-col">
            <div className="flex flex-col p-4 divide-y divide-border-default">
              {/* Goal Section */}
              <section className="min-w-0 py-4 first:pt-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-text-muted mb-4">
                  <Layers3 className="h-3 w-3" />
                  Execution Goal
                </div>
                <InteractionSwitcher
                  value={interactionMode}
                  onChange={setInteractionMode}
                  selectedEntries={selectedEntries}
                  includeCanvas={includeCanvas}
                  streamId={streamId}
                  includeGlobalStream={includeGlobalStream}
                  globalStreamIds={
                    includeGlobalAvailable ? domainGlobalStreamIds : []
                  }
                  onTokenUpdate={(count, over) => {
                    setTokenOverLimit(over);
                  }}
                  onReduceSelection={() =>
                    setSelectedEntries((prev) => prev.slice(0, 5))
                  }
                  onAutoSummarize={() => setIncludeCanvas(false)}
                />
              </section>

              {/* Destination Section */}
              <section className="min-w-0 py-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    <Send className="h-3 w-3" />
                    Provider
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="border border-border-subtle bg-surface-hover px-1.5 py-0.5 text-[9px] font-bold tracking-tighter text-text-muted uppercase">
                      {currentProvider.hostLabel}
                    </span>
                    {bridgeSession?.sessionMemory && (
                      <span className="border border-border-subtle bg-action-primary-bg/10 px-1.5 py-0.5 text-[9px] font-bold tracking-tighter text-action-primary-bg uppercase">
                        Memory Active
                      </span>
                    )}
                  </div>
                </div>
                <select
                  value={providerId}
                  onChange={(event) =>
                    setProviderId(event.target.value as typeof providerId)
                  }
                  className="w-full border border-border-default bg-surface-default px-2 py-1.5 text-xs text-text-default focus:border-action-primary-bg outline-none"
                >
                  {BRIDGE_PROVIDER_PRESETS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </section>

              {/* Context Section */}
              <section className="min-w-0 py-4 last:pb-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-text-muted mb-4">
                  <Sparkles className="h-3 w-3" />
                  Context Material
                </div>
                <ContextBag
                  streamId={streamId}
                  selectedEntries={selectedEntries}
                  onSelectionChange={setSelectedEntries}
                  sentEntryIds={bridgeSession?.sentEntryIds ?? []}
                  lastUsedAt={bridgeSession?.lastUsedAt ?? null}
                  includeCanvas={includeCanvas}
                  onIncludeCanvasChange={setIncludeCanvas}
                  includeGlobalStream={userGlobalStreamChoice}
                  onIncludeGlobalStreamChange={setUserGlobalStreamChoice}
                  globalStreamName={globalStreamName}
                  globalStreamDisabled={
                    currentStreamIsGlobal || !includeGlobalAvailable
                  }
                  globalStreamLoading={
                    isStreamMetaLoading || isGlobalStreamLoading
                  }
                  currentStreamIsGlobal={currentStreamIsGlobal}
                  disableSelectAll={tokenOverLimit}
                />
              </section>
            </div>
          </aside>

          {/* Main Execution Area */}
          <main className="flex-1 min-w-0 overflow-y-auto bg-surface-default flex flex-col">
            <div className="flex flex-col gap-6 p-6 flex-1 min-h-0">
              {!runnerStatus.online && (
                <section className="border border-status-error-border bg-status-error-bg p-4 text-sm text-status-error-text">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-xs uppercase tracking-wider">
                        Runner Offline — Manual Handoff
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed opacity-90">
                        Copy the payload, run it in {currentProvider.label}, then paste the response below.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runnerStatus.checkNow()}
                      disabled={runnerStatus.isChecking}
                      className="inline-flex items-center gap-2 border border-status-error-border bg-surface-default/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-status-error-text whitespace-nowrap"
                    >
                      {runnerStatus.isChecking ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      {runnerStatus.isChecking ? "Checking..." : "Retry"}
                    </button>
                  </div>
                </section>
              )}

              {phase !== "apply" && (
                <>
                  {/* Step 0: Request */}
                  <section className="min-w-0 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted">
                        <Settings2 className="h-3.5 w-3.5" />
                        1. Instructions
                      </div>
                    </div>
                    <textarea
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      placeholder="What should the AI accomplish with this context?"
                      className="min-h-17.5 w-full resize-none border border-border-default bg-surface-subtle px-4 py-3 text-sm leading-relaxed text-text-default placeholder:text-text-muted focus:border-action-primary-bg outline-none"
                    />
                  </section>

                  {/* Step 2: Payload Generation */}
                  <section className="min-w-0 flex flex-col gap-0 flex-1 min-h-0">
                    <div className="flex flex-col items-start gap-3 pb-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted">
                          2. Build Payload
                        </div>
                        <p className="text-[11px] text-text-muted max-w-sm">
                          {runnerStatus.online
                            ? "Process this through the local runner or use the manual handoff tags below."
                            : "Copy the generated prompt and send it to the provider manually."}
                        </p>
                      </div>
                      {!runnerStatus.online && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={handleCopyXML}
                            className="border border-border-default bg-surface-default px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-text-default hover:bg-surface-elevated transition-colors"
                          >
                            Copy Prompt
                          </button>
                          <button
                            onClick={handleOpenProvider}
                            className="bg-action-primary-bg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-action-primary-text hover:bg-action-primary-hover transition-colors"
                          >
                            Open {currentProvider.label}
                          </button>
                        </div>
                      )}
                    </div>
                    <XMLGenerator
                      interactionMode={interactionMode}
                      selectedEntries={selectedEntries}
                      includeCanvas={includeCanvas}
                      includeGlobalStream={includeGlobalStream}
                      globalStreamIds={
                        includeGlobalAvailable ? domainGlobalStreamIds : []
                      }
                      globalStreamName={globalStreamName}
                      userInput={userInput}
                      streamId={streamId}
                      sessionLoadedAt={bridgeSession?.externalSessionLoadedAt}
                      onXMLGenerated={setGeneratedXML}
                      onPayloadReadyChange={setPayloadReady}
                    />
                  </section>
                </>
              )}

              {(phase === "apply" || !runnerStatus.online || !!pastedXML) && (
                /* Step 3: Response Handling */
                <section className="min-w-0 flex flex-col gap-0 flex-1 min-h-0">
                  <div className="flex flex-wrap items-start justify-between gap-4 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted">
                        3. Apply Response
                      </div>
                      <p className="text-[11px] text-text-muted max-w-sm">
                        {(!runnerStatus.online || !!pastedXML)
                          ? "Review changes and apply them back to your workspace."
                          : "Once a response is received, it will be parsed and displayed here for review."}
                      </p>
                    </div>
                    {(!runnerStatus.online && !pastedXML) && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={handlePasteResult}
                          className="inline-flex items-center gap-2 bg-action-primary-bg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-action-primary-text hover:bg-action-primary-hover transition-colors"
                        >
                          <ClipboardPaste className="h-3 w-3" />
                          Import Response
                        </button>
                      </div>
                    )}
                  </div>

                  <ResponseParser
                    ref={parserRef}
                    streamId={streamId}
                    interactionMode={effectiveInteractionMode}
                    aiPersonaLabel={getBridgeProviderPreset(effectiveProviderId).label}
                    pastedXML={effectivePastedXML}
                    onPastedXMLChange={setPastedXML}
                    onStatusChange={setParserStatus}
                    onApplySuccess={() => {
                      if (isApplyingLatestAutomatedResponse && latestBridgeJob.data?.id) {
                        upsertBridgeSession(streamId, {
                          lastAppliedJobId: latestBridgeJob.data.id,
                          automationStatus: "succeeded",
                          lastJobId: latestBridgeJob.data.id,
                          lastJobStatus: latestBridgeJob.data.status as BridgeJobStatus,
                          lastJobError: latestBridgeJob.data.error_message ?? "",
                          lastJobCompletedAt: latestBridgeJob.data.completed_at ?? null,
                        });
                      }
                      setParserStatus((prev) => ({ ...prev, isApplying: false }));
                      setUserInput("");
                      onClose();
                    }}
                  />

                </section>
              )}
            </div>
          </main>
        </div>
      </ModalShell>
      <ConfirmDialog
        open={isResetDialogOpen}
        title={resetDialogTitle}
        description={resetDialogDescription}
        confirmLabel="Clear"
        cancelLabel="Cancel"
        destructive
        loading={resetBridgeSession.isPending}
        onCancel={() => setIsResetDialogOpen(false)}
        onConfirm={() => void confirmReset()}
      />
      <BridgeResponsePreviewModal
        open={isResponsePreviewOpen}
        onClose={() => setIsResponsePreviewOpen(false)}
        title="Bridge Response Preview"
        description="Raw response available to parse or compare before applying changes."
        responseText={responsePreviewText}
      />
    </>
  );
}
