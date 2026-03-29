"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  Loader2,
  Rocket,
  Settings2,
  Wand2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ModalHeader,
  ModalShell,
  type ModalFooterAction,
} from "@/components/shared/ModalShell";
import { STREAM_KIND } from "@/lib/types";
import type { BridgeJobStatus } from "@/lib/types";
import { XMLGenerator } from "./XMLGenerator";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  BRIDGE_PROVIDER_PRESETS,
  buildQuickBridgePreset,
  composeBridgeInstruction,
  getBridgeSessionLaunchUrl,
  getQuickPayloadVariant,
  getBridgeProviderPreset,
} from "./bridge-config";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import { buildBridgeSessionKey } from "@/lib/bridge/bridge-jobs";
import { useCreateBridgeJob, useLatestBridgeJob } from "@/lib/hooks/useBridgeJobs";
import { BridgeResponsePreviewModal } from "./BridgeResponsePreviewModal";
import { useResetBridgeSession } from "@/lib/hooks/useResetBridgeSession";

interface QuickBridgeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDetailed: () => void;
  streamId: string;
}

type QuickLaunchState =
  | "idle"
  | "queueing"
  | "queued"
  | "launching"
  | "done"
  | "opened"
  | "error";

type QuickPhase = "compose" | "waiting" | "accepting";

export function QuickBridgeDialog({
  isOpen,
  onClose,
  onOpenDetailed,
  streamId,
}: QuickBridgeDialogProps) {
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

  const [providerId, setProviderId] = useState(
    bridgeSession?.providerId ?? bridgeDefaults.providerId,
  );
  const [instruction, setInstruction] = useState(
    bridgeSession?.lastInstruction ?? "",
  );
  const [generatedXML, setGeneratedXML] = useState("");
  const [payloadReady, setPayloadReady] = useState(false);
  const [launchState, setLaunchState] = useState<QuickLaunchState>("idle");
  const [isResponsePreviewOpen, setIsResponsePreviewOpen] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const createBridgeJob = useCreateBridgeJob(streamId);
  const resetBridgeSession = useResetBridgeSession(streamId);

  const { data: streamMeta } = useQuery({
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
    enabled: isOpen && !!streamId,
  });

  const { data: domainGlobalStreamsData = [] } = useQuery({
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
    enabled: isOpen && !!streamMeta?.domain_id,
  });

  const { data: recentEntries = [] } = useQuery({
    queryKey: ["bridge-quick-entries", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entries")
        .select("id, created_at")
        .eq("stream_id", streamId)
        .eq("is_draft", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: isOpen && !!streamId,
  });

  const { data: canvas } = useQuery({
    queryKey: ["bridge-quick-canvas", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvases")
        .select("content_json")
        .eq("stream_id", streamId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: isOpen && !!streamId,
  });

  const currentStreamIsGlobal = streamMeta?.stream_kind === STREAM_KIND.GLOBAL;
  const domainGlobalStreams = domainGlobalStreamsData.filter(
    (stream) => stream.stream_kind === STREAM_KIND.GLOBAL,
  );
  const domainGlobalStreamIds = domainGlobalStreams.map((stream) => stream.id);
  const includeGlobalAvailable = domainGlobalStreamIds.length > 0;
  const quickPreset = buildQuickBridgePreset(bridgeSession);
  const selectedEntries = useMemo(
    () => recentEntries.map((entry) => entry.id),
    [recentEntries],
  );
  const includeCanvas =
    quickPreset.includeCanvas &&
    Array.isArray(canvas?.content_json) &&
    canvas.content_json.length > 0;
  const includeGlobalStream =
    quickPreset.includeGlobalStream &&
    includeGlobalAvailable &&
    !currentStreamIsGlobal;
  const effectiveInstruction = composeBridgeInstruction(
    instruction,
    bridgeSession?.sessionMemory ?? "",
  );
  const hasReusableInstruction = !!bridgeSession?.lastInstruction.trim();
  const providerPreset = getBridgeProviderPreset(providerId);
  const latestBridgeJob = useLatestBridgeJob(
    streamId,
    providerId,
    isOpen ? 3_000 : 8_000,
  );
  const payloadVariant = getQuickPayloadVariant(bridgeSession);
  const isFollowupLaunch = payloadVariant === "followup";
  const queueStatus = bridgeSession?.automationStatus ?? "idle";
  const latestJob = latestBridgeJob.data;
  const currentSessionKey = buildBridgeSessionKey(streamId, providerId);
  const latestJobMatchesCurrentPayload =
    latestJob?.session_key === currentSessionKey && latestJob?.payload === generatedXML;
  const responseText = latestJob?.raw_response?.trim() ?? "";

  const phase: QuickPhase =
    queueStatus === "succeeded" && responseText
      ? "accepting"
      : launchState === "queueing" ||
          launchState === "queued" ||
          queueStatus === "queued" ||
          queueStatus === "running" ||
          launchState === "launching" ||
          launchState === "done" ||
          launchState === "opened"
        ? "waiting"
        : "compose";

  const queueQuickBridge = async () => {
    if (!payloadReady || !generatedXML.trim()) return;
    if (
      latestJobMatchesCurrentPayload &&
      (latestJob?.status === "queued" || latestJob?.status === "running")
    ) {
      setLaunchState("queued");
      return;
    }

    try {
      setLaunchState("queueing");
      const result = await createBridgeJob.mutateAsync({
        provider: providerId,
        payload: generatedXML,
        payloadVariant,
        sessionKey: currentSessionKey,
        runnerDetails: {
          source: "quick-bridge",
        },
      });

      setBridgeDefaults({
        providerId,
        quickPreset: "recommended",
      });
      upsertBridgeSession(streamId, {
        providerId,
        lastMode: quickPreset.interactionMode,
        lastInstruction: instruction,
        lastContextRecipe: {
          entrySelection: "all",
          includeCanvas,
          includeGlobalStream,
        },
        lastUsedAt: new Date().toISOString(),
        automationSessionKey: currentSessionKey,
        automationStatus: "queued",
        lastJobId: result.job.id,
        lastJobStatus: result.job.status as BridgeJobStatus,
        lastJobError: "",
      });
      setLaunchState("queued");
    } catch {
      setLaunchState("error");
    }
  };

  const waitingHeadline =
    queueStatus === "running"
      ? `${providerPreset.label} is generating a response`
      : `Payload queued for the ${providerPreset.label} runner`;

  const waitingDescription =
    queueStatus === "running"
      ? `The runner is inside ${providerPreset.label} now. You can leave this open, close it, or come back later.`
      : "Kolam Ikan has packed the payload. The local runner will claim it and start the browser work.";

  const resetLocalState = () => {
    setProviderId(bridgeDefaults.providerId);
    setInstruction("");
    setGeneratedXML("");
    setPayloadReady(false);
    setLaunchState("idle");
    setIsResponsePreviewOpen(false);
  };

  const confirmReset = async () => {
    setIsResetDialogOpen(false);
    await resetBridgeSession.mutateAsync();
    resetLocalState();
  };
  const footerActions: ModalFooterAction[] = [
    ...(phase !== "compose"
      ? [
          {
            label: resetBridgeSession.isPending
              ? "Resetting..."
              : phase === "waiting"
                ? "Abort & Reset"
                : "Reset",
            onClick: () => setIsResetDialogOpen(true),
            disabled: resetBridgeSession.isPending,
            tone: "danger" as const,
          },
        ]
      : []),
    {
      label: phase === "compose" ? "Cancel" : "Close",
      onClick: onClose,
      tone: "secondary" as const,
    },
    ...(phase === "compose"
      ? [
          {
            label: `Queue to ${providerPreset.label}`,
            icon:
              launchState === "launching" || launchState === "queueing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              ),
            onClick: () => void queueQuickBridge(),
            disabled:
              !instruction.trim() ||
              !generatedXML.trim() ||
              !payloadReady ||
              launchState === "launching" ||
              launchState === "queueing" ||
              createBridgeJob.isPending,
            tone: "primary" as const,
          },
        ]
      : []),
    ...(phase === "accepting"
      ? [
          {
            label: "View response",
            icon: <Rocket className="h-4 w-4" />,
            onClick: () => setIsResponsePreviewOpen(true),
            tone: "primary" as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={onClose}
        panelClassName="flex max-h-[90vh] w-full flex-col overflow-hidden"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        footerActions={footerActions}
      >
        <ModalHeader
          title="Quick Bridge"
          description={
            phase === "compose"
                ? "Fast lane for repeat AI runs with a remembered destination and a recommended context bundle."
              : phase === "waiting"
                ? "Your prompt is out of your hands now. Quick keeps the status focused while the runner or provider works."
                : "The response is back. Review it here without jumping into Detailed."
          }
          icon={<Wand2 className="h-5 w-5" />}
          onClose={onClose}
          meta={
            <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-text-muted">
              <span className="border border-border-subtle bg-surface-subtle px-2 py-1">
                {phase === "compose"
                  ? "Compose"
                  : phase === "waiting"
                    ? "Waiting"
                    : "Review"}
              </span>
              <span className="border border-border-subtle bg-surface-subtle px-2 py-1">
                {isFollowupLaunch ? "Continue" : "Full Context"}
              </span>
            </div>
          }
        />

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {phase === "compose" && (
            <>
              <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="min-w-0 space-y-4">
                  {launchState === "error" && (
                    <div className="border border-status-error-border bg-status-error-bg p-4 text-xs text-status-error-text">
                      Quick could not open or queue the provider handoff. You can still use the fallback copy/open controls below.
                    </div>
                  )}

                  {queueStatus === "needs-login" && (
                    <div className="border border-status-error-border bg-status-error-bg p-4 text-xs text-status-error-text">
                      {providerPreset.label} needs you to log in again in the runner browser profile before Quick can continue.
                    </div>
                  )}

                  {queueStatus === "failed" && bridgeSession?.lastJobError && (
                    <div className="border border-status-error-border bg-status-error-bg p-4 text-xs text-status-error-text">
                      Last {providerPreset.label} bridge job failed: {bridgeSession.lastJobError}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-text-default">
                      Current request
                    </label>
                    <textarea
                      value={instruction}
                      onChange={(event) => setInstruction(event.target.value)}
                      rows={4}
                      placeholder="What should the AI help you do next?"
                      className="w-full resize-y border border-border-default bg-surface-hover px-4 py-3 text-sm text-text-default placeholder:text-text-muted"
                    />
                    <p className="text-xs text-text-muted">
                      {hasReusableInstruction
                        ? "Using your last stream instruction. Edit it here if this run should change."
                        : "Add a short request once, then Quick can reuse it on future runs."}
                    </p>
                  </div>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-text-default">
                      Destination
                    </span>
                    <select
                      value={providerId}
                      onChange={(event) =>
                        setProviderId(event.target.value as typeof providerId)
                      }
                      className="w-full border border-border-default bg-surface-hover px-3 py-2 text-sm text-text-default"
                    >
                      {BRIDGE_PROVIDER_PRESETS.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="min-w-0 space-y-3 border border-border-default bg-surface-subtle p-4">
                  <div>
                    <div className="text-sm font-semibold text-text-default">
                      Session + context
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-text-muted">
                      <div>
                        {isFollowupLaunch
                          ? "Active bridge session: follow-up payload"
                          : "No active bridge session: full payload"}
                      </div>
                      <div>{selectedEntries.length || 0} recent entries</div>
                      <div>
                        {includeCanvas ? "Current canvas included" : "Canvas skipped"}
                      </div>
                      <div>
                        {includeGlobalStream
                          ? "Domain global stream included"
                          : "Global stream skipped"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-text-default">
                      Session memory
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                      {bridgeSession?.sessionMemory ||
                        "No remembered bridge context yet."}
                    </p>
                  </div>

                  <div className="border border-border-default bg-surface-default p-3 text-xs text-text-muted">
                    Quick will enqueue a bridge job for the local runner. Manual copy/open fallback stays available if you need it.
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenDetailed();
                      }}
                      className="inline-flex items-center gap-2 border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Open Detailed
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <XMLGenerator
                  compact
                  streamId={streamId}
                  interactionMode={quickPreset.interactionMode}
                  selectedEntries={selectedEntries}
                  includeCanvas={includeCanvas}
                  includeGlobalStream={includeGlobalStream}
                  globalStreamIds={domainGlobalStreamIds}
                  globalStreamName={
                    domainGlobalStreams.length === 1
                      ? (domainGlobalStreams[0]?.name ?? null)
                      : domainGlobalStreams.length > 1
                        ? `${domainGlobalStreams.length} global streams`
                        : null
                  }
                  userInput={effectiveInstruction}
                  payloadVariant={payloadVariant}
                  sessionLoadedAt={bridgeSession?.externalSessionLoadedAt}
                  onXMLGenerated={setGeneratedXML}
                  onPayloadReadyChange={setPayloadReady}
                />
              </div>
            </>
          )}

          {phase === "waiting" && (
            <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-5 py-6">
              <section className="border border-border-default bg-surface-subtle p-6">
                <div className="flex items-start gap-4">
                  {queueStatus === "running" || launchState === "queueing" ? (
                    <Loader2 className="mt-1 h-6 w-6 animate-spin text-action-primary-bg" />
                  ) : (
                    <CheckCircle2 className="mt-1 h-6 w-6 text-action-primary-bg" />
                  )}
                  <div className="space-y-2">
                    <div className="text-lg font-semibold text-text-default">
                      {waitingHeadline}
                    </div>
                    <p className="text-sm text-text-muted">
                      {waitingDescription}
                    </p>
                    {latestJob?.id && (
                      <div className="text-[11px] text-text-muted">
                        Job: {latestJob.id}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="grid min-w-0 gap-3 md:grid-cols-3">
                <div className="border border-border-default bg-surface-subtle p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Step 1
                  </div>
                  <div className="mt-2 text-sm font-semibold text-text-default">
                    Compose
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Prompt and context were packed for this stream.
                  </p>
                </div>
                <div className="border border-border-default bg-surface-subtle p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Step 2
                  </div>
                  <div className="mt-2 text-sm font-semibold text-text-default">
                    Waiting
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    The local runner is claiming or running the request.
                  </p>
                </div>
                <div className="border border-border-default bg-surface-subtle p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Step 3
                  </div>
                  <div className="mt-2 text-sm font-semibold text-text-default">
                    Review
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Once the reply lands, Quick switches to a clean response view.
                  </p>
                </div>
              </section>

              <section className="border border-border-default bg-surface-subtle p-4">
                <div className="text-sm font-semibold text-text-default">
                  Manual fallback
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(generatedXML)}
                    className="inline-flex items-center gap-2 border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Copy payload again
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        getBridgeSessionLaunchUrl(providerId, bridgeSession),
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    className="inline-flex items-center gap-2 border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Reopen {providerPreset.label}
                  </button>
                </div>
              </section>
            </div>
          )}

          {phase === "accepting" && (
            <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-5 py-6">
              <section className="border border-status-success-bg bg-status-success-bg/40 p-6">
                <div className="flex items-start gap-4">
                  <CheckCircle2 className="mt-1 h-6 w-6 text-status-success-text" />
                  <div className="space-y-2">
                    <div className="text-lg font-semibold text-status-success-text">
                      Response captured successfully
                    </div>
                    <p className="text-sm text-text-default">
                      Quick has the raw provider response now. Review it in a focused preview modal, or open Detailed if you want to parse and apply changes.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsResponsePreviewOpen(true)}
                        className="inline-flex items-center gap-2 bg-action-primary-bg px-3 py-2 text-xs font-semibold text-action-primary-text hover:bg-action-primary-hover"
                      >
                        View response
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenDetailed();
                        }}
                        className="inline-flex items-center gap-2 border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        Open Detailed
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid min-w-0 gap-3 md:grid-cols-2">
                <div className="border border-border-default bg-surface-subtle p-4">
                  <div className="text-sm font-semibold text-text-default">
                    Session status
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    The local runner finished this run and returned the response to Kolam Ikan.
                  </p>
                </div>
                <div className="border border-border-default bg-surface-subtle p-4">
                  <div className="text-sm font-semibold text-text-default">
                    Next move
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    Stay in Quick to inspect the response, or switch to Detailed only when you want parser/apply tools.
                  </p>
                </div>
              </section>
            </div>
          )}
        </div>

      </ModalShell>

      <BridgeResponsePreviewModal
        open={isResponsePreviewOpen}
        onClose={() => setIsResponsePreviewOpen(false)}
        title="Quick Bridge Response"
        description="Raw response returned by the provider for this Quick Bridge run."
        responseText={responseText}
      />
      <ConfirmDialog
        open={isResetDialogOpen}
        title={phase === "waiting" ? "Abort and reset this Quick Bridge run?" : "Reset this Quick Bridge session?"}
        description={
          phase === "waiting"
            ? "This clears the current bridge session and removes queued or running jobs for this stream."
            : "This clears the current bridge session, response, and related bridge jobs for this stream."
        }
        confirmLabel={phase === "waiting" ? "Abort & Reset" : "Reset"}
        cancelLabel="Cancel"
        destructive
        loading={resetBridgeSession.isPending}
        onCancel={() => setIsResetDialogOpen(false)}
        onConfirm={() => void confirmReset()}
      />
    </>
  );
}
