"use client";

import { Copy, FileText } from "lucide-react";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";

interface BridgeResponsePreviewModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  responseText: string;
}

export function BridgeResponsePreviewModal({
  open,
  onClose,
  title = "AI Response",
  description = "Review the raw response captured from the provider.",
  responseText,
}: BridgeResponsePreviewModalProps) {
  const handleCopy = async () => {
    if (!responseText.trim()) return;
    await navigator.clipboard.writeText(responseText);
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      panelClassName="mx-auto flex max-h-[88vh] w-full max-w-4xl flex-col"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footerActions={[
        { label: "Close", onClick: onClose, tone: "secondary" },
        {
          label: "Copy response",
          icon: <Copy className="h-4 w-4" />,
          onClick: () => void handleCopy(),
          disabled: !responseText.trim(),
          tone: "primary",
        },
      ]}
    >
      <ModalHeader
        title={title}
        description={description}
        icon={<FileText className="h-5 w-5" />}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="border border-border-default bg-[#0d1117]">
          <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word p-4 text-sm leading-relaxed text-[#c9d1d9]">
            {responseText.trim() || "No response available yet."}
          </pre>
        </div>
      </div>
    </ModalShell>
  );
}
