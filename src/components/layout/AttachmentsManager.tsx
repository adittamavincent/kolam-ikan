"use client";

import { Fragment, useEffect, useState } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { Paperclip, Trash2, Download, X } from "lucide-react";
import { DocumentImportModal } from "@/components/features/documents/DocumentImportModal";

interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl: string; // data URL for preview / download
}

interface AttachmentsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

const STORAGE_KEY = (userId: string) => `attachments:${userId}`;

export function AttachmentsManager({ isOpen, onClose, userId }: AttachmentsManagerProps) {
  const [attachments, setAttachments] = useState<Attachment[]>(() => {
    try {
      if (typeof window === "undefined") return [];
      const raw = localStorage.getItem(STORAGE_KEY(userId));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [docImportOpen, setDocImportOpen] = useState(false);

  // Reload attachments when the userId changes — defer setState to avoid
  // triggering cascading renders in an effect body.
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const raw = localStorage.getItem(STORAGE_KEY(userId));
      const data = raw ? JSON.parse(raw) : [];
      Promise.resolve().then(() => setAttachments(data));
    } catch {
      Promise.resolve().then(() => setAttachments([]));
    }
  }, [userId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(attachments));
    } catch {
      // ignore storage errors
    }
  }, [attachments, userId]);


  const handleRemove = (id: string) => {
    setAttachments((s) => s.filter((a) => a.id !== id));
  };

  const handleDownload = (att: Attachment) => {
    const a = document.createElement("a");
    a.href = att.dataUrl;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <>
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-2xl transform overflow-hidden bg-surface-default p-6 text-left align-middle shadow-xl transition-all border border-border-default">
                <div className="flex items-start justify-between">
                  <DialogTitle as="h3" className="text-lg font-semibold leading-6 text-text-default flex items-center gap-2">
                    <Paperclip className="h-5 w-5" />
                    Attachments
                  </DialogTitle>
                  <button onClick={onClose} className="text-text-muted hover:text-text-default">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDocImportOpen(true)}
                      className="inline-flex items-center gap-2 rounded-md border border-border-default px-3 py-1 text-sm bg-surface-subtle hover:bg-surface-hover"
                    >
                      <span className="text-xs">Go to import</span>
                    </button>
                    <p className="text-xs text-text-muted">
                      Upload on the Document Import modal.
                    </p>
                  </div>

                  <div className="max-h-64 overflow-y-auto border border-border-default p-2 bg-surface-default">
                    {attachments.length === 0 && (
                      <div className="text-sm text-text-muted">No attachments yet.</div>
                    )}

                    <ul className="space-y-2">
                      {attachments.map((att) => (
                        <li key={att.id} className="flex items-center justify-between gap-2 rounded p-2 hover:bg-surface-subtle">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-surface-subtle text-text-muted">
                              <Paperclip className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-text-default">{att.name}</div>
                              <div className="text-[10px] text-text-muted">{Math.round(att.size / 1024)} KB • {att.type || "—"}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button onClick={() => handleDownload(att)} className="text-text-muted hover:text-text-default">
                              <Download className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleRemove(att.id)} className="text-status-error-text hover:opacity-80">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button onClick={onClose} className="inline-flex justify-center border border-transparent bg-action-primary-bg px-4 py-2 text-sm font-medium text-white hover:bg-action-primary-bg/90">
                    Close
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
    <DocumentImportModal
      isOpen={docImportOpen}
      onClose={() => setDocImportOpen(false)}
      streamId={userId}
    />
    </>
  );
}

export default AttachmentsManager;
