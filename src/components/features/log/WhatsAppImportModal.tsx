"use client";

import { Fragment, useRef, useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useBlobUrl } from "@/lib/hooks/useBlobUrl";
import {
  Dialog,
  
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
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
  UserPlus,
} from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { FileAttachmentThumbnail } from "@/components/features/log/FileAttachmentThumbnail";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

declare global {
  interface Window {
    kolam_temp_files?: Map<
      string,
      { file: File; hash?: string; blobUrl?: string }
    >;
    kolam_pending_file_ids?: string[];
  }
}

const getTempFileStore = (): Map<
  string,
  { file: File; hash?: string; blobUrl?: string }
> => {
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
  if (process.env.NODE_ENV !== "production")
    console.debug("[WhatsApp] Set pending file IDs:", ids);
};

const generateFileId = (): string =>
  `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

import JSZip from "jszip";
import { calculateFileHash } from "@/lib/utils/hash";
import {
  DEFAULT_IMPORTED_PERSONA_TYPE,
  getPersonaScopeLabel,
} from "@/lib/personas";

// ─── Inject payload (consumed by EntryCreator) ────────────────────────────────

export interface WhatsAppInjectPayload {
  streamId: string;
  turns: Array<
    | {
        type: "text";
        personaId: string;
        personaName: string;
        messages: string[];
      }
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
  status: "pending" | "uploading" | "done" | "error" | "skipped" | "exists";
  file?: File;
  fileHash?: string;
  documentId?: string;
  storagePath?: string;
  thumbnailPath?: string;
  titleSnapshot?: string;
  previewUrl?: string; // Preserve local Blob URL after upload
  error?: string;
  existingDocument?: {
    id?: string;
    storagePath?: string;
    thumbnailPath?: string | null;
    title?: string;
    created_at?: string;
    user_id?: string | null;
  } | null;
}

interface ParsedZipData {
  chatText: string;
  pdfByKey: Record<string, File[]>;
}

type Step = "paste" | "range" | "map" | "files";

function getSupabaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Failed to create persona";

  const typed = error as { message?: unknown; code?: unknown };
  const message =
    typeof typed.message === "string" && typed.message.length > 0
      ? typed.message
      : "Failed to create persona";

  // 42703: undefined_column (migration not applied yet)
  if (typed.code === "42703") {
    return "Local persona columns are missing in the database. Apply the latest migration and try again.";
  }

  return message;
}

function normalizePersonaNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function isLocalPersona(persona: { is_shadow?: boolean | null }): boolean {
  return persona.is_shadow === true;
}

function getStreamLocalPersonas<
  T extends { is_shadow?: boolean | null; shadow_stream_id?: string | null },
>(personas: T[] | undefined, streamId?: string): T[] {
  return (personas ?? []).filter(
    (persona) =>
      isLocalPersona(persona) &&
      (streamId ? persona.shadow_stream_id === streamId : false),
  );
}

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
  // Strip only leading Unicode directional/invisible marks WhatsApp inserts.
  // Do not trim whitespace so multiline markdown/list formatting is preserved.
  return inStr.replace(/^[\u200E\u200F\u202A-\u202E\u2066-\u2069]+/, "");
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

function derivePreferredPdfTitle(
  caption?: string,
  fallbackFilename?: string,
): string | undefined {
  const trimmed = (caption ?? "").trim();
  if (!trimmed) return undefined;

  const beforeMeta = trimmed.split("•")[0]?.trim() ?? trimmed;
  const cleaned = beforeMeta
    .replace(/\s{2,}/g, " ")
    .replace(/\.pdf$/i, "")
    .trim();
  const fallbackBase = (fallbackFilename ?? "")
    .replace(/\.pdf$/i, "")
    .trim()
    .toLowerCase();
  if (!cleaned || cleaned.toLowerCase() === fallbackBase) return undefined;
  return cleaned;
}

function classifyText(raw?: string): ClassifiedText {
  const t = stripInvisible(raw).trim();

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
    if (/\.pdf$/i.test(name))
      return { type: "pdf", cleanText: t, filename: name };
    const ext = name.split(".").pop()?.toLowerCase() ?? "file";
    return { type: "media", cleanText: t, mediaKind: ext, filename: name };
  }

  // Absolute path ending in .pdf (macOS pasteboard, Windows, Unix)
  const pdfPathM = t.match(/^(\/[^\n\r]+\.pdf|[A-Za-z]:[\\\/][^\n\r]+\.pdf)$/i);
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
    return {
      type: "media",
      cleanText: t,
      mediaKind: omittedM[1].toLowerCase(),
    };
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
  let current: { sender: string; senderRaw: string; text: string } | null =
    null;
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
      const cleanLine = line.replace(/\r$/, "");
      lastLine = cleanLine;
      const normalizedLine = normalizeWhatsAppHeaderLine(cleanLine);
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
        // Preserve blank lines and indentation so markdown-like blocks remain intact.
        const continuation = stripInvisible(cleanLine);
        current.text += "\n" + continuation;
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
  return (
    inVal.replace(/\\/g, "/").split("/").pop()?.trim()?.toLowerCase() ?? ""
  );
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
  const txtEntries: Array<{
    path: string;
    content: string;
    messageCount: number;
  }> = [];
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
    if (b.messageCount !== a.messageCount)
      return b.messageCount - a.messageCount;
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
        is_shadow?: boolean | null;
        shadow_stream_id?: string | null;
      }>
    | undefined,
  streamId?: string,
): Record<string, string> {
  const autoMap: Record<string, string> = {};
  for (const sender of senders) {
    // Only use existing local personas for this stream
    const localMatch = personas?.find(
      (p) =>
        p.is_shadow &&
        p.shadow_stream_id === streamId &&
        p.name.toLowerCase() === sender.toLowerCase(),
    );
    if (localMatch) {
      autoMap[sender] = localMatch.id;
      continue;
    }
  }
  return autoMap;
}

const PERSONA_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#14b8a6",
  "#a855f7",
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
  const { personas } = usePersonas({ streamId, includeLocal: true });
  const queryClient = useQueryClient();
  const supabase = createClient();

  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [parsedTurns, setParsedTurns] = useState<ParsedTurn[]>([]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [mappableSenders, setMappableSenders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [creatingAllPersonas, setCreatingAllPersonas] = useState(false);
  const [uploads, setUploads] = useState<Record<string, PdfUploadState>>({});
  const [zipSourceName, setZipSourceName] = useState<string | null>(null);
  const [zipPdfIndex, setZipPdfIndex] = useState<Record<string, File[]>>({});
  const [zipLoadError, setZipLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipAutoUploadRan, setZipAutoUploadRan] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [allPdfsExistDialogOpen, setAllPdfsExistDialogOpen] = useState(false);
  const [existingLocalReuseCount, setExistingLocalReuseCount] = useState(0);
  const [pendingPersonaCreations, setPendingPersonaCreations] = useState<string[]>([]);
  const [draftPersonas, setDraftPersonas] = useState<Record<string, {
    id: string;
    name: string;
    color: string;
    icon: string;
    is_shadow: true;
    isDraft: true;
  }>>({});
  // Abort flag to avoid creating personas if the modal is closed/discarded
  const creatingAbortRef = useRef(false);

  // Preview tooltip state (custom tooltip with configurable timing)
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipContent, setTooltipContent] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
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

  const handlePreviewMouseEnter = (
    e: React.MouseEvent,
    idx: number,
    content: string,
  ) => {
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
  const anyUploading = Object.values(uploads).some(
    (u) => u.status === "uploading",
  );
  const doneUploadCount = Object.values(uploads).filter(
    (u) => u.status === "done" || u.status === "exists",
  ).length;
  const queuedUploadCount = Object.values(uploads).filter(
    (u) => u.status === "pending" && !!u.file,
  ).length;
  const skippedPdfs = pdfTurns.filter(
    (t) => uploads[t.id]?.status === "skipped",
  );
  const plannedImportableCount =
    textTurns.length + doneUploadCount + queuedUploadCount;
  const allPdfsPrepared = pdfTurns.every((turn) => {
    const upload = uploads[turn.id];
    if (!upload) return false;
    if (upload.status === "skipped" || upload.status === "done" || upload.status === "exists") return true;
    return !!upload.file;
  });
  // Live preview (step 1 only)
  const liveMsgs = rawText.trim() ? parseRawMessages(rawText) : [];
  const liveTurns = buildTurns(liveMsgs);
  const liveSenders = getMappableSenders(liveTurns);
  const livePdfCount = liveTurns.filter((t) => t.type === "pdf").length;
  const liveMediaCount = liveTurns.filter((t) => t.type === "media").length;
  const liveImportable = liveTurns.filter((t) => t.type !== "media").length;
  const liveCleanedSenders = countCleanedSenders(liveMsgs);
  const autoMatchCount = pdfTurns.filter((t) =>
    findBestPdfForTurn(t, zipPdfIndex),
  ).length;
  const rangeImportableCount = selectedTurns.filter(
    (t) => t.type !== "media",
  ).length;
  const localPersonas = useMemo(
    () => getStreamLocalPersonas(personas, streamId),
    [personas, streamId],
  );
  const globalPersonas = useMemo(
    () => (personas ?? []).filter((persona) => !isLocalPersona(persona)),
    [personas],
  );

  // Documents the user/stream already has — used for duplicate detection
  const { documents } = useDocuments(streamId);

  const localPersonaIds = useMemo(
    () => new Set(localPersonas.map((p) => p.id)),
    [localPersonas],
  );
  const globalPersonaIds = useMemo(
    () => new Set(globalPersonas.map((p) => p.id)),
    [globalPersonas],
  );
  const draftPersonaIds = useMemo(
    () => new Set(Object.keys(draftPersonas)),
    [draftPersonas],
  );
  const validMapping = Object.fromEntries(
    Object.entries(mapping).filter(([, id]) =>
      localPersonaIds.has(id) ||
      globalPersonaIds.has(id) ||
      draftPersonaIds.has(id),
    ),
  );
  const allMapped = mappableSenders.every((s) => !!validMapping[s]);
  const unmappedCount = mappableSenders.filter((s) => !validMapping[s]).length;
  const canConfirmFiles =
    allMapped && !anyUploading && allPdfsPrepared && plannedImportableCount > 0;

  const getValidMapping = (snapshot: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(snapshot).filter(([, id]) =>
        localPersonaIds.has(id) ||
        globalPersonaIds.has(id) ||
        draftPersonaIds.has(id),
      ),
    );

  // Keep pendingPersonaCreations in sync if the user maps senders manually
  useEffect(() => {
    if (pendingPersonaCreations.length === 0) return;
    setPendingPersonaCreations((prev) =>
      prev.filter((sender) => {
        const mappedId = mapping[sender];
        // keep sender pending only while it is still pointing at a local draft
        return !mappedId || draftPersonaIds.has(mappedId);
      }),
    );
  }, [mapping, draftPersonaIds, pendingPersonaCreations.length]);

  type PersonaCreateRow = {
    name: string;
    color: string;
    icon: string;
    type: string;
    user_id: string;
    is_system: false;
  };

  const insertMissingPersonas = async (
    rows: PersonaCreateRow[],
    localStreamId: string,
  ) => {
    if (rows.length === 0) {
      return {
        data: [] as Array<{ id: string; name: string }>,
        error: null as unknown,
      };
    }

    const dedupedRows = Object.values(
      rows.reduce<Record<string, PersonaCreateRow>>((acc, row) => {
        const key = normalizePersonaNameKey(row.name);
        if (!acc[key]) acc[key] = row;
        return acc;
      }, {}),
    );

    const requestedNames = dedupedRows.map((row) => row.name);
    const userId = dedupedRows[0].user_id;

    const existingResult = await supabase
      .from("personas")
      .select("id, name")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("is_shadow", true)
      .eq("shadow_stream_id", localStreamId)
      .in("name", requestedNames);

    if (existingResult.error) {
      return {
        data: null,
        error: existingResult.error,
      };
    }

    const existingRows = existingResult.data ?? [];
    const existingNameKeys = new Set(
      existingRows.map((row) => normalizePersonaNameKey(row.name)),
    );

    const rowsToInsert = dedupedRows.filter(
      (row) => !existingNameKeys.has(normalizePersonaNameKey(row.name)),
    );

    if (rowsToInsert.length === 0) {
      return {
        data: existingRows,
        error: null as unknown,
      };
    }

    const localRows = rowsToInsert.map((row) => ({
      ...row,
      is_shadow: true,
      shadow_stream_id: localStreamId,
    }));

    const insertResult = await supabase
      .from("personas")
      .insert(localRows)
      .select("id, name");

    if (insertResult.error) {
      if (insertResult.error.code === "23505") {
        const retryExistingResult = await supabase
          .from("personas")
          .select("id, name")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .eq("is_shadow", true)
          .eq("shadow_stream_id", localStreamId)
          .in("name", requestedNames);

        if (!retryExistingResult.error && retryExistingResult.data) {
          return {
            data: retryExistingResult.data,
            error: null as unknown,
          };
        }
      }
      return {
        data: null,
        error: insertResult.error,
      };
    }

    return {
      data: [...existingRows, ...(insertResult.data ?? [])],
      error: null as unknown,
    };
  };

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
    setMapError(null);
    setMapNotice(null);
    setZipAutoUploadRan(false);
    setExistingLocalReuseCount(0);
    setPendingPersonaCreations([]);
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
      setMapError(null);
      setMapNotice(null);
      setZipAutoUploadRan(false);
      setExistingLocalReuseCount(0);
      setPendingPersonaCreations([]);
      setStep("range");
    } catch (error) {
      setZipLoadError(
        error instanceof Error ? error.message : "Failed to parse ZIP export",
      );
    } finally {
      setZipLoading(false);
    }
  };

  const handleRangeNext = async () => {
    if (selectedTurns.length === 0) return;
    const senders = getMappableSenders(selectedTurns);
    setMappableSenders(senders);

    const existingLocalsBySender = senders.filter((s) =>
      localPersonas.some(
        (p) => p.name.toLowerCase() === s.toLowerCase(),
      ),
    );
    setExistingLocalReuseCount(existingLocalsBySender.length);

    const auto = buildAutoMap(senders, personas, streamId);
    setMapping(auto);
    setUploads({});
    setMapError(null);
    setMapNotice(null);
    setZipAutoUploadRan(false);
    setStep("map");

    // Clear tooltip when leaving range step
    setTooltipVisible(false);
    setTooltipContent(null);
    setTooltipPos(null);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  const handleCreatePersonas = async (sendersToCreate: string[]): Promise<Record<string, string> | null> => {
    setMapError(null);
    setMapNotice(null);
    setCreatingAllPersonas(true);
    // Prevent creating personas if modal was closed/discarded
    if (!isOpen) {
      setCreatingAllPersonas(false);
      return null;
    }
    // Reset abort flag for this run
    creatingAbortRef.current = false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (creatingAbortRef.current || !isOpen) return null;
      if (!user) return null;

      const rows: PersonaCreateRow[] = sendersToCreate.map((sender, idx) => ({
        name: sender,
        color: PERSONA_COLORS[idx % PERSONA_COLORS.length],
        icon: "user",
        type: DEFAULT_IMPORTED_PERSONA_TYPE,
        user_id: user.id,
        is_system: false,
      }));

      const { data, error } = await insertMissingPersonas(rows, streamId);

      if (creatingAbortRef.current || !isOpen) {
        // If the modal was closed while the request was in-flight, don't apply results
        setCreatingAllPersonas(false);
        return null;
      }

      if (error || !data) {
        setMapError(getSupabaseErrorMessage(error));
        return null;
      }

      await queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "personas",
      });

      const createdMap: Record<string, string> = {};
      // Map created personas back to the original sender strings using normalized keys
      for (const created of data) {
        const createdKey = normalizePersonaNameKey(created.name);
        for (const sender of sendersToCreate) {
          if (normalizePersonaNameKey(sender) === createdKey) {
            createdMap[sender] = created.id;
          }
        }
      }

      if (Object.keys(createdMap).length === 0) {
        console.debug("[WhatsApp] No created map entries matched senders; created rows:", data);
      } else {
        setMapping((prev) => ({ ...prev, ...createdMap }));
      }

      // Remove created senders from pending
      setPendingPersonaCreations((prev) => prev.filter((s) => !createdMap[s]));

      // Remove any local drafts that correspond to created personas
      if (Object.keys(createdMap).length > 0) {
        setDraftPersonas((prev) => {
          const next = { ...prev };
          const createdNameKeys = new Set(Object.keys(createdMap).map((s) => normalizePersonaNameKey(s)));
          for (const key of Object.keys(prev)) {
            if (createdNameKeys.has(normalizePersonaNameKey(prev[key].name))) {
              delete next[key];
            }
          }
          return next;
        });
      }

      return createdMap;
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "An error occurred");
      return null;
    } finally {
      setCreatingAllPersonas(false);
    }
  };

  const handleMapNext = async () => {
    setMapError(null);
    setMapNotice(null);

    const nextMapping: Record<string, string> = getValidMapping(mapping);
    if (Object.keys(nextMapping).length !== Object.keys(mapping).length) {
      setMapping(nextMapping);
    }

    // Compute which senders should be created on confirm.
    // Preserve any existing pending creators (e.g., from Batch Create) and
    // include any senders currently mapped to local draft persona ids.
    const draftIds = new Set(Object.keys(draftPersonas));
    const toCreate = mappableSenders.filter((sender) => {
      const mappedId = mapping[sender];
      if (!mappedId) return true;
      if (draftIds.has(mappedId)) return true;
      return false;
    });

    // Merge with any previously-set pending creations to avoid clearing Batch-create
    setPendingPersonaCreations((prev) => {
      const merged = new Set(prev.concat(toCreate));
      return Array.from(merged);
    });

    if (!hasPdfTurns) {
      await handleConfirm(uploads, nextMapping);
      return;
    }

    // Duplicate-detection: compare file hashes and storage/name keys against existing documents
    try {
      const docs = documents ?? [];
      type DocLite = {
        source_metadata?: { fileHash?: string } | undefined;
        storage_path?: string | undefined;
        title?: string | undefined;
        id?: string;
        thumbnail_path?: string | undefined;
        created_at?: string | undefined;
        user_id?: string | null | undefined;
      };

      const docsByHash = new Map<string, DocLite>();
      const docsByKey = new Map<string, DocLite>();

      for (const d of docs) {
        const dd = d as unknown as DocLite;
        const fh = dd?.source_metadata?.fileHash;
        if (fh) docsByHash.set(String(fh).toLowerCase(), dd);
        const storage = dd?.storage_path ?? "";
        if (storage) docsByKey.set(normalizeAttachmentKey(storage), dd);
        const titleKey = normalizeAttachmentKey(dd?.title ?? "");
        if (titleKey) docsByKey.set(titleKey, dd);
      }

      const checks = await Promise.all(
        pdfTurns.map(async (t) => {
          const existingUpload = uploads[t.id];
          let fileHash = existingUpload?.fileHash;
          let matchedDoc: unknown | null = null;

          // If already have a hash from an earlier upload, prefer it
          if (fileHash) {
            matchedDoc = docsByHash.get(String(fileHash).toLowerCase()) ?? null;
          }

          // If not matched, try to find a file from ZIP and hash it
          if (!matchedDoc) {
            const candidate = findBestPdfForTurn(t, zipPdfIndex);
              if (candidate && !fileHash) {
                try {
                  fileHash = await calculateFileHash(candidate);
                } catch {
                  fileHash = undefined;
                }
                if (fileHash) matchedDoc = docsByHash.get(String(fileHash).toLowerCase()) ?? null;
              }
          }

          // Fallback: match by normalized filename/path
          if (!matchedDoc) {
            const key = normalizeAttachmentKey(t.filename ?? t.fullPath);
            if (key) matchedDoc = docsByKey.get(key) ?? null;
          }

          return { turnId: t.id, matchedDoc, fileHash };
        }),
      );

      const matchedAll = checks.every((c) => c.matchedDoc);

      // If all PDFs already exist for this stream/user, show dialog and don't proceed to files
      if (matchedAll && checks.length > 0) {
        // Annotate uploads state so UI can show details if needed
        setUploads((prev) => {
          const next: Record<string, PdfUploadState> = { ...prev };
          const normalizeDoc = (d: DocLite | undefined | null) =>
            d
              ? {
                  id: d.id,
                  storagePath: d.storage_path ?? undefined,
                  thumbnailPath: d.thumbnail_path ?? undefined,
                  title: d.title ?? undefined,
                  created_at: d.created_at ?? undefined,
                  user_id: d.user_id ?? undefined,
                }
              : null;

          for (const c of checks) {
            next[c.turnId] = {
              ...(next[c.turnId] ?? { status: "exists" }),
              status: "exists",
              fileHash: c.fileHash,
              existingDocument: normalizeDoc(c.matchedDoc as DocLite | null),
            };
          }
          return next;
        });

        setAllPdfsExistDialogOpen(true);
        return;
      }

      // Otherwise initialize upload slots (mark existing ones as exists)
      setUploads((prev) => {
        const next: Record<string, PdfUploadState> = { ...prev };
        for (const t of pdfTurns) {
          const check = checks.find((c) => c.turnId === t.id);
          if (check?.matchedDoc) {
            const normalizeDoc = (d: DocLite | undefined | null) =>
              d
                ? {
                    id: d.id,
                    storagePath: d.storage_path ?? undefined,
                    thumbnailPath: d.thumbnail_path ?? undefined,
                    title: d.title ?? undefined,
                    created_at: d.created_at ?? undefined,
                    user_id: d.user_id ?? undefined,
                  }
                : null;

            next[t.id] = {
              ...(next[t.id] ?? {}),
              status: "exists",
              fileHash: check.fileHash,
              existingDocument: normalizeDoc(check.matchedDoc as DocLite | null),
            };
          } else {
            if (!next[t.id]) next[t.id] = { status: "pending" };
            else next[t.id].status = next[t.id].status ?? "pending";
          }
        }
        return next;
      });

      setStep("files");

      // Clear tooltip when leaving map step (though tooltip is only in range, be safe)
      setTooltipVisible(false);
      setTooltipContent(null);
      setTooltipPos(null);
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      if (!zipAutoUploadRan && Object.keys(zipPdfIndex).length > 0) {
        setZipAutoUploadRan(true);
        for (const t of pdfTurns) {
          // Only auto-fill files for turns that are not already existing
          if ((uploads[t.id]?.status ?? "") === "exists") continue;
          const matched = findBestPdfForTurn(t, zipPdfIndex);
          if (!matched) continue;
          handleFileSelect(t.id, matched, t.preferredTitle ?? t.filename);
        }
      }
    } catch {
      // Fallback to original behavior if duplicate-check fails
      setUploads((prev) => {
        const next: Record<string, PdfUploadState> = { ...prev };
        for (const t of pdfTurns) {
          if (!next[t.id]) next[t.id] = { status: "pending" };
        }
        return next;
      });
      setStep("files");
    }
  };

  const handleFileSelect = async (
    turnId: string,
    file: File,
    titleHint?: string,
  ) => {
    const blobUrl = URL.createObjectURL(file);
    const safeTitle =
      titleHint?.trim() ||
      file.name.replace(/\.[^/.]+$/, "") ||
      "Document";

    setUploads((prev) => ({
      ...prev,
      [turnId]: {
        ...prev[turnId],
        status: "uploading",
        file,
        previewUrl: blobUrl,
        titleSnapshot: safeTitle,
        error: undefined,
      },
    }));

    try {
      const fileHash = await calculateFileHash(file);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("streamId", streamId);
      formData.append("title", safeTitle);
      formData.append("fileHash", fileHash);

      const response = await fetch("/api/sections/attachments/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            document?: {
              id: string;
              storage_path: string;
              thumbnail_path: string | null;
              title: string;
            };
            previewUrl?: string | null;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error ?? "Failed to upload attachment");
      }

      const doc = payload.document;

      setUploads((prev) => ({
        ...prev,
        [turnId]: {
          ...prev[turnId],
          status: "pending",
          file,
          fileHash,
          documentId: doc.id,
          storagePath: doc.storage_path,
          thumbnailPath: doc.thumbnail_path ?? undefined,
          previewUrl: payload.previewUrl ?? blobUrl,
          titleSnapshot: doc.title || safeTitle,
          error: undefined,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload attachment";
      setUploads((prev) => ({
        ...prev,
        [turnId]: {
          ...prev[turnId],
          status: "error",
          file,
          previewUrl: blobUrl,
          error: message,
        },
      }));
    }
  };

  const handleProcessAndConfirm = async () => {
    if (!canConfirmFiles) return;

    if (process.env.NODE_ENV !== "production")
      console.debug(
        "[WhatsApp] handleProcessAndConfirm started with selectedTurns:",
        {
          count: selectedTurns.length,
          types: selectedTurns.map((t) => t.type),
        },
      );

    // Create any pending personas before importing
    let effectiveMapping = getValidMapping(mapping);
    if (pendingPersonaCreations.length > 0) {
      const createdMap = await handleCreatePersonas(pendingPersonaCreations);
      if (!createdMap) return; // Creation failed, don't proceed
      effectiveMapping = { ...effectiveMapping, ...createdMap };
      setPendingPersonaCreations([]);
    }

    // Transfer all text turns and any already-completed PDFs to EntryCreator
    // Transfer all pending PDF files to the Docling document import handler
    const payloadTurns: WhatsAppInjectPayload["turns"] = [];
    const transferFiles: Array<{ file: File; hash?: string }> = [];

    for (const turn of selectedTurns) {
      if (turn.type === "media") continue;
      const personaId = effectiveMapping[turn.sender];
      if (!personaId) continue;
      const persona = personas?.find((p) => p.id === personaId);
      const personaName = persona?.name ?? turn.sender;

      if (turn.type === "text") {
        // All text turns go directly to EntryCreator
        payloadTurns.push({
          type: "text",
          personaId,
          personaName,
          messages: turn.messages!,
        });
      } else if (turn.type === "pdf") {
        const upload = uploads[turn.id];

        if (process.env.NODE_ENV !== "production")
          console.debug("[WhatsApp] Processing PDF turn:", {
          turnId: turn.id,
          filename: turn.filename,
          fullPath: turn.fullPath,
          uploadStatus: upload?.status,
          uploadFile: upload?.file
            ? { name: upload.file.name, size: upload.file.size }
            : null,
          });

        // If already uploaded (done) or already exists → include in inject payload
        if (
          (upload?.status === "done" && upload.documentId && upload.storagePath) ||
          (upload?.status === "exists" && upload.existingDocument && (upload.existingDocument.id || upload.existingDocument.storagePath))
        ) {
          const docId = upload?.status === "done" ? upload!.documentId : upload!.existingDocument?.id;
          const storagePath = upload?.status === "done" ? upload!.storagePath : upload!.existingDocument?.storagePath;
          const thumbnailPath = (upload?.status === "done" ? upload!.thumbnailPath : upload!.existingDocument?.thumbnailPath) ?? undefined;
          const titleFromDoc = upload?.status === "done" ? upload!.titleSnapshot : upload!.existingDocument?.title;

          const attachment = {
            documentId: docId,
            storagePath,
            thumbnailPath,
            ...(upload?.previewUrl ? { previewUrl: upload.previewUrl } : {}),
            titleSnapshot:
              upload.titleSnapshot ??
              titleFromDoc ??
              turn.preferredTitle ??
              turn.filename ??
              "Document",
          };

          const last = payloadTurns[payloadTurns.length - 1];
          if (last?.type === "pdf" && last.personaId === personaId) {
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
        // If pending with a file → include placeholder in inject + transfer to document import handler
        else if (upload?.file && upload.status === "pending") {
          const file = upload.file;

          if (process.env.NODE_ENV !== "production")
            console.debug("[WhatsApp] Queuing PDF file for transfer:", {
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type,
            });
          const hash = upload.fileHash ?? (await calculateFileHash(file));

          if (!transferFiles.find((f) => f.file === file)) {
            transferFiles.push({ file, hash });
          }

          // Create a blob URL for immediate preview display
          const blobUrl = URL.createObjectURL(file);

          // Track this preview URL within the upload state, even though it's still pending
          // Update synchronously without recreating the entire object
          upload.previewUrl = blobUrl;

          // Include placeholder attachment in inject payload so EntryCreator creates the section
          // The actual documentId will be added once Dockling processing completes
          const attachment = {
            documentId: upload.documentId,
            storagePath: upload.storagePath,
            thumbnailPath: upload.thumbnailPath,
            titleSnapshot:
              upload.titleSnapshot ??
              turn.preferredTitle ??
              turn.filename ??
              "Document",
            fileHash: hash,
            previewUrl: blobUrl,
          };

          const last = payloadTurns[payloadTurns.length - 1];
          if (last?.type === "pdf" && last.personaId === personaId) {
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
        // If skipped, error, or exists-without-doc, ignore (exists-with-doc handled above)
      }
    }

    // Dispatch all text turns and PDFs (including pending ones) to EntryCreator
    if (payloadTurns.length > 0) {
      if (process.env.NODE_ENV !== "production")
        console.debug("[WhatsApp] Dispatching kolam_whatsapp_import_inject:", {
          turnCount: payloadTurns.length,
          streamId,
        });
      window.dispatchEvent(
        new CustomEvent("kolam_whatsapp_import_inject", {
          detail: {
            streamId,
            turns: payloadTurns,
          } satisfies WhatsAppInjectPayload,
        }),
      );
    }

    // Transfer all pending PDF files to the document import handler for Docling processing
    if (transferFiles.length > 0) {
      // Start imports immediately so thumbnails and queued documents begin resolving

      const tempStore = getTempFileStore();
      const queuedFileIds: string[] = [];

      for (const fileData of transferFiles) {
        const id = generateFileId();
        // Create blob URL for preview
        const blobUrl = URL.createObjectURL(fileData.file);
        tempStore.set(id, { ...fileData, blobUrl });
        queuedFileIds.push(id);
      }

      // Store pending file IDs so they're available when DocumentImportModal opens
      setPendingFileIds(queuedFileIds);

      if (process.env.NODE_ENV !== "production")
        console.debug(
          "[WhatsApp] Storing files in temp store and dispatching kolam_header_documents_import:",
          {
            fileCount: transferFiles.length,
            fileIds: queuedFileIds,
            files: transferFiles.map((f) => ({
              name: f.file.name,
              size: f.file.size,
              hash: f.hash,
            })),
          },
        );

      window.dispatchEvent(
        new CustomEvent("kolam_header_documents_import", {
          detail: { fileIds: queuedFileIds },
        }),
      );
    }

    // Close the modal immediately
    handleClose();
  };

  const handleConfirm = async (
    uploadsSnapshot: Record<string, PdfUploadState> = uploads,
    mappingSnapshot: Record<string, string> = mapping,
  ) => {
    let effectiveMapping = getValidMapping(mappingSnapshot);

    // Create any pending personas before importing
    if (pendingPersonaCreations.length > 0) {
      const createdMap = await handleCreatePersonas(pendingPersonaCreations);
      if (!createdMap) return; // Creation failed, don't proceed
      effectiveMapping = { ...effectiveMapping, ...createdMap };
      setPendingPersonaCreations([]);
    }

    const payloadTurns: WhatsAppInjectPayload["turns"] = [];

    for (const turn of selectedTurns) {
      if (turn.type === "media") continue;
      const personaId = effectiveMapping[turn.sender];
      if (!personaId) continue;
      const persona = personas?.find((p) => p.id === personaId);
      const personaName = persona?.name ?? turn.sender;

      if (turn.type === "text") {
        payloadTurns.push({
          type: "text",
          personaId,
          personaName,
          messages: turn.messages!,
        });
      } else {
        const upload = uploadsSnapshot[turn.id];
        if (!upload) continue;
        if (upload.status === "done" && upload.documentId && upload.storagePath) {
          const attachment = {
            documentId: upload.documentId,
            storagePath: upload.storagePath,
            thumbnailPath: upload.thumbnailPath,
            ...(upload.previewUrl ? { previewUrl: upload.previewUrl } : {}),
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
        } else if (upload.status === "exists" && upload.existingDocument) {
          const ed = upload.existingDocument;
          const attachment = {
            documentId: ed.id,
            storagePath: ed.storagePath,
            thumbnailPath: ed.thumbnailPath ?? undefined,
            titleSnapshot:
              upload.titleSnapshot ?? ed.title ?? turn.preferredTitle ?? turn.filename ?? "Document",
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
    }

    if (payloadTurns.length === 0) return;

    window.dispatchEvent(
      new CustomEvent("kolam_whatsapp_import_inject", {
        detail: {
          streamId,
          turns: payloadTurns,
        } satisfies WhatsAppInjectPayload,
      }),
    );
    handleClose();
  };

  const handleClose = () => {
    // Signal any in-progress persona creation to abort
    creatingAbortRef.current = true;
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
    setMapError(null);
    setMapNotice(null);
    setZipLoading(false);
    setZipAutoUploadRan(false);
    setExistingLocalReuseCount(0);
    setPendingPersonaCreations([]);
    setDraftPersonas({});

    // Clear tooltip
    setTooltipVisible(false);
    setTooltipContent(null);
    setTooltipPos(null);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

    onClose();
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const totalSteps = hasPdfTurns ? 4 : 3;
  const currentStepNumber =
    step === "paste" ? 1 : step === "range" ? 2 : step === "map" ? 3 : 4;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        onClose={() => {
          // If user progressed past the paste step show confirmation
          if (step !== "paste") setConfirmExitOpen(true);
          else handleClose();
        }}
        className="relative z-50"
      >
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto p-2 lg:p-3">
          <div className="flex min-h-full items-center justify-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4"
              enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100 translate-y-0"
              leaveTo="opacity-0 translate-y-4"
            >
              <DialogPanel className="flex w-full max-w-xl flex-col border border-border-default/70 bg-surface-default shadow-2xl transition-all">
            {/* ─── Header ────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-text-muted" />
                <DialogTitle className="text-sm font-semibold text-text-default">
                  WhatsApp Import
                </DialogTitle>
                {step !== "paste" && (
                  <span className=" bg-surface-subtle px-2 py-0.5 font-mono text-[10px] text-text-muted">
                    {currentStepNumber} / {totalSteps}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  if (step !== "paste") setConfirmExitOpen(true);
                  else handleClose();
                }}
                className=" p-1 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ─── Step 1: Paste ─────────────────────────────────────────── */}
            {step === "paste" && (
              <div className="flex flex-col gap-3 p-3">
                <p className="text-xs text-text-muted">
                  Paste chat text or upload ZIP. PDF references like{" "}
                  <code className=" bg-surface-subtle px-1 py-0.5 text-[10px]">
                    &lt;attached: file.pdf&gt;
                  </code>{" "}
                  are detected automatically.
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

                <div className="flex flex-wrap items-center gap-2 border border-border-default bg-surface-subtle/40 px-3 py-2">
                  <button
                    onClick={() => zipInputRef.current?.click()}
                    disabled={zipLoading}
                    className="inline-flex items-center gap-1.5 border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle disabled:opacity-50"
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
                      Loaded:{" "}
                      <span className="font-medium text-text-default">
                        {zipSourceName}
                      </span>
                    </span>
                  )}
                  {zipLoadError && (
                    <span className="text-[11px] text-red-500">
                      {zipLoadError}
                    </span>
                  )}
                </div>

                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="h-56 w-full resize-none border border-border-default bg-surface-subtle p-3 font-mono text-xs text-text-default placeholder:text-text-muted focus:border-border-default focus: focus: focus:"
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
                            {livePdfCount} PDF{livePdfCount !== 1 ? "s" : ""}{" "}
                            detected
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
                            {liveCleanedSenders} sender name
                            {liveCleanedSenders !== 1 ? "s" : ""} cleaned
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                <StepFooter
                  onNext={handleParseAndNext}
                  nextDisabled={
                    !rawText.trim() ||
                    liveMsgs.length === 0 ||
                    liveImportable === 0
                  }
                  shortcutsEnabled={!confirmExitOpen}
                  nextContent={
                    <>
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>
            )}

            {/* ─── Step 2: Select range ─────────────────────────────────── */}
            {step === "range" && (
              <div className="flex flex-col gap-3 p-3">
                <div>
                  <p className="text-xs font-medium text-text-default">
                    Select chat range
                  </p>
                </div>

                <div className=" border border-border-default bg-surface-subtle/40 px-3 py-2 text-[11px] text-text-muted">
                  <div>
                    Total turns:{" "}
                    <span className="font-semibold text-text-default">
                      {parsedTurns.length}
                    </span>
                    {" · "}
                    Selected:{" "}
                    <span className="font-semibold text-text-default">
                      {selectedTurns.length}
                    </span>
                    {" · "}
                    Importable:{" "}
                    <span className="font-semibold text-text-default">
                      {rangeImportableCount}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                    From turn
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRangeStart((s) => Math.max(0, s - 1))}
                        className=" border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="decrement start"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, parsedTurns.length)}
                        value={Math.min(
                          rangeStart + 1,
                          Math.max(1, parsedTurns.length),
                        )}
                        onChange={(e) => {
                          const max = Math.max(1, parsedTurns.length);
                          const next =
                            Math.min(
                              Math.max(
                                1,
                                Number.parseInt(e.target.value || "1", 10) || 1,
                              ),
                              max,
                            ) - 1;
                          setRangeStart(next);
                          if (next > rangeEnd) setRangeEnd(next);
                        }}
                        className=" border border-border-default bg-surface-default px-2 py-1 text-xs text-text-default focus:border-border-default focus:"
                      />
                      <button
                        onClick={() =>
                          setRangeStart((s) => Math.min(s + 1, rangeEnd))
                        }
                        className=" border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="increment start"
                      >
                        +
                      </button>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                    To turn
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setRangeEnd((e) => Math.max(e - 1, rangeStart))
                        }
                        className=" border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="decrement end"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, parsedTurns.length)}
                        value={Math.min(
                          rangeEnd + 1,
                          Math.max(1, parsedTurns.length),
                        )}
                        onChange={(e) => {
                          const max = Math.max(1, parsedTurns.length);
                          const next =
                            Math.min(
                              Math.max(
                                1,
                                Number.parseInt(e.target.value || "1", 10) || 1,
                              ),
                              max,
                            ) - 1;
                          setRangeEnd(next);
                          if (next < rangeStart) setRangeStart(next);
                        }}
                        className=" border border-border-default bg-surface-default px-2 py-1 text-xs text-text-default focus:border-border-default focus:"
                      />
                      <button
                        onClick={() =>
                          setRangeEnd((e) =>
                            Math.min(e + 1, parsedTurns.length - 1),
                          )
                        }
                        className=" border border-border-default px-2 py-1 text-xs text-text-default hover:bg-surface-subtle"
                        aria-label="increment end"
                      >
                        +
                      </button>
                    </div>
                  </label>
                </div>

                {/* Preview list with clickable controls to set start/end */}
                <div className="max-h-48 overflow-y-auto border border-border-default bg-surface-subtle/30 p-2 text-[11px]">
                  {parsedTurns.length === 0 ? (
                    <div className="text-text-muted">No turns to preview.</div>
                  ) : (
                    parsedTurns.map((t, idx) => {
                      const isSelected = idx >= rangeStart && idx <= rangeEnd;
                      // Determine preview + optional size for PDFs when file is available
                      let preview = "";
                      let fullPreview = "";
                      if (t.type === "text") {
                        fullPreview =
                          (t.messages && t.messages.join("\n\n")) || "";
                        preview = t.messages?.[0]?.slice(0, 120) ?? "";
                      } else if (t.type === "pdf") {
                        const filename = t.filename ?? "document.pdf";
                        const matchedFile =
                          uploads[t.id]?.file ??
                          findBestPdfForTurn(t, zipPdfIndex);
                        const sizeStr = matchedFile
                          ? ` (${formatBytes(matchedFile.size)})`
                          : "";
                        preview = `PDF: ${filename}${sizeStr}`;
                        fullPreview = preview;
                      } else {
                        preview = `Media: ${t.mediaKind ?? "file"}`;
                        fullPreview = preview;
                      }
                      return (
                        <div
                          key={t.id}
                          className={`relative flex items-center justify-between gap-3 px-2 py-1  ${isSelected ? "bg-action-primary-bg/10 border border-border-default/20" : "hover:bg-surface-subtle"}`}
                        >
                          <div
                            className="min-w-0 flex-1 text-[11px]"
                            onMouseEnter={(e) =>
                              handlePreviewMouseEnter(e, idx, fullPreview)
                            }
                            onMouseLeave={handlePreviewMouseLeave}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-text-muted">
                                #{idx + 1}
                              </span>
                              <span className="font-medium text-text-default truncate">
                                {t.sender}
                              </span>
                            </div>
                            <div className="truncate text-[10px] text-text-muted">
                              {preview}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setRangeStart(idx)}
                              title="Set as start"
                              className=" border border-border-default px-2 py-1 text-[11px] text-text-default hover:bg-surface-subtle"
                            >
                              Start
                            </button>
                            <button
                              onClick={() => setRangeEnd(idx)}
                              title="Set as end"
                              className=" border border-border-default px-2 py-1 text-[11px] text-text-default hover:bg-surface-subtle"
                            >
                              End
                            </button>
                          </div>
                          {/* Tooltip is rendered in a portal to avoid affecting layout */}
                        </div>
                      );
                    })
                  )}
                </div>

                <StepFooter
                  onBack={() => setStep("paste")}
                  onNext={handleRangeNext}
                  nextDisabled={rangeImportableCount === 0}
                  shortcutsEnabled={!confirmExitOpen}
                  nextContent={
                    <>
                      Next: Map Personas
                      <ChevronRight className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>
            )}

            {/* ─── Step 3: Map personas ────────────────────────────────────── */}
            {step === "map" && (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-text-default">
                      Map senders
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {textTurns.length} text turn
                      {textTurns.length !== 1 ? "s" : ""}
                      {pdfTurns.length > 0 &&
                        ` · ${pdfTurns.length} PDF attachment${pdfTurns.length !== 1 ? "s" : ""}`}
                      {mediaTurns.length > 0 &&
                        ` · ${mediaTurns.length} media skipped`}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-text-muted">
                      <span className=" border border-border-default bg-surface-subtle px-1.5 py-0.5">
                        Using existing local personas: {existingLocalReuseCount}
                      </span>
                      <span className=" border border-border-default bg-surface-subtle px-1.5 py-0.5">
                        Will create on import (local): {step === "map" ? pendingPersonaCreations.length : 0}
                      </span>
                    </div>
                  </div>
                  {unmappedCount > 0 && (
                    <span className="flex shrink-0 items-center gap-1 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {unmappedCount} unmapped
                    </span>
                  )}
                </div>

                  {mapError && (
                    <div className="flex items-start gap-1.5 border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{mapError}</span>
                    </div>
                  )}

                  {mapNotice && (
                    <div className="flex items-start gap-1.5 border border-border-default/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{mapNotice}</span>
                    </div>
                  )}

                <div className="flex flex-col gap-2">
                  {mappableSenders.map((sender) => {
                    const assignedId = mapping[sender];
                    const assignedPersona =
                      (assignedId && draftPersonas[assignedId]) ||
                      personas?.find((p) => p.id === assignedId);

                    return (
                      <div
                        key={sender}
                        className="flex items-center gap-3 border border-border-default bg-surface-subtle/40 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-default">
                          {sender}
                        </span>

                        {assignedPersona ? (
                          <div className="flex items-center gap-1.5">
                            <div
                              className="flex h-5 w-5 shrink-0 items-center justify-center "
                              style={{
                                backgroundColor: `${assignedPersona.color}20`,
                                color: assignedPersona.color,
                              }}
                            >
                              <DynamicIcon
                                name={assignedPersona.icon}
                                className="h-3 w-3"
                              />
                            </div>
                            <span className="text-xs text-text-default">
                              {assignedPersona.name}
                            </span>
                            <span
                              className={` px-1.5 py-0.5 text-[10px] font-medium ${
                                isLocalPersona(assignedPersona)
                                  ? "border border-border-default/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                  : "border border-border-default bg-surface-subtle text-text-muted"
                              }`}
                            >
                              {getPersonaScopeLabel(assignedPersona)}
                            </span>
                            <button
                              onClick={() =>
                                setMapping((prev) => {
                                  const next = { ...prev };
                                  delete next[sender];
                                  return next;
                                })
                              }
                              className=" p-0.5 text-text-muted hover:bg-surface-subtle hover:text-text-default"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <select
                            value=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                setMapping((prev) => ({
                                  ...prev,
                                  [sender]: val,
                                }));
                              }
                            }}
                            className=" border border-border-default bg-surface-default px-2 py-1 text-xs text-text-default focus:border-border-default focus: disabled:opacity-60"
                          >
                            <option value="" disabled>
                              Select persona…
                            </option>
                            {globalPersonas.length > 0 && (
                              <optgroup label="Available Everywhere">
                                {globalPersonas.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} (Global)
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {localPersonas.length > 0 && (
                              <optgroup label="Local Personas (This Stream)">
                                {localPersonas.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} (Local)
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>

                {unmappedCount > 0 && (
                  <div className="flex items-start justify-between gap-2 border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px] text-blue-600 dark:text-blue-400">
                    <div className="flex items-start gap-1.5 max-w-[70%]">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        {unmappedCount} sender{unmappedCount !== 1 ? "s" : ""} will be
                        created as local persona{unmappedCount !== 1 ? "s" : ""}{" "}
                        for this stream when you import.
                      </span>
                    </div>
                      <div className="shrink-0">
                      <button
                        onClick={() => {
                          const toCreate = mappableSenders.filter((sender) => !mapping[sender]);
                          if (toCreate.length === 0) return;
                          // Build new drafts and mapping entries immediately (local-only)
                          const prevDrafts = { ...draftPersonas };
                          const newDrafts: Record<string, {
                            id: string;
                            name: string;
                            color: string;
                            icon: string;
                            is_shadow: true;
                            isDraft: true;
                          }> = {};
                          const newMappingEntries: Record<string, string> = {};
                          for (const [i, sender] of toCreate.entries()) {
                            // try find existing draft matching sender
                            const existing = Object.values(prevDrafts).find((d) => normalizePersonaNameKey(d.name) === normalizePersonaNameKey(sender));
                            if (existing) {
                              newMappingEntries[sender] = existing.id;
                              continue;
                            }
                            const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
                            const draft = {
                              id,
                              name: sender,
                              color: PERSONA_COLORS[i % PERSONA_COLORS.length],
                              icon: "user",
                              is_shadow: true as const,
                              isDraft: true as const,
                            };
                            newDrafts[id] = draft;
                            newMappingEntries[sender] = id;
                          }

                          setPendingPersonaCreations(toCreate);
                          if (Object.keys(newDrafts).length > 0) setDraftPersonas((prev) => ({ ...prev, ...newDrafts }));
                          setMapping((prev) => ({ ...prev, ...newMappingEntries }));
                        }}
                        disabled={creatingAllPersonas}
                        className="bg-blue-500/10 px-2.5 py-1.5 flex items-center gap-1.5 font-medium hover:bg-blue-500/20 disabled:opacity-50 transition-colors border border-blue-500/20"
                      >
                        {creatingAllPersonas ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <UserPlus className="h-3.5 w-3.5" />
                            Create {unmappedCount} local persona{unmappedCount !== 1 ? "s" : ""}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {hasPdfTurns && allMapped && (
                  <div className="flex items-start gap-1.5 border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px] text-blue-600 dark:text-blue-400">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      {pdfTurns.length} PDF file
                      {pdfTurns.length !== 1 ? "s" : ""} detected.
                      {zipSourceName
                        ? ` ${autoMatchCount} matched from ZIP.`
                        : " Select files in the next step."}
                    </span>
                  </div>
                )}

                <StepFooter
                  onBack={() => setStep("range")}
                  onNext={() => void handleMapNext()}
                  nextDisabled={
                    creatingAllPersonas || !allMapped || (!hasPdfTurns && textTurns.length === 0)
                  }
                  shortcutsEnabled={!confirmExitOpen}
                  nextContent={
                    hasPdfTurns ? (
                      <>
                        Next: Attach PDFs
                        <ChevronRight className="h-3.5 w-3.5" />
                      </>
                    ) : (
                      <>
                        {creatingAllPersonas ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        {creatingAllPersonas
                          ? "Creating personas..."
                          : `Import ${textTurns.length} turn${textTurns.length !== 1 ? "s" : ""}`}
                      </>
                    )
                  }
                />
              </div>
            )}

            {/* ─── Step 4: Attach PDFs ─────────────────────────────────────── */}
            {step === "files" && (
              <div className="flex flex-col gap-3 p-3">
                <div>
                  <p className="text-xs font-medium text-text-default">
                    Attach PDF files
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    Choose a file for each detected PDF, then press Import.
                  </p>
                  {zipSourceName && (
                    <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">
                      ZIP: {zipSourceName} · {autoMatchCount}/{pdfTurns.length}{" "}
                      PDF
                      {pdfTurns.length !== 1 ? "s" : ""} auto-matched.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {pdfTurns.map((turn) => {
                    const upload = uploads[turn.id] ?? {
                      status: "pending" as const,
                    };
                    return (
                      <PdfUploadRow
                        key={turn.id}
                        turn={turn}
                        upload={upload}
                        onFileSelect={(file, titleHint) => handleFileSelect(turn.id, file, titleHint)}
                        onRetry={() =>
                          upload.file &&
                          handleFileSelect(
                            turn.id,
                            upload.file,
                            turn.preferredTitle ?? turn.filename,
                          )
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
                <div className=" border border-border-default bg-surface-subtle/40 px-3 py-2 text-[11px] text-text-muted">
                  <span className="font-semibold text-text-default">
                    {plannedImportableCount}
                  </span>{" "}
                  section{plannedImportableCount !== 1 ? "s" : ""} ready (
                  {textTurns.length} text
                  {doneUploadCount + queuedUploadCount > 0 &&
                    `, ${doneUploadCount + queuedUploadCount} PDF queued`}
                  ).
                  {skippedPdfs.length > 0 && (
                    <span className="ml-1">
                      {skippedPdfs.length} PDF
                      {skippedPdfs.length !== 1 ? "s" : ""} skipped.
                    </span>
                  )}
                </div>

                <StepFooter
                  onBack={() => setStep("map")}
                  backDisabled={anyUploading}
                  onNext={() => void handleProcessAndConfirm()}
                  nextDisabled={!canConfirmFiles}
                  shortcutsEnabled={!confirmExitOpen}
                  nextContent={
                    anyUploading ? (
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
                    )
                  }
                />
              </div>
            )}
          </DialogPanel>
            </TransitionChild>
        </div>
        {/* Portal tooltip: render global tooltip so it doesn't affect modal layout */}
        {typeof document !== "undefined" &&
        tooltipVisible &&
        tooltipContent &&
        tooltipPos
          ? createPortal(
              <div
                style={{
                  left: tooltipPos.left,
                  top: tooltipPos.top,
                  width: tooltipPos.width,
                }}
                className="fixed z-50 border border-border-default bg-surface-default p-2 text-xs text-text-default shadow-lg"
              >
                <div className="whitespace-pre-wrap wrap-break-word text-[12px]">
                  {tooltipContent}
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>
      <ConfirmDialog
        open={confirmExitOpen}
        title="Discard import?"
        description="Are you sure you want to exit? You will lose all imported data and progress."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onCancel={() => setConfirmExitOpen(false)}
        onConfirm={() => {
          setConfirmExitOpen(false);
          handleClose();
        }}
      />
      <ConfirmDialog
        open={allPdfsExistDialogOpen}
        title="Attachments already exist"
        description="All detected PDF attachments already exist in your account. Nothing needs importing."
        confirmLabel="Okay"
        hideCancel
        onCancel={() => setAllPdfsExistDialogOpen(false)}
        onConfirm={() => {
          setAllPdfsExistDialogOpen(false);
          // Even if all PDFs exist, proceed to the files step so user can review statuses
          setStep("files");
        }}
      />
      </Dialog>
    </Transition>
  );
}

// ─── StepFooter sub-component ──────────────────────────────────────────────────

interface StepFooterProps {
  onBack?: () => void;
  backDisabled?: boolean;
  onNext: () => void;
  nextDisabled?: boolean;
  shortcutsEnabled?: boolean;
  nextContent: React.ReactNode;
}

function StepFooter({
  onBack,
  backDisabled,
  onNext,
  nextDisabled,
  shortcutsEnabled = true,
  nextContent,
}: StepFooterProps) {
  useEffect(() => {
    if (!shortcutsEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        // Prevent intercepting Enter when the user is interacting with form controls or standard buttons
        const active = document.activeElement as HTMLElement | null;
        if (active) {
          const tag = active.tagName.toUpperCase();
          if (["TEXTAREA", "INPUT", "SELECT", "BUTTON"].includes(tag)) {
            return;
          }
        }
        
        if (!nextDisabled) {
          e.preventDefault();
          onNext();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNext, nextDisabled, shortcutsEnabled]);

  return (
    <div
      className={`flex items-center ${
        onBack ? "justify-between" : "justify-end"
      }`}
    >
      {onBack && (
        <button
          onClick={onBack}
          disabled={backDisabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text-default disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>
      )}

      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="inline-flex items-center gap-1.5 bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {nextContent}
      </button>
    </div>
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
  onFileSelect: (file: File, titleHint?: string) => void;
  onRetry: () => void;
  onSkip: () => void;
  onUnskip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useBlobUrl(upload.file);

  const filename = turn.filename ?? "document.pdf";
  const isSkipped = upload.status === "skipped";
  const isDone = upload.status === "done";
  const isUploading = upload.status === "uploading";
  const isError = upload.status === "error";
  const isQueued = upload.status === "pending" && !!upload.file;

  return (
    <div
      className={`flex flex-col gap-2  border px-3 py-2.5 transition-opacity ${
        isSkipped
          ? "border-border-default/40 opacity-50"
          : isDone
            ? "border-green-500/20 bg-green-500/5"
            : "border-border-default bg-surface-subtle/30"
      }`}
    >
      <div className="flex items-start gap-2">
        {upload.file ? (
          <FileAttachmentThumbnail
            url={previewUrl}
            storagePath={upload.storagePath}
            thumbnailPath={upload.thumbnailPath}
            thumbnailStatus={null}
            documentId={upload.documentId ?? null}
            title={filename}
            importStatus={isError ? "failed" : isUploading ? "processing" : isQueued ? "queued" : isDone ? "completed" : null}
          />
        ) : (
          <FileText
            className={`mt-0.5 h-4 w-4 shrink-0 ${isDone ? "text-green-500" : "text-blue-500"}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-text-default">
            {filename}
          </p>
          {turn.fullPath && (
            <p
              className="truncate font-mono text-[10px] text-text-muted"
              title={turn.fullPath}
            >
              {turn.fullPath}
            </p>
          )}
          <p className="text-[10px] text-text-muted">
            Sent by{" "}
            <span className="font-medium text-text-default">{turn.sender}</span>
          </p>
          {upload.status === "exists" && upload.existingDocument && (
            <p className="text-[10px] text-text-muted">
              Already in account: <span className="font-medium text-text-default">{upload.existingDocument.title ?? upload.existingDocument.id}</span>
            </p>
          )}
          {upload.file && (
            <p className="text-[10px] text-text-muted">
              Size: {formatBytes(upload.file.size)}
            </p>
          )}
        </div>

        {/* Status indicator */}
        {isUploading && (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-action-primary-bg" />
        )}
        {isDone && (
          <span className="flex shrink-0 items-center gap-1 bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" />
            Uploaded
          </span>
        )}
        {isSkipped && (
          <span className="shrink-0 bg-surface-subtle px-2 py-0.5 text-[10px] text-text-muted">
            Skipped
          </span>
        )}
        {isQueued && (
          <span className="shrink-0 bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
            Queued
          </span>
        )}
      </div>

      {/* Docling confirmation */}
      {isDone && upload.titleSnapshot && (
        <p className="text-[10px] text-text-muted">
          Processing started for{" "}
          <span className="font-medium text-text-default">
            &quot;{upload.titleSnapshot}&quot;
          </span>
        </p>
      )}

      {isQueued && (
        <p className="text-[10px] text-text-muted">
          Queued. Starts after Import.
        </p>
      )}

      {/* Error message */}
      {isError && (
        <p className="wrap-break-word text-[10px] text-red-500">
          {upload.error}
        </p>
      )}

      {/* Action buttons */}
      {!isUploading && !isDone && !isSkipped && (
        <div className="flex flex-wrap items-center gap-1.5">
          {isSkipped ? (
            <button
              onClick={onUnskip}
              className="inline-flex items-center gap-1 border border-border-default px-2 py-1 text-[11px] text-text-default hover:bg-surface-subtle"
            >
              <Undo2 className="h-3 w-3" />
              Undo skip
            </button>
          ) : upload.status === "exists" ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-default">
                Already exists
              </span>
              {upload.existingDocument?.id && (
                <button
                  onClick={() => {
                    try {
                        const url = `/documents/${upload.existingDocument!.id}`;
                        window.open(url, "_blank");
                      } catch {
                        // ignore
                      }
                  }}
                  className="inline-flex items-center gap-1 border border-border-default px-2 py-1 text-[11px] text-text-default hover:bg-surface-subtle"
                >
                  View
                </button>
              )}
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileSelect(file, turn.preferredTitle ?? turn.filename);
                  e.target.value = "";
                }}
              />

              {isError && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-600 hover:bg-red-500/20 dark:text-red-400"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              )}

              <button
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1 bg-action-primary-bg px-2 py-1 text-[11px] font-medium text-action-primary-text hover:opacity-90"
              >
                <Upload className="h-3 w-3" />
                {isError ? "Choose another" : "Select file"}
              </button>

              <button
                onClick={onSkip}
                className="inline-flex items-center gap-1 border border-border-default px-2 py-1 text-[11px] text-text-muted hover:bg-surface-subtle hover:text-text-default"
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
