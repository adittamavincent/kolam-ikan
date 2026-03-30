export type OaiCitation = {
  id: string;
  index: number;
  label: string;
  target: string;
};

const CONTENT_REFERENCE_PATTERN =
  /:contentReference\[oaicite:(\d+)\]\{index=(\d+)\}/g;

function normalizeCitationIndex(oaiciteRaw: string, indexRaw?: string) {
  const parsedIndex = Number.parseInt(indexRaw ?? oaiciteRaw, 10);
  if (Number.isFinite(parsedIndex) && parsedIndex >= 0) {
    return parsedIndex;
  }

  const fallback = Number.parseInt(oaiciteRaw, 10);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

export function extractOaiCitations(text: string): OaiCitation[] {
  const citations: OaiCitation[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;

  CONTENT_REFERENCE_PATTERN.lastIndex = 0;

  while ((match = CONTENT_REFERENCE_PATTERN.exec(text)) !== null) {
    const normalizedIndex = normalizeCitationIndex(match[1], match[2]);
    if (seen.has(normalizedIndex)) continue;

    const label = String(normalizedIndex + 1);
    citations.push({
      id: `citation-${label}`,
      index: normalizedIndex,
      label,
      target: `#citation-${label}`,
    });
    seen.add(normalizedIndex);
  }

  return citations.sort((left, right) => left.index - right.index);
}

export function replaceOaiCitationTokens(text: string): string {
  return text.replace(
    CONTENT_REFERENCE_PATTERN,
    (_match, oaiciteRaw: string, indexRaw: string) => {
      const normalizedIndex = normalizeCitationIndex(oaiciteRaw, indexRaw);
      const label = String(normalizedIndex + 1);
      return `[${label}](#citation-${label})`;
    },
  );
}

function hasCitationSection(text: string) {
  return /(^|\n)#{1,6}\s+(citations|references)\s*$/im.test(text);
}

export function normalizeOaiCitationsInMarkdown(text: string): string {
  if (!CONTENT_REFERENCE_PATTERN.test(text)) {
    CONTENT_REFERENCE_PATTERN.lastIndex = 0;
    return text;
  }

  CONTENT_REFERENCE_PATTERN.lastIndex = 0;
  const citations = extractOaiCitations(text);
  const replaced = replaceOaiCitationTokens(text);

  if (citations.length === 0 || hasCitationSection(replaced)) {
    return replaced;
  }

  const citationLines = citations.map(
    (citation) => `${citation.label}. OpenAI citation ${citation.label}`,
  );

  return `${replaced.trimEnd()}\n\n## Citations\n${citationLines.join("\n")}`;
}
