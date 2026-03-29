type SupabaseErrorLike = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};

const SCHEMA_MISMATCH_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

const SCHEMA_MISMATCH_PATTERNS = [
  "schema cache",
  "does not exist",
  "could not find the table",
  "could not find the column",
  'relation "public.',
  'column "',
];

export function getSupabaseErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";

  const { code, details, hint, message } = error as SupabaseErrorLike;

  return [code, details, hint, message]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

export function isSupabaseSchemaMismatchError(
  error: unknown,
  identifiers: string[] = [],
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { code } = error as SupabaseErrorLike;
  const text = getSupabaseErrorText(error);
  const matchesSchemaProblem =
    SCHEMA_MISMATCH_CODES.has(code ?? "") ||
    SCHEMA_MISMATCH_PATTERNS.some((pattern) => text.includes(pattern));

  if (!matchesSchemaProblem) {
    return false;
  }

  if (identifiers.length === 0) {
    return true;
  }

  return identifiers.some((identifier) => text.includes(identifier.toLowerCase()));
}

export function shouldRetrySupabaseQuery(
  failureCount: number,
  error: unknown,
  maxRetries = 3,
): boolean {
  return failureCount < maxRetries && !isSupabaseSchemaMismatchError(error);
}
