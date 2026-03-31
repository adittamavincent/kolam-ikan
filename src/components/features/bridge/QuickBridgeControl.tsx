"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wand2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { STREAM_KIND, type BridgeJobStatus } from "@/lib/types";
import {
  buildQuickBridgePreset,
  composeBridgeInstruction,
  getBridgeProviderPreset,
  getQuickPayloadVariant,
} from "./bridge-config";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import { buildBridgeSessionKey } from "@/lib/bridge/bridge-jobs";
import { useCreateBridgeJob, useLatestBridgeJob } from "@/lib/hooks/useBridgeJobs";
import { XMLGenerator } from "./XMLGenerator";
import { ResponseParser, type ResponseParserHandle } from "./ResponseParser";

type QuickPhase = "send" | "waiting" | "apply";
type QuickLaunchState =
  | "idle"
  | "queueing"
  | "queued"
  | "launching"
  | "done"
  | "opened"
  | "error";

interface QuickBridgeControlProps {
  streamId: string;
}

const INITIAL_PARSER_STATUS = {
  isApplying: false,
  canApply: false,
  canParse: false,
  hasParsed: false,
};

export function QuickBridgeControl({ streamId }: QuickBridgeControlProps) {
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

  const [generatedXML, setGeneratedXML] = useState("");
  const [payloadReady, setPayloadReady] = useState(false);
  const [launchState, setLaunchState] = useState<QuickLaunchState>("idle");
  const [isQueueing, setIsQueueing] = useState(false);
  const [parserStatus, setParserStatus] = useState(INITIAL_PARSER_STATUS);
  const createBridgeJob = useCreateBridgeJob(streamId);
  const parserRef = useRef<ResponseParserHandle>(null);
  const hasHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

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
    enabled: !!streamId,
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
    enabled: !!streamMeta?.domain_id,
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
    enabled: !!streamId,
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
    enabled: !!streamId,
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
  const instruction = bridgeSession?.lastInstruction ?? "";
  const effectiveInstruction = composeBridgeInstruction(
    hasHydrated ? instruction : "",
    hasHydrated ? bridgeSession?.sessionMemory ?? "" : "",
  );
  const providerId = hasHydrated
    ? bridgeSession?.providerId ?? bridgeDefaults.providerId
    : "gemini";
  const providerPreset = getBridgeProviderPreset(providerId);
  const latestBridgeJob = useLatestBridgeJob(streamId, providerId, 4_000);
  const payloadVariant = getQuickPayloadVariant(bridgeSession);
  const queueStatus = hasHydrated
    ? bridgeSession?.automationStatus ?? "idle"
    : "idle";
  const latestJob = latestBridgeJob.data;
  const effectiveLaunchState =
    bridgeSession ? launchState : "idle";
  const currentSessionKey = buildBridgeSessionKey(streamId, providerId);
  const latestJobMatchesCurrentPayload =
    latestJob?.session_key === currentSessionKey &&
    latestJob?.payload === generatedXML;
  const responseText = latestJob?.raw_response?.trim() ?? "";
  const canRunQuick = payloadReady && !!generatedXML.trim();
  const hasPendingResponse =
    !!bridgeSession &&
    latestJob?.status === "succeeded" &&
    !!responseText &&
    latestJob?.id !== bridgeSession?.lastAppliedJobId;
  const pendingResponseJobId = hasPendingResponse ? latestJob?.id ?? null : null;
  const responseToApply = hasPendingResponse ? responseText : "";
  const isContinuing =
    !!bridgeSession &&
    ((hasHydrated ? bridgeSession?.isExternalSessionActive ?? false : false) ||
      latestJob?.status === "succeeded");

  const phase: QuickPhase =
    hasPendingResponse
      ? "apply"
      : effectiveLaunchState === "queueing" ||
          effectiveLaunchState === "queued" ||
          queueStatus === "queued" ||
          queueStatus === "running" ||
          effectiveLaunchState === "launching" ||
          effectiveLaunchState === "done" ||
          effectiveLaunchState === "opened"
        ? "waiting"
        : "send";

  useEffect(() => {
    if (!responseToApply.trim()) return;
    void parserRef.current?.parse();
  }, [responseToApply]);

  const applyQuickBridgeResponse = async () => {
    if (!hasPendingResponse || !pendingResponseJobId) return;
    const didApply = await parserRef.current?.quickApply();
    if (!didApply) return;

    setLaunchState("idle");
    setIsQueueing(false);
    upsertBridgeSession(streamId, {
      lastAppliedJobId: pendingResponseJobId,
    });
  };

  const queueQuickBridge = async () => {
    if (!canRunQuick) return;
    if (
      latestJobMatchesCurrentPayload &&
      (latestJob?.status === "queued" || latestJob?.status === "running")
    ) {
      setIsQueueing(false);
      setLaunchState("queued");
      return;
    }

    try {
      setIsQueueing(true);
      setLaunchState("queueing");
      const result = await createBridgeJob.mutateAsync({
        provider: providerId,
        payload: generatedXML,
        payloadVariant,
        sessionKey: currentSessionKey,
        runnerDetails: {
          source: "quick-bridge-inline",
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
      setIsQueueing(false);
      setLaunchState("queued");
    } catch {
      setLaunchState("error");
      setIsQueueing(false);
    }
  };

  const handleClick = () => {
    if (phase === "waiting" || parserStatus.isApplying) {
      return;
    }
    if (phase === "apply") {
      void applyQuickBridgeResponse();
      return;
    }
    void queueQuickBridge();
  };

  const label =
    phase === "waiting"
      ? "Waiting"
      : phase === "apply"
        ? parserStatus.isApplying
          ? "Applying"
          : "Apply"
        : isContinuing
          ? "Continue"
          : "Quick";

  const detail =
    phase === "apply"
      ? "Apply response to current stream"
      : phase === "waiting"
        ? queueStatus === "needs-login"
          ? "Login needed"
          : queueStatus === "failed"
            ? "Failed"
            : queueStatus === "running"
              ? "Waiting"
              : "Queued"
        : isContinuing
          ? "Send follow-up payload"
          : "Send full payload";

  const icon =
    phase === "waiting" ||
        effectiveLaunchState === "queueing" ||
        effectiveLaunchState === "launching" ||
        parserStatus.isApplying ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <Wand2 className="h-4 w-4" />
    );

  const disabled =
    !hasHydrated ||
    phase === "waiting" ||
    (phase === "send" && !canRunQuick) ||
    (phase === "apply" && !hasPendingResponse) ||
    createBridgeJob.isPending ||
    isQueueing ||
    parserStatus.isApplying;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={`${label} · ${detail}`}
        className="inline-flex h-8 items-center gap-1.5 px-2 text-[11px] font-semibold transition-all hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:text-text-muted data-[phase=active]:bg-action-primary-bg data-[phase=active]:text-white data-[phase=active]:hover:bg-action-primary-hover"
        data-phase={phase === "send" || phase === "apply" ? "active" : "idle"}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>

      <div className="hidden">
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
        <ResponseParser
          key={pendingResponseJobId ?? "bridge-response-parser"}
          ref={parserRef}
          streamId={streamId}
          interactionMode={quickPreset.interactionMode}
          aiPersonaLabel={providerPreset.label}
          pastedXML={responseToApply}
          onPastedXMLChange={() => undefined}
          onStatusChange={setParserStatus}
        />
      </div>

    </>
  );
}
