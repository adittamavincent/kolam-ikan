"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  Loader2,
  Rocket,
  Settings2,
  Wand2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
import { STREAM_KIND } from "@/lib/types";
import { XMLGenerator } from "./XMLGenerator";
import {
  BRIDGE_PROVIDER_PRESETS,
  buildQuickBridgePreset,
  composeBridgeInstruction,
  getQuickPayloadVariant,
  getBridgeProviderPreset,
} from "./bridge-config";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

interface QuickBridgeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDetailed: () => void;
  streamId: string;
}

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
  const setBridgeSessionActive = useUiPreferencesStore(
    (state) => state.setBridgeSessionActive,
  );

  const [providerId, setProviderId] = useState(
    bridgeSession?.providerId ?? bridgeDefaults.providerId,
  );
  const [instruction, setInstruction] = useState(
    bridgeSession?.lastInstruction ?? "",
  );
  const [generatedXML, setGeneratedXML] = useState("");
  const [payloadReady, setPayloadReady] = useState(false);
  const [launchState, setLaunchState] = useState<
    "idle" | "launching" | "done" | "opened" | "error"
  >("idle");
  const autoRanRef = useRef(false);

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
  const payloadVariant = getQuickPayloadVariant(bridgeSession);
  const isFollowupLaunch = payloadVariant === "followup";

  const launchQuickBridge = async () => {
    if (!payloadReady || !generatedXML.trim()) return;
    try {
      setLaunchState("launching");
      const openedWindow = window.open(
        providerPreset.launchUrl,
        "_blank",
        "noopener,noreferrer",
      );
      let copied = true;
      try {
        await navigator.clipboard.writeText(generatedXML);
      } catch {
        copied = false;
      }
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
        isExternalSessionActive: true,
        externalSessionLoadedAt:
          bridgeSession?.externalSessionLoadedAt ?? new Date().toISOString(),
      });
      setBridgeSessionActive(streamId, true);
      setLaunchState(
        openedWindow && copied ? "done" : openedWindow ? "opened" : "error",
      );
    } catch {
      setLaunchState("error");
    }
  };

  useEffect(() => {
    if (!isOpen || autoRanRef.current || !hasReusableInstruction) return;
    if (!payloadReady || !generatedXML.trim()) return;
    autoRanRef.current = true;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        if (!payloadReady || !generatedXML.trim()) return;
        try {
          setLaunchState("launching");
          await navigator.clipboard.writeText(generatedXML);
          window.open(
            providerPreset.launchUrl,
            "_blank",
            "noopener,noreferrer",
          );
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
            isExternalSessionActive: true,
            externalSessionLoadedAt:
              bridgeSession?.externalSessionLoadedAt ??
              new Date().toISOString(),
          });
          setBridgeSessionActive(streamId, true);
          setLaunchState("opened");
        } catch {
          setLaunchState("error");
        }
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [
    bridgeSession?.externalSessionLoadedAt,
    generatedXML,
    hasReusableInstruction,
    includeCanvas,
    includeGlobalStream,
    instruction,
    isOpen,
    payloadReady,
    providerId,
    providerPreset.launchUrl,
    quickPreset.interactionMode,
    setBridgeSessionActive,
    setBridgeDefaults,
    streamId,
    upsertBridgeSession,
  ]);

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      panelClassName="flex max-h-[90vh] w-full flex-col"
    >
      <ModalHeader
        title="Quick Bridge"
        description="Fast lane for repeat AI runs with a remembered destination and a recommended context bundle."
        icon={<Wand2 className="h-5 w-5" />}
        onClose={onClose}
        className="border-b border-border-subtle px-6 py-5"
        titleClassName="text-xl font-semibold text-text-default"
        meta={
          <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-text-muted">
            <span className="border border-border-subtle bg-surface-subtle px-2 py-1">
              {isFollowupLaunch ? "Continue" : "Full Context"}
            </span>
            <span className="border border-border-subtle bg-surface-subtle px-2 py-1">
              All entries
            </span>
            {includeCanvas && (
              <span className="border border-border-subtle bg-surface-subtle px-2 py-1">
                Canvas on
              </span>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-4 md:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-4">
            {(launchState === "done" || launchState === "opened") && (
              <div className="border border-status-success-bg bg-status-success-bg/40 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-status-success-text" />
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-status-success-text">
                      {launchState === "done"
                        ? `Payload copied. ${providerPreset.label} is open.`
                        : `${providerPreset.label} is open. Clipboard handoff still needs you.`}
                    </div>
                    <div className="text-xs text-text-default">
                      Next: click the prompt box on {providerPreset.hostLabel}
                      {launchState === "done" ? (
                        <>
                          , paste with{" "}
                          <span className="font-semibold">Cmd/Ctrl+V</span>,
                          then send.
                        </>
                      ) : (
                        <>
                          , use Copy payload again, then paste with{" "}
                          <span className="font-semibold">Cmd/Ctrl+V</span> and
                          send.
                        </>
                      )}
                      When the answer is ready, come back here or open Detailed
                      to paste, parse, and apply it.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          navigator.clipboard.writeText(generatedXML)
                        }
                        className="inline-flex items-center gap-2 border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                      >
                        <ClipboardPaste className="h-3.5 w-3.5" />
                        Copy payload again
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          window.open(
                            providerPreset.launchUrl,
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
                  </div>
                </div>
              </div>
            )}

            {launchState === "error" && (
              <div className="border border-status-error-border bg-status-error-bg p-4 text-xs text-status-error-text">
                Quick could not open the provider automatically. The payload is
                still ready. Use Copy below, then open{" "}
                {providerPreset.hostLabel} yourself and paste it in.
              </div>
            )}

            {launchState === "opened" && (
              <div className="flex items-start gap-2 border border-border-default bg-surface-subtle p-3 text-xs text-text-muted">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Browser auto-paste and auto-send still are not possible from
                  this web app. The provider tab opened correctly; use the
                  copied payload or press Copy payload again.
                </span>
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
              <p className="text-xs text-text-muted">
                {isFollowupLaunch
                  ? "This stream already has an active web-LLM session, so Quick will send a lighter follow-up payload."
                  : "This launch will send the full bridge payload so the provider conversation gets the complete system rules and context."}
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

            <div className="border border-border-default bg-surface-subtle p-3 text-xs text-text-muted">
              Quick will wait until the payload is ready, then copy it, open{" "}
              {providerPreset.hostLabel}, and keep Detailed available for paste,
              parse, and apply.
            </div>
          </div>

          <div className="space-y-3 border border-border-default bg-surface-subtle p-4">
            <div>
              <div className="text-sm font-semibold text-text-default">
                Session + context
              </div>
              <div className="mt-2 space-y-1 text-xs text-text-muted">
                <div>
                  {isFollowupLaunch
                    ? "Active web session: follow-up payload"
                    : "No active web session: full payload"}
                </div>
                <div>{selectedEntries.length || 0} recent entries</div>
                <div>All stream entries included</div>
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
            onXMLGenerated={setGeneratedXML}
            onPayloadReadyChange={setPayloadReady}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-6 py-4">
        <div className="text-xs text-text-muted">
          {launchState === "done" &&
            "Quick handoff is ready. Paste into the provider, then return here when you have a response."}
          {launchState === "opened" &&
            "Provider opened. Use Copy payload again if the clipboard did not carry over."}
          {launchState === "error" &&
            "Provider launch failed, but the payload is still available below."}
          {launchState === "idle" &&
            !payloadReady &&
            "Loading recent entries and canvas context before Quick can launch."}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-border-default px-4 py-2 text-sm font-semibold text-text-default hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void launchQuickBridge()}
            disabled={
              !instruction.trim() ||
              !generatedXML.trim() ||
              !payloadReady ||
              launchState === "launching"
            }
            className="inline-flex items-center gap-2 bg-action-primary-bg px-4 py-2 text-sm font-semibold text-action-primary-text hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:bg-action-primary-disabled"
          >
            {launchState === "launching" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Launch Quick
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
