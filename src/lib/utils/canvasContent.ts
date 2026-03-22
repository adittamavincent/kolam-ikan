type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isDefaultBlockProp(key: string, value: unknown): boolean {
  if (
    (key === "textColor" || key === "backgroundColor") &&
    value === "default"
  ) {
    return true;
  }

  if ((key === "textAlignment" || key === "textAlign") && value === "left") {
    return true;
  }

  if (key === "level" && value === 1) {
    return true;
  }

  return false;
}

function isTextNode(value: unknown): value is PlainRecord {
  return isPlainRecord(value) && value.type === "text";
}

function isBlockNode(value: unknown): value is PlainRecord {
  return isPlainRecord(value) && typeof value.type === "string" && value.type !== "text";
}

function isEmptyParagraphBlock(value: unknown): boolean {
  if (!isBlockNode(value) || value.type !== "paragraph") {
    return false;
  }

  const content = Array.isArray(value.content) ? value.content : [];
  const children = Array.isArray(value.children) ? value.children : [];
  const props = isPlainRecord(value.props) ? value.props : null;

  return content.length === 0 && children.length === 0 && (!props || Object.keys(props).length === 0);
}

function canonicalizeCanvasNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    const canonicalized = value
      .map((item) => canonicalizeCanvasNode(item))
      .filter((item) => item !== undefined);

    if (canonicalized.every((item) => isTextNode(item))) {
      return canonicalized.filter((item) => {
        const text = item.text;
        return typeof text !== "string" || text.length > 0;
      });
    }

    if (canonicalized.every((item) => isBlockNode(item))) {
      const trimmed = [...canonicalized];
      while (trimmed.length > 0 && isEmptyParagraphBlock(trimmed[trimmed.length - 1])) {
        trimmed.pop();
      }
      return trimmed;
    }

    return canonicalized;
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

  if (typeof next.type === "string" && isPlainRecord(next.props)) {
    const props = Object.fromEntries(
      Object.entries(next.props).filter(
        ([key, value]) => !isDefaultBlockProp(key, value),
      ),
    );

    if (Object.keys(props).length === 0) {
      delete next.props;
    } else {
      next.props = props;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeCanvasContent(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  const canonical = canonicalizeCanvasNode(value);
  if (
    canonical === undefined ||
    (Array.isArray(canonical) && canonical.length === 0)
  ) {
    return null;
  }

  return JSON.stringify(canonical);
}

export function areCanvasContentsEquivalent(a: unknown, b: unknown): boolean {
  return normalizeCanvasContent(a) === normalizeCanvasContent(b);
}
