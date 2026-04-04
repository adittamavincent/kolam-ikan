export type DocumentImportKind =
  | "pdf"
  | "office"
  | "image"
  | "media"
  | "text"
  | "web"
  | "unknown";

const PDF_MIME_TYPES = new Set(["application/pdf"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

const OFFICE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/epub+zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);
const OFFICE_EXTENSIONS = new Set([
  ".docx",
  ".pptx",
  ".xlsx",
  ".epub",
  ".odt",
  ".ods",
  ".odp",
  ".doc",
  ".ppt",
  ".xls",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
  "image/gif",
  "image/bmp",
]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpeg",
  ".jpg",
  ".webp",
  ".tiff",
  ".tif",
  ".gif",
  ".bmp",
]);

const MEDIA_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mpga",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/x-flac",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const MEDIA_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".webm",
  ".flac",
  ".mp4",
  ".m4v",
  ".mov",
]);

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "application/json",
  "application/x-yaml",
  "text/yaml",
]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
]);

const EXTENSION_TO_MIME = new Map<string, string>([
  [".pdf", "application/pdf"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [
    ".pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  [
    ".xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [".epub", "application/epub+zip"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".odp", "application/vnd.oasis.opendocument.presentation"],
  [".doc", "application/msword"],
  [".xls", "application/vnd.ms-excel"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".png", "image/png"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".webp", "image/webp"],
  [".tiff", "image/tiff"],
  [".tif", "image/tiff"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".ogg", "audio/ogg"],
  [".webm", "audio/webm"],
  [".flac", "audio/flac"],
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".yaml", "application/x-yaml"],
  [".yml", "application/x-yaml"],
  [".html", "text/html"],
  [".htm", "text/html"],
]);

function normalizeContentType(contentType?: string | null) {
  const value = contentType?.trim().toLowerCase();
  if (!value) return "";
  if (value === "image/jpg") return "image/jpeg";
  if (value === "audio/x-m4a") return "audio/mp4";
  return value;
}

function getExtension(fileName?: string | null) {
  if (!fileName) return "";
  const trimmed = fileName.trim().toLowerCase();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(lastDot);
}

function isWebImport(fileName?: string | null, contentType?: string | null) {
  const normalizedContentType = normalizeContentType(contentType);
  const trimmedFileName = fileName?.trim().toLowerCase() ?? "";
  return (
    normalizedContentType === "text/url" ||
    trimmedFileName.startsWith("http://") ||
    trimmedFileName.startsWith("https://")
  );
}

function isGenericBinaryContentType(contentType: string) {
  return (
    contentType === "" ||
    contentType === "application/octet-stream" ||
    contentType === "binary/octet-stream"
  );
}

function resolveKind(
  extension: string,
  contentType: string,
): DocumentImportKind {
  if (PDF_MIME_TYPES.has(contentType) || PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }
  if (OFFICE_MIME_TYPES.has(contentType) || OFFICE_EXTENSIONS.has(extension)) {
    return "office";
  }
  if (IMAGE_MIME_TYPES.has(contentType) || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (MEDIA_MIME_TYPES.has(contentType) || MEDIA_EXTENSIONS.has(extension)) {
    return "media";
  }
  if (TEXT_MIME_TYPES.has(contentType) || TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return "unknown";
}

export function resolveDocumentImportCompatibility(params: {
  fileName?: string | null;
  contentType?: string | null;
}) {
  const extension = getExtension(params.fileName);
  const normalizedContentType = normalizeContentType(params.contentType);
  const inferredContentType = extension
    ? (EXTENSION_TO_MIME.get(extension) ?? "")
    : "";

  const effectiveContentType =
    !isGenericBinaryContentType(normalizedContentType) && normalizedContentType
      ? normalizedContentType
      : inferredContentType || normalizedContentType;

  const kind = isWebImport(params.fileName, params.contentType)
    ? "web"
    : resolveKind(extension, effectiveContentType);

  return {
    kind,
    supported: kind !== "unknown",
    extension,
    contentType: effectiveContentType || "application/octet-stream",
  };
}

export function stripImportFileExtension(fileName: string) {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, lastDot);
}
