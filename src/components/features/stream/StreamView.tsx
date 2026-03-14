"use client";

import { LogPane } from "@/components/features/log/LogPane";
import { CanvasPane } from "@/components/features/canvas/CanvasPane";
import { BridgeModal } from "@/components/features/bridge/BridgeModal";
import { DocumentImportModal } from "@/components/features/documents/DocumentImportModal";
import { WhatsAppImportModal } from "@/components/features/log/WhatsAppImportModal";
import { useRealtimeEntries } from "@/lib/hooks/useRealtimeEntries";
import { useLayout } from "@/lib/hooks/useLayout";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export function StreamView({ streamId }: { streamId: string }) {
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const [isDocumentImportOpen, setIsDocumentImportOpen] = useState(false);
  const [incomingDocumentFiles, setIncomingDocumentFiles] = useState<Array<{
    file: File;
    hash?: string;
  }> | null>(null);
  const [isWhatsAppImportOpen, setIsWhatsAppImportOpen] = useState(false);
  const { logWidth } = useLayout();
  useRealtimeEntries(streamId);

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
    <div className="flex flex-1 relative min-h-0 h-full">
      <LogPane streamId={streamId} logWidth={logWidth} />
      <CanvasPane streamId={streamId} />

      {/* Bridge Trigger Button */}
      <button
        onClick={() => {
          window.dispatchEvent(new Event("kolam_flush_drafts"));
          setIsBridgeOpen(true);
        }}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2  bg-action-primary-bg px-4 py-2 text-action-primary-text hover:opacity-90 transition-opacity"
      >
        <Sparkles className="h-4 w-4" />
        <span className="font-medium">Bridge</span>
      </button>

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
