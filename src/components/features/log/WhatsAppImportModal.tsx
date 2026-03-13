"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  X,
  MessageSquare,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  SkipForward,
  Undo2,
  Info,
  Upload,
} from "lucide-react";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { PdfAttachmentThumbnail } from "./PdfAttachmentThumbnail";
import { createClient } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

// ─── Global temp file store ──────────────────────────────────────────────────
// Use a Map to temporarily store File objects since they don't serialize well through events
declare global {
  interface Window {
    kolam_temp_files?: Map<string, { file: File; hash?: string; blobUrl?: string }>;  
    kolam_pending_file_ids?: string[];
  }
}

const getTempFileStore = (): Map<string, { file: File; hash?: string; blobUrl?: string }> => {
  if (typeof window === "undefined") return new Map();
  if (!window.kolam_temp_files) {
    window.kolam_temp_files = new Map();
  }
  return window.kolam_temp_files;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getPendingFileIds = (): string[] => {
  if (typeof window === "undefined") return [];
  if (!window.kolam_pending_file_ids) {
    window.kolam_pending_file_ids = [];
  }
  return window.kolam_pending_file_ids;
};

const setPendingFileIds = (ids: string[]): void => {
  if (typeof window === "undefined") return;
  window.kolam_pending_file_ids = ids;
  console.log("[WhatsApp] Set pending file IDs:", ids);
};

const generateFileId = (): string => `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
import JSZip from "jszip";
import { calculateFileHash } from "@/lib/utils/hash";

// ─── Inject payload (consumed by EntryCreator) ────────────────────────────────

export interface WhatsAppInjectPayload {
  streamId: string;
  turns: Array<
    | { type: "text"; personaId: string; personaName: string; messages: string[] }
    | {
        type: "pdf";
        personaId: string;
        personaName: string;
        attachments: Array<{
          documentId?: string;
          storagePath?: string;
          thumbnailPath?: string;
          previewUrl?: string;
          titleSnapshot: string;
          file?: File;
          fileHash?: string;
        }>;
      }
  >;
}

// ─── Internal parser types ────────────────────────────────────────────────────

interface ParsedTurn {
  id: string;
  type: "text" | "pdf" | "media";
  sender: string;
  messages?: string[];
  filename?: string;
  fullPath?: string;
  preferredTitle?: string;
  mediaKind?: string;
}

interface PdfUploadState {
  status: "pending" | "uploading" | "done" | "error" | "skipped";
  file?: File;
  documentId?: string;
  storagePath?: string;
  thumbnailPath?: string;
  titleSnapshot?: string;
  error?: string;
}

interface ParsedZipData {
  chatText: string;
  pdfByKey: Record<string, File[]>;
}

type Step = "paste" | "range" | "map" | "files";

// ─── Parser ───────────────────────────────────────────────────────────────────

// iOS: [3/10/26, 7:42:30 PM] Name: text
const IOS_MSG_RE =
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*[\d:.]+(?:\s*[AP]\.?M\.?)?\]\s*([^:[\]]+):\s*([\s\S]*)$/i;
// Android: 3/10/2026, 7:42 PM - Name: text
const ANDROID_MSG_RE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*[\d:.]+(?:\s*[AP]\.?M\.?)?\s*-\s*([^:]+):\s*([\s\S]*)$/i;

function normalizeWhatsAppHeaderLine(s?: string): string {
  const inStr = s ?? "";
  return inStr
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[\u00A0\u202F]/g, " ")
    .trimStart();
}

function stripInvisible(s?: string): string {
  const inStr = s ?? "";
  // Strip leading Unicode directional / invisible marks WhatsApp inserts
  return inStr.replace(/^[\u200E\u200F\u202A-\u202E\u2066-\u2069]+/, "").trim();
}

function normalizeSenderName(rawSender?: string): string {
  return stripInvisible(rawSender)
    .replace(/^~+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ClassifiedText {
  type: "text" | "pdf" | "media";
  cleanText: string;
  filename?: string;
  fullPath?: string;
  preferredTitle?: string;
  mediaKind?: string;
}

function derivePreferredPdfTitle(caption?: string, fallbackFilename?: string): string | undefined {
  const trimmed = (caption ?? "").trim();
  if (!trimmed) return undefined;

  const beforeMeta = trimmed.split("•")[0]?.trim() ?? trimmed;
  const cleaned = beforeMeta.replace(/\s{2,}/g, " ").replace(/\.pdf$/i, "").trim();
  const fallbackBase = (fallbackFilename ?? "").replace(/\.pdf$/i, "").trim().toLowerCase();
  if (!cleaned || cleaned.toLowerCase() === fallbackBase) return undefined;
  return cleaned;
}

function classifyText(raw?: string): ClassifiedText {
  const t = stripInvisible(raw);

  // Inline attachment marker, e.g.:
  // "Caption • 11 pages <attached: 00000008-my-file.pdf>"
  const inlineAttachedM = t.match(/^(.*?)<attached:\s*([^>]+)>/i);
  if (inlineAttachedM) {
    const caption = inlineAttachedM[1].trim();
    const name = inlineAttachedM[2].trim();
    if (/\.pdf$/i.test(name)) {
      return {
        type: "pdf",
        cleanText: t,
        filename: name,
        preferredTitle: derivePreferredPdfTitle(caption, name),
      };
    }
    const ext = name.split(".").pop()?.toLowerCase() ?? "file";
    return { type: "media", cleanText: t, mediaKind: ext, filename: name };
  }

  // <attached: filename.ext>
  const attachedM = t.match(/^<attached:\s*(.+?)>\s*$/i);
  if (attachedM) {
    const name = attachedM[1].trim();
    if (/\.pdf$/i.test(name)) return { type: "pdf", cleanText: t, filename: name };
    const ext = name.split(".").pop()?.toLowerCase() ?? "file";
    return { type: "media", cleanText: t, mediaKind: ext, filename: name };
  }

  // Absolute path ending in .pdf (macOS pasteboard, Windows, Unix)
  const pdfPathM = t.match(
    /^(\/[^\n\r]+\.pdf|[A-Za-z]:[\\\/][^\n\r]+\.pdf)$/i,
  );
  if (pdfPathM) {
    const fullPath = pdfPathM[1].trim();
    const filename = fullPath.replace(/\\/g, "/").split("/").pop()!;
    return { type: "pdf", cleanText: t, filename, fullPath };
  }

  // Absolute path, non-PDF
  const filePathM = t.match(
    /^(\/[^\n\r]+\.[a-z0-9]{2,5}|[A-Za-z]:[\\\/][^\n\r]+\.[a-z0-9]{2,5})$/i,
  );
  if (filePathM) {
    const ext = filePathM[1].split(".").pop()?.toLowerCase() ?? "file";
    return { type: "media", cleanText: t, mediaKind: ext };
  }

  // Media omitted patterns
  const omittedM = t.match(
    /^(image|video|audio|sticker|GIF|voice message|video note|document)\s+omitted$/i,
  );
  if (omittedM)
    return { type: "media", cleanText: t, mediaKind: omittedM[1].toLowerCase() };
  if (/^<Media omitted>$/.test(t))
    return { type: "media", cleanText: t, mediaKind: "media" };

  return { type: "text", cleanText: t };
}

interface RawMessage {
  sender: string;
  senderRaw: string;
  classified: ClassifiedText;
}

function countCleanedSenders(msgs: RawMessage[]): number {
  return msgs.filter((m) => m.sender !== m.senderRaw).length;
}

function parseRawMessages(raw: string): RawMessage[] {
  const lines = raw.split("\n");
  const result: RawMessage[] = [];
  let current: { sender: string; senderRaw: string; text: string } | null = null;
  const flush = () => {
    if (!current) return;
    const classified = classifyText(current.text);
    if (classified.cleanText) {
      result.push({
        sender: current.sender,
        senderRaw: current.senderRaw,
        classified,
      });
    }
    current = null;
  };
  let lastLine = "";
  try {
    for (const [, line] of lines.entries()) {
      lastLine = line;
      const normalizedLine = normalizeWhatsAppHeaderLine(line);
    const iosM = normalizedLine.match(IOS_MSG_RE);
    const androidM = !iosM ? normalizedLine.match(ANDROID_MSG_RE) : null;
    const m = iosM ?? androidM;

    if (m) {
      flush();
      const senderRaw = stripInvisible(m[2]);
      const sender = normalizeSenderName(senderRaw) || senderRaw || "Unknown";
      const msgText = stripInvisible(m[3]).trim();
      if (sender) current = { sender, senderRaw, text: msgText };
    } else if (current) {
      const trimmed = stripInvisible(line).trimEnd();
        if (trimmed) current.text += "\n" + trimmed;
        }
      }
    } catch (err) {
    // Help debugging: log the offending line and rethrow
     
    console.error("parseRawMessages failed processing line:", lastLine, err);
    throw err;
  }
  flush();
  return result;
}

function buildTurns(msgs: RawMessage[]): ParsedTurn[] {
  let counter = 0;
  const turns: ParsedTurn[] = [];

  for (const { sender, classified } of msgs) {
    if (classified.type === "text") {
      const last = turns[turns.length - 1];
      if (last?.type === "text" && last.sender === sender) {
        last.messages!.push(classified.cleanText);
      } else {
        turns.push({
          id: String(counter++),
          type: "text",
          sender,
          messages: [classified.cleanText],
        });
      }
    } else if (classified.type === "pdf") {
      turns.push({
        id: String(counter++),
        type: "pdf",
        sender,
        filename: classified.filename,
        fullPath: classified.fullPath,
        preferredTitle: classified.preferredTitle,
      });
    } else {
      turns.push({
        id: String(counter++),
        type: "media",
        sender,
        mediaKind: classified.mediaKind ?? "media",
        filename: classified.filename,
      });
    }
  }
  return turns;
}

function getMappableSenders(turns: ParsedTurn[]): string[] {
  const seen = new Set<string>();
  return turns
    .filter((t) => t.type !== "media")
    .map((t) => t.sender)
    .filter((s) => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
}

function normalizeAttachmentKey(value?: string): string {
  const inVal = value ?? "";
  return inVal
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.trim()
    ?.toLowerCase() ?? "";
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes && bytes !== 0) return "";
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let u = -1;
  let b = bytes;
  do {
    b = b / thresh;
    u++;
  } while (Math.abs(b) >= thresh && u < units.length - 1);
  return `${b.toFixed(b >= 10 ? 0 : 1)} ${units[u]}`;
}

function indexPdfFile(index: Record<string, File[]>, key: string, file: File) {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(file);
}

function findBestPdfForTurn(
  turn: ParsedTurn,
  index: Record<string, File[]>,
): File | null {
  const keys = [turn.filename, turn.fullPath]
    .filter(Boolean)
    .map((v) => normalizeAttachmentKey(v!));

  for (const key of keys) {
    const list = index[key];
    if (list?.length) return list[0];
  }

  return null;
}

async function parseWhatsAppZip(zipFile: File): Promise<ParsedZipData> {
  const zip = await JSZip.loadAsync(zipFile);
  const txtEntries: Array<{ path: string; content: string; messageCount: number }> = [];
  const pdfByKey: Record<string, File[]> = {};

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normalizedPath = path.replace(/^\/+/, "");
    if (normalizedPath.startsWith("__MACOSX/")) continue;

    if (/\.txt$/i.test(normalizedPath)) {
      const content = await entry.async("text");
      const messageCount = parseRawMessages(content).length;
      txtEntries.push({ path: normalizedPath, content, messageCount });
      continue;
    }

    if (/\.pdf$/i.test(normalizedPath)) {
      const data = await entry.async("uint8array");
      const fileName = normalizedPath.split("/").pop() ?? "document.pdf";
      const binary = new Uint8Array(data.byteLength);
      binary.set(data);
      const file = new File([binary], fileName, {
        type: "application/pdf",
        lastModified: Date.now(),
      });
      indexPdfFile(pdfByKey, normalizeAttachmentKey(normalizedPath), file);
      indexPdfFile(pdfByKey, normalizeAttachmentKey(fileName), file);
    }
  }

  if (txtEntries.length === 0) {
    throw new Error("No chat .txt file found in ZIP export");
  }

  txtEntries.sort((a, b) => {
    if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount;
    const aHasChat = /chat/i.test(a.path);
    const bHasChat = /chat/i.test(b.path);
    if (aHasChat !== bHasChat) return bHasChat ? 1 : -1;
    return a.path.localeCompare(b.path);
  });

  return { chatText: txtEntries[0].content, pdfByKey };
}

function buildAutoMap(
  senders: string[],
  personas:
    | Array<{
        id: string;
        name: string;
      }>
    | undefined,
): Record<string, string> {
  const autoMap: Record<string, string> = {};
  for (const sender of senders) {
    const match = personas?.find((p) => p.name.toLowerCase() === sender.toLowerCase());
    if (match) autoMap[sender] = match.id;
  }
  return autoMap;
}

const PERSONA_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#0ea5e9",
  "#14b8a6", "#a855f7",
];

// ─── Component ────────────────────────────────────────────────────────────────

interface WhatsAppImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamId: string;
}

export function WhatsAppImportModal({
  isOpen,
  onClose,
  streamId,
}: WhatsAppImportModalProps) {
  const { personas } = usePersonas();
  const queryClient = useQueryClient();
  const supabase = createClient();

  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [parsedTurns, setParsedTurns] = useState<ParsedTurn[]>([]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [mappableSenders, setMappableSenders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [creatingPersonaFor, setCreatingPersonaFor] = useState<string | null>(null);
  const [creatingAllPersonas, setCreatingAllPersonas] = useState(false);
  const [uploads, setUploads] = useState<Record<string, PdfUploadState>>({});
  const [zipSourceName, setZipSourceName] = useState<string | null>(null);
  const [zipPdfIndex, setZipPdfIndex] = useState<Record<string, File[]>>({});
  const [zipLoadError, setZipLoadError] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipAutoUploadRan, setZipAutoUploadRan] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // Preview tooltip state (custom tooltip with configurable timing)
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipContent, setTooltipContent] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TOOLTIP_SHOW_DELAY = 300; // ms (slower show)
  const TOOLTIP_HIDE_DELAY = 200; // ms

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handlePreviewMouseEnter = (e: React.MouseEvent, idx: number, content: string) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const left = Math.max(8, rect.left);
    const top = rect.bottom + 8; // small gap
    const maxWidth = Math.min(400, window.innerWidth - left - 16);
    setTooltipPos({ left, top, width: maxWidth });
    setTooltipContent(content);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => {
      setTooltipVisible(true);
      tooltipTimerRef.current = null;
    }, TOOLTIP_SHOW_DELAY);
  };

  const handlePreviewMouseLeave = () => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setTooltipVisible(false);
      setTooltipContent(null);
      setTooltipPos(null);
      hideTimerRef.current = null;
    }, TOOLTIP_HIDE_DELAY);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selectedTurns =
    parsedTurns.length === 0 || rangeEnd < rangeStart
      ? []
      : parsedTurns.slice(rangeStart, rangeEnd + 1);
  const textTurns = selectedTurns.filter((t) => t.type === "text");
  const pdfTurns = selectedTurns.filter((t) => t.type === "pdf");
  const mediaTurns = selectedTurns.filter((t) => t.type === "media");
  const hasPdfTurns = pdfTurns.length > 0;
  const allMapped = mappableSenders.every((s) => !!mapping[s]);
  const unmappedCount = mappableSenders.filter((s) => !mapping[s]).length;
  const anyUploading = Object.values(uploads).some((u) => u.status === "uploading");
  const doneUploadCount = Object.values(uploads).filter((u) => u.status === "done").length;
  const queuedUploadCount = Object.values(uploads).filter(
    (u) => u.status === "pending" && !!u.file,
  ).length;
  const skippedPdfs = pdfTurns.filter((t) => uploads[t.id]?.status === "skipped");
  const plannedImportableCount = textTurns.length + doneUploadCount + queuedUploadCount;
  const allPdfsPrepared = pdfTurns.every((turn) => {
    const upload = uploads[turn.id];
    if (!upload) return false;
    if (upload.status === "skipped" || upload.status === "done") return true;
    return !!upload.file;
  });
  const canConfirmFiles =
    allMapped && !anyUploading && allPdfsPrepared && plannedImportableCount > 0;

  // Live preview (step 1 only)
  const liveMsgs = rawText.trim() ? parseRawMessages(rawText) : [];
  const liveTurns = buildTurns(liveMsgs);
  const liveSenders = getMappableSenders(liveTurns);
  const livePdfCount = liveTurns.filter((t) => t.type === "pdf").length;
  const liveMediaCount = liveTurns.filter((t) => t.type === "media").length;
  const liveImportable = liveTurns.filter((t) => t.type !== "media").length;
  const liveCleanedSenders = countCleanedSenders(liveMsgs);
  const autoMatchCount = pdfTurns.filter((t) => findBestPdfForTurn(t, zipPdfIndex)).length;
  const rangeImportableCount = selectedTurns.filter((t) => t.type !== "media").length;

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleParseAndNext = () => {
    const msgs = parseRawMessages(rawText);
    if (msgs.length === 0) return;
    const turns = buildTurns(msgs);
    setParsedTurns(turns);
    setRangeStart(0);
    setRangeEnd(Math.max(0, turns.length - 1));
    setMappableSenders([]);
    setMapping({});
    setUploads({});
    setZipSourceName(null);
    setZipPdfIndex({});
    setZipLoadError(null);
    setZipAutoUploadRan(false);
    setStep("range");
  };

  const handleZipSelect = async (file: File) => {
    setZipLoading(true);
    setZipLoadError(null);
    try {
      const zipData = await parseWhatsAppZip(file);
      const msgs = parseRawMessages(zipData.chatText);
      if (msgs.length === 0) {
        throw new Error("No WhatsApp messages were detected in ZIP chat text");
      }

      const turns = buildTurns(msgs);
      setRawText(zipData.chatText);
      setParsedTurns(turns);
      setRangeStart(0);
      setRangeEnd(Math.max(0, turns.length - 1));
      setMappableSenders([]);
      setMapping({});
      setUploads({});
      setZipSourceName(file.name);
      setZipPdfIndex(zipData.pdfByKey);
      setZipAutoUploadRan(false);
      setStep("range");
    } catch (error) {
      setZipLoadError(
        error instanceof Error ? error.message : "Failed to parse ZIP export",
      );
    } finally {
      setZipLoading(false);
    }
  };

  const handleRangeNext = () => {
    if (selectedTurns.length === 0) return;
    const senders = getMappableSenders(selectedTurns);
    setMappableSenders(senders);
    setMapping(buildAutoMap(senders, personas));
    setUploads({});
    setZipAutoUploadRan(false);
    setStep("map");
  };

  const handleMapNext = () => {
    if (!allMapped) return;
    if (!hasPdfTurns) {
      handleConfirm();
      return;
    }
    // Initialize upload slots
    setUploads((prev) => {
      const next: Record<string, PdfUploadState> = { ...prev };
      for (const t of pdfTurns) {
        if (!next[t.id]) next[t.id] = { status: "pending" };
      }
      return next;
    });
    setStep("files");

    if (!zipAutoUploadRan && Object.keys(zipPdfIndex).length > 0) {
      setZipAutoUploadRan(true);
      for (const t of pdfTurns) {
        const matched = findBestPdfForTurn(t, zipPdfIndex);
        if (!matched) continue;
        handleFileSelect(t.id, matched);
      }
    }
  };

  const handleCreatePersona = async (sender: string, colorIdx: number) => {
    setCreatingPersonaFor(sender);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const color = PERSONA_COLORS[colorIdx % PERSONA_COLORS.length];
      const { data, error } = await supabase
        .from("personas")
        .insert({
          name: sender,
          color,
          icon: "user",
          type: "HUMAN",
          user_id: user.id,
          is_system: false,
        })
        .select()
        .single();
      if (error || !data) return;
      await queryClient.invalidateQueries({ queryKey: ["personas"] });
      setMapping((prev) => ({ ...prev, [sender]: data.id }));
    } finally {
      setCreatingPersonaFor(null);
    }
  };

  const handleCreateAllMissingPersonas = async () => {
    const missing = mappableSenders.filter((sender) => !mapping[sender]);
    if (missing.length === 0) return;

    setCreatingAllPersonas(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const rows = missing.map((sender, idx) => ({
        name: sender,
        color: PERSONA_COLORS[idx % PERSONA_COLORS.length],
        icon: "user",
        type: "HUMAN",
        user_id: user.id,
        is_system: false,
      }));

      const { data, error } = await supabase
        .from("personas")
        .insert(rows)
        .select();
      if (error || !data) return;

      await queryClient.invalidateQueries({ queryKey: ["personas"] });
      setMapping((prev) => {
        const next = { ...prev };
        for (const created of data) {
          next[created.name] = created.id;
        }
        return next;
      });
    } finally {
      setCreatingAllPersonas(false);
    }
  };

  const handleFileSelect = (
    turnId: string,
    file: File,
  ) => {
    setUploads((prev) => ({ ...prev, [turnId]: { status: "pending", file } }));
  };

  const handleProcessAndConfirm = async () => {
    if (!canConfirmFiles) return;

     
    console.log("[WhatsApp] handleProcessAndConfirm started with selectedTurns:", {
      count: selectedTurns.length,
      types: selectedTurns.map((t) => t.type),
    });

    // Transfer all text turns and any already-completed PDFs to EntryCreator
    // Transfer all pending PDF files to the Docling document import handler
    const payloadTurns: WhatsAppInjectPayload["turns"] = [];
    const transferFiles: Array<{ file: File; hash?: string }> = [];

    for (const turn of selectedTurns) {
      if (turn.type === "media") continue;
      const personaId = mapping[turn.sender];
      if (!personaId) continue;
      const persona = personas?.find((p) => p.id === personaId);
      const personaName = persona?.name ?? turn.sender;

      if (turn.type === "text") {
        // All text turns go directly to EntryCreator
        payloadTurns.push({ type: "text", personaId, personaName, messages: turn.messages! });
      } else if (turn.type === "pdf") {
        const upload = uploads[turn.id];
         
        console.log("[WhatsApp] Processing PDF turn:", {
          turnId: turn.id,
          filename: turn.filename,
          fullPath: turn.fullPath,
          uploadStatus: upload?.status,
          uploadFile: upload?.file ? { name: upload.file.name, size: upload.file.size } : null,
        });
        
        // If already uploaded (done) → include in inject payload
        if (upload?.status === "done" && upload.documentId && upload.storagePath) {
          const attachment = {
            documentId: upload.documentId,
            storagePath: upload.storagePath,
            thumbnailPath: upload.thumbnailPath,
            titleSnapshot:
              upload.titleSnapshot ?? turn.preferredTitle ?? turn.filename ?? "Document",
          };

          const last = payloadTurns[payloadTurns.length - 1];
          if (last?.type === "pdf" && last.personaId === personaId) {
            last.attachments.push(attachment);
          } else {
            payloadTurns.push({ type: "pdf", personaId, personaName, attachments: [attachment] });
          }
        } 
        // If pending with a file → include placeholder in inject + transfer to document import handler
        else if (upload?.file && upload.status === "pending") {
          const file = upload.file;
          
          console.log("[WhatsApp] Queuing PDF file for transfer:", {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          });
          const hash = await calculateFileHash(file);
          
          if (!transferFiles.find((f) => f.file === file)) {
            transferFiles.push({ file, hash });
          }

          // Create a blob URL for immediate preview display
          const blobUrl = URL.createObjectURL(file);

          // Include placeholder attachment in inject payload so EntryCreator creates the section
          // The actual documentId will be added once Dockling processing completes
          const attachment = {
            titleSnapshot:
              upload.titleSnapshot ?? turn.preferredTitle ?? turn.filename ?? "Document",
            fileHash: hash,
            previewUrl: blobUrl,
          };

          const last = payloadTurns[payloadTurns.length - 1];
          if (last?.type === "pdf" && last.personaId === personaId) {
            last.attachments.push(attachment);
          } else {
            payloadTurns.push({ type: "pdf", personaId, personaName, attachments: [attachment] });
          }
        }
        // If skipped or error, ignore
      }
    }

    // Dispatch all text turns and PDFs (including pending ones) to EntryCreator
    if (payloadTurns.length > 0) {
       
      console.log("[WhatsApp] Dispatching kolam_whatsapp_import_inject:", {
        turnCount: payloadTurns.length,
        streamId,
      });
      window.dispatchEvent(
        new CustomEvent("kolam_whatsapp_import_inject", {
          detail: { streamId, turns: payloadTurns } satisfies WhatsAppInjectPayload,
        }),
      );
    }

    // Transfer all pending PDF files to the document import handler for Docling processing
    if (transferFiles.length > 0) {
      const tempStore = getTempFileStore();
      const fileIds = transferFiles.map((fileData) => {
        const id = generateFileId();
        // Create blob URL for preview
        const blobUrl = URL.createObjectURL(fileData.file);
        tempStore.set(id, { ...fileData, blobUrl });
        return id;
      });

      // Store pending file IDs so they're available when DocumentImportModal opens
      setPendingFileIds(fileIds);

      console.log("[WhatsApp] Storing files in temp store and dispatching kolam_header_documents_import:", {
        fileCount: transferFiles.length,
        fileIds,
        files: transferFiles.map((f) => ({
          name: f.file.name,
          size: f.file.size,
          hash: f.hash,
        })),
      });
      window.dispatchEvent(
        new CustomEvent("kolam_header_documents_import", {
          detail: { fileIds },
        }),
      );
    }

    // Close the modal immediately
    handleClose();
  };

  const handleConfirm = (uploadsSnapshot: Record<string, PdfUploadState> = uploads) => {
    const payloadTurns: WhatsAppInjectPayload["turns"] = [];

    for (const turn of selectedTurns) {
      if (turn.type === "media") continue;
      const personaId = mapping[turn.sender];
      if (!personaId) continue;
      const persona = personas?.find((p) => p.id === personaId);
      const personaName = persona?.name ?? turn.sender;

      if (turn.type === "text") {
        payloadTurns.push({ type: "text", personaId, personaName, messages: turn.messages! });
      } else {
        const upload = uploadsSnapshot[turn.id];
        if (!upload || upload.status !== "done" || !upload.documentId || !upload.storagePath)
          continue;
        const attachment = {
          documentId: upload.documentId,
          storagePath: upload.storagePath,
          thumbnailPath: upload.thumbnailPath,
          titleSnapshot:
            upload.titleSnapshot ??
            turn.preferredTitle ??
            turn.filename ??
            "Document",
        };

        const last = payloadTurns[payloadTurns.length - 1];
        if (last?.type === "pdf") {
          last.attachments.push(attachment);
        } else {
          payloadTurns.push({
            type: "pdf",
            personaId,
            personaName,
            attachments: [attachment],
          });
        }
      }
    }

    if (payloadTurns.length === 0) return;

    window.dispatchEvent(
      new CustomEvent("kolam_whatsapp_import_inject", {
        detail: { streamId, turns: payloadTurns } satisfies WhatsAppInjectPayload,
      }),
    );
    handleClose();
  };

  const handleClose = () => {
    setStep("paste");
    setRawText("");
    setParsedTurns([]);
    setRangeStart(0);
    setRangeEnd(0);
    setMappableSenders([]);
    setMapping({});
    setCreatingAllPersonas(false);
    setUploads({});
    setZipSourceName(null);
    setZipPdfIndex({});
    setZipLoadError(null);
    setZipLoading(false);
    setZipAutoUploadRan(false);
    onClose();
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const totalSteps = hasPdfTurns ? 4 : 3;
  const currentStepNumber =
    step === "paste" ? 1 : step === "range" ? 2 : step === "map" ? 3 : 4;

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      className="relative z-50 transition duration-300 ease-out data-closed:opacity-0"
    >
      <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />
      <div className="fixed inset-0 overflow-y-auto p-3 lg:p-4">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel className="flex w-full max-w-xl flex-col rounded-xl border border-border-default/70 bg-surface-default shadow-2xl transition duration-300 data-closed:scale-95 data-closed:translate-y-4 data-closed:opacity-0">

            {/* ─── Header ────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-text-muted" />
                <DialogTitle className="text-sm font-semibold text-text-default">
                  Import WhatsApp Chat
                </DialogTitle>
                {step !== "paste" && (
                  <span className="rounded-xl bg-surface-subtle px-2 py-0.5 font-mono text-[10px] text-text-muted">
                    {currentStepNumber} / {totalSteps}
                  </span>
                )}
              </div>
              <button
                onClick={handleClose}
                className="rounded-sm p-1 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ─── Step 1: Paste ─────────────────────────────────────────── */}
            {step === "paste" && (
              <div className="flex flex-col gap-4 p-4">
                <p className="text-xs text-text-muted">
                  Paste exported WhatsApp chat text, or upload the WhatsApp ZIP export for
                  automatic chat + PDF matching. PDF references — including{" "}
                  <code className="rounded-sm bg-surface-subtle px-1 py-0.5 text-[10px]">
                    &lt;attached: file.pdf&gt;
                  </code>{" "}
                  and macOS pasteboard paths — are detected automatically.
                </p>

                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleZipSelect(file);
                    e.target.value = "";
                  }}
                />

                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border-subtle bg-surface-subtle/40 px-3 py-2">
                  <button
                    onClick={() => zipInputRef.current?.click()}
                    disabled={zipLoading}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle disabled:opacity-50"
                  >
                    {zipLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {zipLoading ? "Parsing ZIP…" : "Upload WhatsApp ZIP"}
                  </button>
                  {zipSourceName && (
                    <span className="text-[11px] text-text-muted">
                      Loaded: <span className="font-medium text-text-default">{zipSourceName}</span>
                    </span>
                  )}
                  {zipLoadError && (
                    <span className="text-[11px] text-red-500">{zipLoadError}</span>
                  )}
                </div>

                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="h-64 w-full resize-none rounded-sm border border-border-default bg-surface-subtle p-3 font-mono text-xs text-text-default placeholder:text-text-muted focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
                  placeholder={`[3/10/26, 7:42:30 PM] Alice: Hey!\n[3/10/26, 7:44:00 PM] Bob: Here is the doc\n[3/10/26, 7:44:01 PM] Bob: <attached: proposal.pdf>\n[3/10/26, 7:44:05 PM] Bob: /Users/you/.../proposal.pdf`}
                  spellCheck={false}
                />

                {/* Live feedback */}
                {rawText.trim() && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                    {liveMsgs.length === 0 ? (
                      <span className="flex items-center gap-1 text-amber-500">
                        <AlertTriangle className="h-3 w-3" />
                        No messages recognized — check the format.
                      </span>
                    ) : (
                      <>
                        <span className="text-text-muted">
                          <span className="font-semibold text-text-default">
                            {liveMsgs.length}
                          </span>{" "}
                          message{liveMsgs.length !== 1 ? "s" : ""}
                        </span>
                        <span className="text-text-muted">
                          <span className="font-semibold text-text-default">
                            {liveSenders.length}
                          </span>{" "}
                          sender{liveSenders.length !== 1 ? "s" : ""}
                        </span>
                        {livePdfCount > 0 && (
                          <span className="flex items-center gap-1 font-medium text-blue-500">
                            <FileText className="h-3 w-3" />
                            {livePdfCount} PDF{livePdfCount !== 1 ? "s" : ""} detected
                          </span>
                        )}
                        {liveMediaCount > 0 && (
                          <span className="flex items-center gap-1 text-text-muted">
                            <ImageIcon className="h-3 w-3" />
                            {liveMediaCount} media (skipped)
                          </span>
                        )}
                        {liveCleanedSenders > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            Cleaned {liveCleanedSenders} sender name
                            {liveCleanedSenders !== 1 ? "s" : ""} (removed ~ prefix)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleParseAndNext}
                    disabled={!rawText.trim() || liveMsgs.length === 0 || liveImportable === 0}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:opacity-90 disabled:opacity-50"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ─── Step 2: Select range ─────────────────────────────────── */}
            {step === "range" && (
              <div className="flex flex-col gap-4 p-4">
                <div>
                  <p className="text-xs font-medium text-text-default">Select chat range</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    Choose chronological turns to import before persona mapping. Use the
                    preview below to set start/end precisely.
                  </p>
                </div>

                <div className="rounded-sm border border-border-subtle bg-surface-subtle/40 px-3 py-2 text-[11px] text-text-muted flex items-center justify-between">
                  <div>
                    Total turns: <span className="font-semibold text-text-default">{parsedTurns.length}</span>
                    {" · "}
                    Selected: <span className="font-semibold text-text-default">{selectedTurns.length}</span>
                    {" · "}
                    Importable: <span className="font-semibold text-text-default">{rangeImportableCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-text-muted">Quick adjust:</div>
                    <button
                      onClick={() => setRangeStart((s) => Math.max(0, s - 1))}
                      title="Move start back"
                      className="rounded-sm border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setRangeStart((s) => Math.min(s + 1, rangeEnd))}
                      title="Move start forward"
                      className="rounded-sm border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                    From turn
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRangeStart((s) => Math.max(0, s - 1))}
                        className="rounded-sm border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="decrement start"
                      >-</button>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, parsedTurns.length)}
                        value={Math.min(rangeStart + 1, Math.max(1, parsedTurns.length))}
                        onChange={(e) => {
                          const max = Math.max(1, parsedTurns.length);
                          const next = Math.min(
                            Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
                            max,
                          ) - 1;
                          setRangeStart(next);
                          if (next > rangeEnd) setRangeEnd(next);
                        }}
                        className="rounded-sm border border-border-default bg-surface-default px-2 py-1 text-xs text-text-default focus:border-action-primary-bg focus:outline-none"
                      />
                      <button
                        onClick={() => setRangeStart((s) => Math.min(s + 1, rangeEnd))}
                        className="rounded-sm border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="increment start"
                      >+</button>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                    To turn
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRangeEnd((e) => Math.max(e - 1, rangeStart))}
                        className="rounded-sm border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="decrement end"
                      >-</button>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, parsedTurns.length)}
                        value={Math.min(rangeEnd + 1, Math.max(1, parsedTurns.length))}
                        onChange={(e) => {
                          const max = Math.max(1, parsedTurns.length);
                          const next = Math.min(
                            Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
                            max,
                          ) - 1;
                          setRangeEnd(next);
                          if (next < rangeStart) setRangeStart(next);
                        }}
                        className="rounded-sm border border-border-default bg-surface-default px-2 py-1 text-xs text-text-default focus:border-action-primary-bg focus:outline-none"
                      />
                      <button
                        onClick={() => setRangeEnd((e) => Math.min(e + 1, parsedTurns.length - 1))}
                        className="rounded-sm border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="increment end"
                      >+</button>
                    </div>
                  </label>
                </div>

                {/* Preview list with clickable controls to set start/end */}
                <div className="max-h-48 overflow-y-auto rounded-sm border border-border-subtle bg-surface-subtle/30 p-2 text-[11px]">
                  {parsedTurns.length === 0 ? (
                    <div className="text-text-muted">No turns to preview.</div>
                  ) : (
                    parsedTurns.map((t, idx) => {
                      const isSelected = idx >= rangeStart && idx <= rangeEnd;
                      // Determine preview + optional size for PDFs when file is available
                      let preview = "";
                      let fullPreview = "";
                      if (t.type === "text") {
                        fullPreview = (t.messages && t.messages.join("\n\n")) || "";
                        preview = t.messages?.[0]?.slice(0, 120) ?? "";
                      } else if (t.type === "pdf") {
                        const filename = t.filename ?? "document.pdf";
                        const matchedFile = uploads[t.id]?.file ?? findBestPdfForTurn(t, zipPdfIndex);
                        const sizeStr = matchedFile ? ` (${formatBytes(matchedFile.size)})` : "";
                        preview = `PDF: ${filename}${sizeStr}`;
                        fullPreview = preview;
                      } else {
                        preview = `Media: ${t.mediaKind ?? "file"}`;
                        fullPreview = preview;
                      }
                      return (
                        <div
                          key={t.id}
                          className={`relative flex items-center justify-between gap-3 px-2 py-1 rounded-sm ${isSelected ? "bg-action-primary-bg/10 border border-action-primary-bg/20" : "hover:bg-surface-subtle"}`}
                        >
                          <div
                            className="min-w-0 flex-1 text-[11px]"
                            onMouseEnter={(e) => handlePreviewMouseEnter(e, idx, fullPreview)}
                            onMouseLeave={handlePreviewMouseLeave}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-text-muted">#{idx + 1}</span>
                              <span className="font-medium text-text-default truncate">{t.sender}</span>
                            </div>
                            <div className="truncate text-[10px] text-text-muted">{preview}</div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setRangeStart(idx)}
                              title="Set as start"
                              className="rounded-sm border border-border-default px-2 py-1 text-[11px] text-text-default hover:bg-surface-subtle"
                            >Start</button>
                            <button
                              onClick={() => setRangeEnd(idx)}
                              title="Set as end"
                              className="rounded-sm border border-border-default px-2 py-1 text-[11px] text-text-default hover:bg-surface-subtle"
                            >End</button>
                          </div>
                          {/* Tooltip is rendered in a portal to avoid affecting layout */}
                        </div>
                      );
                    })
                  )}
                </div>

                {selectedTurns.length > 0 && (
                  <div className="rounded-sm border border-border-subtle px-3 py-2 text-[11px] text-text-muted">
                    <p>
                      Start: <span className="font-medium text-text-default">{selectedTurns[0]?.sender}</span>
                      {selectedTurns[0]?.type === "pdf" ? " · PDF" : ""}
                    </p>
                    <p>
                      End: <span className="font-medium text-text-default">{selectedTurns[selectedTurns.length - 1]?.sender}</span>
                      {selectedTurns[selectedTurns.length - 1]?.type === "pdf" ? " · PDF" : ""}
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setStep("paste")}
                    className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text-default"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                  </button>

                  <button
                    onClick={handleRangeNext}
                    disabled={rangeImportableCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:opacity-90 disabled:opacity-50"
                  >
                    Next: Map Personas
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ─── Step 3: Map personas ────────────────────────────────────── */}
            {step === "map" && (
              <div className="flex flex-col gap-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-text-default">
                      Map senders to personas
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {textTurns.length} text turn{textTurns.length !== 1 ? "s" : ""}
                      {pdfTurns.length > 0 &&
                        ` · ${pdfTurns.length} PDF attachment${pdfTurns.length !== 1 ? "s" : ""}`}
                      {mediaTurns.length > 0 &&
                        ` · ${mediaTurns.length} media skipped`}
                    </p>
                  </div>
                  {unmappedCount > 0 && (
                    <span className="flex shrink-0 items-center gap-1 rounded-xl bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {unmappedCount} unmapped
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {mappableSenders.map((sender, idx) => {
                    const assignedId = mapping[sender];
                    const assignedPersona = personas?.find((p) => p.id === assignedId);
                    const isCreating = creatingPersonaFor === sender;

                    return (
                      <div
                        key={sender}
                        className="flex items-center gap-3 rounded-sm border border-border-subtle bg-surface-subtle/40 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-default">
                          {sender}
                        </span>

                        {assignedPersona ? (
                          <div className="flex items-center gap-1.5">
                            <div
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm"
                              style={{
                                backgroundColor: `${assignedPersona.color}20`,
                                color: assignedPersona.color,
                              }}
                            >
                              <DynamicIcon name={assignedPersona.icon} className="h-3 w-3" />
                            </div>
                            <span className="text-xs text-text-default">{assignedPersona.name}</span>
                            <button
                              onClick={() =>
                                setMapping((prev) => {
                                  const next = { ...prev };
                                  delete next[sender];
                                  return next;
                                })
                              }
                              className="rounded-sm p-0.5 text-text-muted hover:bg-surface-subtle hover:text-text-default"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <select
                            value=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "__create__") {
                                void handleCreatePersona(sender, idx);
                              } else if (val) {
                                setMapping((prev) => ({ ...prev, [sender]: val }));
                              }
                            }}
                            disabled={isCreating}
                            className="rounded-sm border border-border-default bg-surface-default px-2 py-1 text-xs text-text-default focus:border-action-primary-bg focus:outline-none disabled:opacity-60"
                          >
                            <option value="" disabled>
                              {isCreating ? "Creating…" : "Select persona…"}
                            </option>
                            {personas?.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                            <option value="__create__">
                              + Create &quot;{sender}&quot;
                            </option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>

                {unmappedCount > 0 && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => void handleCreateAllMissingPersonas()}
                      disabled={creatingAllPersonas}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-border-default px-2.5 py-1 text-[11px] text-text-default hover:bg-surface-subtle disabled:opacity-50"
                    >
                      {creatingAllPersonas && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Create all missing personas ({unmappedCount})
                    </button>
                  </div>
                )}

                {hasPdfTurns && allMapped && (
                  <div className="flex items-start gap-1.5 rounded-sm border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px] text-blue-600 dark:text-blue-400">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      {pdfTurns.length} PDF file{pdfTurns.length !== 1 ? "s" : ""} detected.
                      {zipSourceName
                        ? ` ${autoMatchCount} matched from ZIP and will queue automatically on the next step.`
                        : " On the next screen you'll select files to queue. Processing starts only when you press Import."}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setStep("range")}
                    className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text-default"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                  </button>

                  {hasPdfTurns ? (
                    <button
                      onClick={handleMapNext}
                      disabled={!allMapped}
                      className="inline-flex items-center gap-1.5 rounded-sm bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:opacity-90 disabled:opacity-50"
                    >
                      Next: Attach PDFs
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={handleMapNext}
                      disabled={!allMapped || textTurns.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-sm bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:opacity-90 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Import {textTurns.length} turn{textTurns.length !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ─── Step 4: Attach PDFs ─────────────────────────────────────── */}
            {step === "files" && (
              <div className="flex flex-col gap-4 p-4">
                <div>
                  <p className="text-xs font-medium text-text-default">
                    Attach PDF files
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    Select each detected PDF from your computer. Files are queued here,
                    then uploaded and processed only when you press Import.
                  </p>
                  {zipSourceName && (
                    <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">
                      ZIP source: {zipSourceName} · {autoMatchCount}/{pdfTurns.length} PDF
                      {pdfTurns.length !== 1 ? "s" : ""} auto-matched.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {pdfTurns.map((turn) => {
                    const upload = uploads[turn.id] ?? { status: "pending" as const };
                    return (
                      <PdfUploadRow
                        key={turn.id}
                        turn={turn}
                        upload={upload}
                        onFileSelect={(file) => handleFileSelect(turn.id, file)}
                        onRetry={() =>
                          upload.file && handleFileSelect(turn.id, upload.file)
                        }
                        onSkip={() =>
                          setUploads((prev) => ({
                            ...prev,
                            [turn.id]: { ...prev[turn.id], status: "skipped" },
                          }))
                        }
                        onUnskip={() =>
                          setUploads((prev) => ({
                            ...prev,
                            [turn.id]: { ...prev[turn.id], status: "pending" },
                          }))
                        }
                      />
                    );
                  })}
                </div>

                {/* Summary */}
                <div className="rounded-sm border border-border-subtle bg-surface-subtle/40 px-3 py-2 text-[11px] text-text-muted">
                  <span className="font-semibold text-text-default">{plannedImportableCount}</span>{" "}
                  section{plannedImportableCount !== 1 ? "s" : ""} planned
                  ({textTurns.length} text
                  {(doneUploadCount + queuedUploadCount) > 0 &&
                    `, ${doneUploadCount + queuedUploadCount} PDF queued/ready`}).
                  {skippedPdfs.length > 0 && (
                    <span className="ml-1">
                      {skippedPdfs.length} PDF{skippedPdfs.length !== 1 ? "s" : ""} skipped.
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setStep("map")}
                    disabled={anyUploading}
                    className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text-default disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                  </button>

                  <button
                    onClick={() => void handleProcessAndConfirm()}
                    disabled={!canConfirmFiles}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:opacity-90 disabled:opacity-50"
                  >
                    {anyUploading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Processing PDFs…
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Process & Import {plannedImportableCount} section
                        {plannedImportableCount !== 1 ? "s" : ""}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

          </DialogPanel>
        </div>
        {/* Portal tooltip: render global tooltip so it doesn't affect modal layout */}
        {typeof document !== "undefined" && tooltipVisible && tooltipContent && tooltipPos
          ? createPortal(
              <div
                style={{ left: tooltipPos.left, top: tooltipPos.top, width: tooltipPos.width }}
                className="fixed z-50 rounded-sm border border-border-default bg-surface-default p-2 text-xs text-text-default shadow-lg"
              >
                <div className="whitespace-pre-wrap wrap-break-word text-[12px]">{tooltipContent}</div>
              </div>,
              document.body,
            )
          : null}
      </div>
    </Dialog>
  );
}

// ─── PdfUploadRow sub-component ───────────────────────────────────────────────

function PdfUploadRow({
  turn,
  upload,
  onFileSelect,
  onRetry,
  onSkip,
  onUnskip,
}: {
  turn: ParsedTurn;
  upload: PdfUploadState;
  onFileSelect: (file: File) => void;
  onRetry: () => void;
  onSkip: () => void;
  onUnskip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(() => {
    if (!upload.file) return undefined;
    return URL.createObjectURL(upload.file);
  }, [upload.file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const filename = turn.filename ?? "document.pdf";
  const isSkipped = upload.status === "skipped";
  const isDone = upload.status === "done";
  const isUploading = upload.status === "uploading";
  const isError = upload.status === "error";
  const isQueued = upload.status === "pending" && !!upload.file;

  return (
    <div
      className={`flex flex-col gap-2 rounded-sm border px-3 py-2.5 transition-opacity ${
        isSkipped
          ? "border-border-subtle/40 opacity-50"
          : isDone
            ? "border-green-500/20 bg-green-500/5"
            : "border-border-subtle bg-surface-subtle/30"
      }`}
    >
      <div className="flex items-start gap-2">
        {upload.file ? (
          <PdfAttachmentThumbnail
            url={previewUrl}
            storagePath={upload.storagePath}
            thumbnailPath={upload.thumbnailPath}
            title={filename}
          />
        ) : (
          <FileText
            className={`mt-0.5 h-4 w-4 shrink-0 ${isDone ? "text-green-500" : "text-blue-500"}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-text-default">{filename}</p>
          {turn.fullPath && (
            <p
              className="truncate font-mono text-[10px] text-text-muted"
              title={turn.fullPath}
            >
              {turn.fullPath}
            </p>
          )}
          <p className="text-[10px] text-text-muted">
            Sent by {" "}
            <span className="font-medium text-text-default">{turn.sender}</span>
          </p>
          {upload.file && (
            <p className="text-[10px] text-text-muted">Size: {formatBytes(upload.file.size)}</p>
          )}
        </div>

        {/* Status indicator */}
        {isUploading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-action-primary-bg" />}
        {isDone && (
          <span className="flex shrink-0 items-center gap-1 rounded-xl bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" />
            Uploaded
          </span>
        )}
        {isSkipped && (
          <span className="shrink-0 rounded-xl bg-surface-subtle px-2 py-0.5 text-[10px] text-text-muted">
            Skipped
          </span>
        )}
        {isQueued && (
          <span className="shrink-0 rounded-xl bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
            Queued
          </span>
        )}
      </div>

      {/* Docling confirmation */}
      {isDone && upload.titleSnapshot && (
        <p className="text-[10px] text-text-muted">
          Docling processing started for{" "}
          <span className="font-medium text-text-default">
            &quot;{upload.titleSnapshot}&quot;
          </span>
        </p>
      )}

      {isQueued && (
        <p className="text-[10px] text-text-muted">
          Queued for processing. Docling starts when you press Import.
        </p>
      )}

      {/* Error message */}
      {isError && (
        <p className="wrap-break-word text-[10px] text-red-500">{upload.error}</p>
      )}

      {/* Action buttons */}
      {!isUploading && !isDone && (
        <div className="flex flex-wrap items-center gap-1.5">
          {isSkipped ? (
            <button
              onClick={onUnskip}
              className="inline-flex items-center gap-1 rounded-sm border border-border-default px-2 py-1 text-[11px] text-text-default hover:bg-surface-subtle"
            >
              <Undo2 className="h-3 w-3" />
              Undo skip
            </button>
          ) : (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileSelect(file);
                  e.target.value = "";
                }}
              />

              {isError && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-600 hover:bg-red-500/20 dark:text-red-400"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              )}

              <button
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-sm bg-action-primary-bg px-2 py-1 text-[11px] font-medium text-action-primary-text hover:opacity-90"
              >
                <Upload className="h-3 w-3" />
                {isError ? "Choose different file" : "Select file"}
              </button>

              <button
                onClick={onSkip}
                className="inline-flex items-center gap-1 rounded-sm border border-border-default px-2 py-1 text-[11px] text-text-muted hover:bg-surface-subtle hover:text-text-default"
              >
                <SkipForward className="h-3 w-3" />
                Skip
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
