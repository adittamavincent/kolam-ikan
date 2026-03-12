export interface PdfExtractedMetadata {
  title: string | null;
  author: string | null;
  creationDate: string | null;
  pageCount: number;
}

function normalizePdfDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.startsWith("D:") ? raw.slice(2) : raw;
  const match = normalized.match(
    /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/,
  );
  if (!match) return null;

  const year = match[1];
  const month = match[2] ?? "01";
  const day = match[3] ?? "01";
  const hour = match[4] ?? "00";
  const minute = match[5] ?? "00";
  const second = match[6] ?? "00";

  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export async function extractPdfMetadata(
  pdfBytes: Uint8Array,
): Promise<PdfExtractedMetadata> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  let title: string | null = null;
  let author: string | null = null;
  let creationDate: string | null = null;

  try {
    const metadata = await pdf.getMetadata();
    const info = metadata.info as {
      Title?: string;
      Author?: string;
      CreationDate?: string;
    };
    title = info.Title?.trim() || null;
    author = info.Author?.trim() || null;
    creationDate = normalizePdfDate(info.CreationDate);
  } finally {
    await pdf.destroy();
  }

  return {
    title,
    author,
    creationDate,
    pageCount,
  };
}
