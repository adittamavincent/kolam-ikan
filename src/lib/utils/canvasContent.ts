type PlainRecord = Record<string, unknown>;

function canonicalizeCanvasNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalizeCanvasNode(item))
      .filter((item) => item !== undefined);
  }

  if (value == null || typeof value !== "object") {
    return value;
  }

  const record = value as PlainRecord;
  const next: PlainRecord = {};
  const keys = Object.keys(record).sort();

  for (const key of keys) {
    if (key === "id") continue;

    const normalized = canonicalizeCanvasNode(record[key]);
    if (normalized === undefined) continue;
    if (Array.isArray(normalized) && normalized.length === 0) continue;
    if (
      normalized &&
      typeof normalized === "object" &&
      !Array.isArray(normalized) &&
      Object.keys(normalized as PlainRecord).length === 0
    ) {
      continue;
    }

    next[key] = normalized;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeCanvasContent(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  const canonical = canonicalizeCanvasNode(value);
  if (canonical === undefined) {
    return Array.isArray(value) ? "[]" : null;
  }

  return JSON.stringify(canonical);
}

export function areCanvasContentsEquivalent(a: unknown, b: unknown): boolean {
  return normalizeCanvasContent(a) === normalizeCanvasContent(b);
}
