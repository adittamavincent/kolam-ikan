"use client";

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
import {
  ClipboardPaste,
  Globe,
  Layers3,
  Send,
  Settings2,
  Sparkles,
} from "lucide-react";
import { InteractionSwitcher } from "./InteractionSwitcher";
import { ContextBag } from "./ContextBag";
import { XMLGenerator } from "./XMLGenerator";
import { ResponseParser, type ResponseParserHandle } from "./ResponseParser";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { STREAM_KIND } from "@/lib/types";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import {
  BRIDGE_PROVIDER_PRESETS,
  getBridgeProviderPreset,
} from "./bridge-config";

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamId: string;
}

export function BridgeModal({ isOpen, onClose, streamId }: BridgeModalProps) {
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

  const parserRef = useRef<ResponseParserHandle>(null);
  const currentProvider = getBridgeProviderPreset(providerId);

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

  const handleParse = () => parserRef.current?.parse();
  const handleApply = () => parserRef.current?.apply();
  const handleReset = () => {
    setIsResetDialogOpen(true);
  };

  const confirmReset = () => {
    setIsResetDialogOpen(false);
    setUserInput("");
    parserRef.current?.reset();
  };

  const handleOpenProvider = () => {
    if (typeof window === "undefined") return;
    window.open(currentProvider.launchUrl, "_blank", "noopener,noreferrer");
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
  };

  const resetDialogTitle = "Clear all inputs and results?";
  const resetDialogDescription =
    "This resets your instructions and parsed output. Changes cannot be undone.";

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

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={onClose}
        panelClassName="mx-auto flex max-h-[90vh] w-full flex-col"
      >
        <ModalHeader
          title="Detailed Bridge"
          description="Build the payload, choose context deliberately, then bring the AI response back here to parse and apply."
          icon={<Sparkles className="h-5 w-5" />}
          onClose={onClose}
          className="px-8 py-6"
          titleClassName="text-2xl font-bold text-text-default"
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

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 px-8 pb-8 pt-6">
            <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
              <section className="space-y-4 border border-border-default bg-surface-subtle p-5">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-text-default">
                    <Layers3 className="h-4 w-4" />
                    Goal
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Choose how much the AI should answer, update, or do both for
                    this run.
                  </p>
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

                <div className="flex flex-wrap gap-2 text-[11px] text-text-muted">
                  <span className="border border-border-subtle bg-surface-default px-2 py-1">
                    Session aware
                  </span>
                  <span className="border border-border-subtle bg-surface-default px-2 py-1">
                    Last mode: {bridgeSession?.lastMode ?? "none"}
                  </span>
                  <span className="border border-border-subtle bg-surface-default px-2 py-1">
                    Quick default: {bridgeDefaults.quickPreset}
                  </span>
                </div>
              </section>

              <section className="space-y-4 border border-border-default bg-surface-subtle p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-default">
                  <Send className="h-4 w-4" />
                  Destination
                </div>
                <div className="grid gap-3">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Provider
                    </span>
                    <select
                      value={providerId}
                      onChange={(event) =>
                        setProviderId(event.target.value as typeof providerId)
                      }
                      className="w-full border border-border-default bg-surface-default px-3 py-2 text-sm text-text-default"
                    >
                      {BRIDGE_PROVIDER_PRESETS.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="text-xs text-text-muted">
                  Detailed keeps the workflow manual but remembers your
                  destination for future Quick launches.
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-text-muted">
                  <span className="border border-border-subtle bg-surface-default px-2 py-1">
                    {currentProvider.hostLabel}
                  </span>
                  {bridgeSession?.sessionMemory && (
                    <span className="border border-border-subtle bg-surface-default px-2 py-1">
                      Session memory ready
                    </span>
                  )}
                </div>
              </section>
            </div>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-text-default">
                  Context
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  Include only the material that should shape this response.
                </p>
              </div>

              <ContextBag
                streamId={streamId}
                selectedEntries={selectedEntries}
                onSelectionChange={setSelectedEntries}
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

            <section className="flex flex-col gap-1.5 border border-border-default bg-surface-subtle p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-default">
                <Settings2 className="h-4 w-4" />
                Request
              </div>
              <label className="text-sm font-semibold text-text-default">
                What should the AI do?
              </label>
              <p className="mb-1 text-xs text-text-muted">
                Keep it outcome-focused. Detailed mode is where you tune the
                protocol manually.
              </p>
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="What would you like to accomplish?"
                className="min-h-25 w-full resize-y border border-border-default bg-surface-hover px-4 py-3 text-sm leading-relaxed text-text-default placeholder:text-text-muted focus:border-border-default focus:bg-surface-default"
                rows={3}
              />
            </section>

            <section className="border border-border-default bg-surface-subtle p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-default">
                    Generated Payload
                  </h3>
                  <p className="mt-1 text-xs text-text-muted">
                    Copy this into your provider, or open the provider now and
                    paste there.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleCopyXML}
                    className="border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                  >
                    Copy payload
                  </button>
                  <button
                    onClick={handleOpenProvider}
                    className="bg-action-primary-bg px-3 py-2 text-xs font-semibold text-action-primary-text hover:bg-action-primary-hover"
                  >
                    Open {currentProvider.label}
                  </button>
                </div>
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
                onXMLGenerated={setGeneratedXML}
              />
            </section>

            <section className="border border-border-default bg-surface-subtle p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-default">
                    Returned Response
                  </h3>
                  <p className="mt-1 text-xs text-text-muted">
                    Paste the provider output here, then parse and apply from
                    this section.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handlePasteResult}
                    className="inline-flex items-center gap-2 border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Paste from clipboard
                  </button>
                  <button
                    onClick={handleParse}
                    disabled={!parserStatus.canParse}
                    className="border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover disabled:text-text-muted"
                  >
                    Parse now
                  </button>
                  <button
                    onClick={handleApply}
                    disabled={!parserStatus.canApply || parserStatus.isApplying}
                    className="bg-action-primary-bg px-3 py-2 text-xs font-semibold text-action-primary-text hover:bg-action-primary-hover disabled:bg-action-primary-disabled"
                  >
                    {parserStatus.isApplying
                      ? "Applying..."
                      : "Apply parsed changes"}
                  </button>
                  <button
                    onClick={handleReset}
                    className="border border-border-default px-3 py-2 text-xs font-semibold text-text-default hover:bg-surface-hover"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <ResponseParser
                ref={parserRef}
                streamId={streamId}
                interactionMode={interactionMode}
                pastedXML={pastedXML}
                onPastedXMLChange={setPastedXML}
                onStatusChange={setParserStatus}
              />
            </section>
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-border-subtle px-8 py-4">
          <button
            onClick={handleDone}
            className="bg-surface-subtle px-6 py-2.5 text-sm font-medium text-text-default transition-all hover:bg-surface-hover hover:text-text-strong md:min-w-30"
          >
            Done
          </button>
        </div>
      </ModalShell>
      <ConfirmDialog
        open={isResetDialogOpen}
        title={resetDialogTitle}
        description={resetDialogDescription}
        confirmLabel="Clear"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setIsResetDialogOpen(false)}
        onConfirm={confirmReset}
      />
    </>
  );
}
