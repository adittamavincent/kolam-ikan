"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Globe } from "lucide-react";
import { InteractionSwitcher } from "./InteractionSwitcher";
import { ContextBag } from "./ContextBag";
import { XMLGenerator } from "./XMLGenerator";
import { ResponseParser, type ResponseParserHandle } from "./ResponseParser";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamId: string;
}

export function BridgeModal({ isOpen, onClose, streamId }: BridgeModalProps) {
  const supabase = createClient();
  const [interactionMode, setInteractionMode] = useState<"ASK" | "GO" | "BOTH">(
    "ASK",
  );
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [includeCanvas, setIncludeCanvas] = useState(true);
  const [userGlobalStreamChoice, setUserGlobalStreamChoice] =
    useState<boolean>(true);
  const [userInput, setUserInput] = useState("");
  const [tokenOverLimit, setTokenOverLimit] = useState(false);
  const [generatedXML, setGeneratedXML] = useState("");
  const [pastedXML, setPastedXML] = useState("");
  const [parserStatus, setParserStatus] = useState({
    isApplying: false,
    canApply: false,
    canParse: false,
    hasParsed: false,
  });
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);

  const parserRef = useRef<ResponseParserHandle>(null);

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

  const isGlobal = (s: {
    stream_kind: string;
    cabinet_id: string | null;
    sort_order: number;
  }) =>
    s.stream_kind === "GLOBAL" ||
    (s.cabinet_id === null && s.sort_order === -100);

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
    // You could add a toast or local feedback here if needed,
    // but the button in InteractionSwitcher also gives feedback via its click.
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

  const resetDialogTitle = "Clear all inputs and results?";
  const resetDialogDescription =
    "This resets your instructions and parsed output. Changes cannot be undone.";

  return (
    <>
      <Dialog
        open={isOpen}
        onClose={onClose}
        className="relative z-50 transition duration-300 ease-out data-closed:opacity-0"
      >
        {/* Backdrop */}
        <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-xl bg-surface-default/95 backdrop-blur-xl p-8 border border-border-default/50 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)] transition duration-300 ease-out data-closed:scale-95 data-closed:opacity-0 data-closed:translate-y-4 flex flex-col gap-6">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold bg-linear-to-r from-text-default to-text-muted bg-clip-text text-transparent">
                The Bridge
              </DialogTitle>
              <p className="text-sm text-text-muted mt-1.5">
                Configure instructions and context for the AI model.
              </p>
            </div>
            {streamMeta?.name && (
              <div className="flex items-center gap-2 text-text-muted text-sm mt-1">
                <span>on</span>
                <span className="font-semibold text-text-default">
                  {streamMeta.name}
                </span>
                {currentStreamIsGlobal && (
                  <div className="flex items-center gap-1 rounded-xl border border-action-primary-bg/30 bg-action-primary-bg/10 px-2 py-0.5 text-[10px] font-semibold text-action-primary-bg">
                    <Globe className="h-3 w-3" />
                    Global
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interaction Mode */}
          <InteractionSwitcher
            value={interactionMode}
            onChange={setInteractionMode}
            onCopy={handleCopyXML}
            onPaste={handlePasteResult}
            onParse={handleParse}
            onApply={handleApply}
            onReset={handleReset}
            status={parserStatus}
            // Token props
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

          {/* Context Selection */}
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
            globalStreamLoading={isStreamMetaLoading || isGlobalStreamLoading}
            currentStreamIsGlobal={currentStreamIsGlobal}
            disableSelectAll={tokenOverLimit}
          />

          {/* User Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-text-default">
              Bridge Instruction
            </label>
            <p className="text-xs text-text-muted mb-1">
              Describe the outcome you want from ASK, GO, or BOTH mode.
            </p>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="What would you like to accomplish?"
              className="w-full resize-y min-h-25 rounded-sm border border-border-default bg-surface-subtle/50 px-4 py-3 text-sm leading-relaxed text-text-default placeholder:text-text-muted/50 focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg focus:bg-surface-default outline-none transition-all"
              rows={3}
            />
          </div>

          {/* Generate XML */}
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

          {/* Parse Response */}
          <ResponseParser
            ref={parserRef}
            streamId={streamId}
            interactionMode={interactionMode}
            pastedXML={pastedXML}
            onPastedXMLChange={setPastedXML}
            onStatusChange={setParserStatus}
          />

          <div className="mt-8 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-sm bg-surface-subtle px-6 py-2.5 text-sm font-medium text-text-default hover:bg-surface-hover hover:text-text-strong transition-all focus:outline-none focus:ring-2 focus:ring-border-default md:min-w-30"
            >
              Done
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
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
