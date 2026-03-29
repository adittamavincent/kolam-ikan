"use client";

import type { DraftContent } from "@/lib/hooks/useDraftSystem";
import type { EntryWithSections } from "@/lib/types";

export type EntryCreatorStashItem = {
  id: string;
  createdAt: string;
  branchName: string;
  headCommitId: string | null;
  sections: Array<{
    instanceId: string;
    draft: DraftContent;
  }>;
};

export type CommittedEntryStashItem = {
  id: string;
  entryId: string;
  createdAt: string;
  originalCreatedAt: string | null;
  branchName: string;
  headCommitId: string | null;
  parentCommitId: string | null;
  mergeSourceCommitId: string | null;
  mergeSourceBranchName: string | null;
  entryKind: string | null;
  sectionCount: number;
};

const ENTRY_CREATOR_STASH_KEY_PREFIX = "kolam_entry_creator_stash_v1_";
const COMMITTED_ENTRY_STASH_KEY_PREFIX = "kolam_log_commit_stash_v1_";
export const STASH_CHANGED_EVENT = "kolam_stash_changed";

export const entryCreatorStashKey = (streamId: string) =>
  `${ENTRY_CREATOR_STASH_KEY_PREFIX}${streamId}`;

export const committedEntryStashKey = (streamId: string) =>
  `${COMMITTED_ENTRY_STASH_KEY_PREFIX}${streamId}`;

function dispatchStashChanged(streamId: string) {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent(STASH_CHANGED_EVENT, {
        detail: { streamId },
      }),
    );
  }, 0);
}

function parseEntryCreatorStashItem(
  item: unknown,
): EntryCreatorStashItem | null {
  if (!item || typeof item !== "object") return null;

  const candidate = item as Partial<EntryCreatorStashItem>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.branchName !== "string" ||
    !Array.isArray(candidate.sections)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    branchName: candidate.branchName,
    headCommitId:
      typeof candidate.headCommitId === "string" ? candidate.headCommitId : null,
    sections: candidate.sections.flatMap((section) => {
      if (!section || typeof section !== "object") return [];

      const sectionCandidate = section as {
        instanceId?: unknown;
        draft?: DraftContent;
      };

      if (typeof sectionCandidate.instanceId !== "string") return [];
      if (!sectionCandidate.draft || typeof sectionCandidate.draft !== "object") {
        return [];
      }

      return [{
        instanceId: sectionCandidate.instanceId,
        draft: sectionCandidate.draft,
      }];
    }),
  };
}

function parseCommittedEntryStashItem(
  item: unknown,
): CommittedEntryStashItem | null {
  if (!item || typeof item !== "object") return null;

  const candidate = item as Partial<CommittedEntryStashItem>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.entryId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.branchName !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    entryId: candidate.entryId,
    createdAt: candidate.createdAt,
    originalCreatedAt:
      typeof candidate.originalCreatedAt === "string"
        ? candidate.originalCreatedAt
        : null,
    branchName: candidate.branchName,
    headCommitId:
      typeof candidate.headCommitId === "string" ? candidate.headCommitId : null,
    parentCommitId:
      typeof candidate.parentCommitId === "string" ? candidate.parentCommitId : null,
    mergeSourceCommitId:
      typeof candidate.mergeSourceCommitId === "string"
        ? candidate.mergeSourceCommitId
        : null,
    mergeSourceBranchName:
      typeof candidate.mergeSourceBranchName === "string"
        ? candidate.mergeSourceBranchName
        : null,
    entryKind: typeof candidate.entryKind === "string" ? candidate.entryKind : null,
    sectionCount:
      typeof candidate.sectionCount === "number" &&
      Number.isFinite(candidate.sectionCount)
        ? candidate.sectionCount
        : 0,
  };
}

function readArray<T>(
  key: string,
  parser: (item: unknown) => T | null,
): T[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item) => {
      const next = parser(item);
      return next ? [next] : [];
    });
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, streamId: string, items: T[]): void {
  if (typeof window === "undefined") return;

  try {
    if (items.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(items));
    }
  } catch {
    // Ignore storage errors.
  }

  dispatchStashChanged(streamId);
}

export function readEntryCreatorStash(streamId: string): EntryCreatorStashItem[] {
  return readArray(entryCreatorStashKey(streamId), parseEntryCreatorStashItem);
}

export function writeEntryCreatorStash(
  streamId: string,
  items: EntryCreatorStashItem[],
): void {
  writeArray(entryCreatorStashKey(streamId), streamId, items);
}

export function readCommittedEntryStash(
  streamId: string,
): CommittedEntryStashItem[] {
  return readArray(committedEntryStashKey(streamId), parseCommittedEntryStashItem);
}

export function writeCommittedEntryStash(
  streamId: string,
  items: CommittedEntryStashItem[],
): void {
  writeArray(committedEntryStashKey(streamId), streamId, items);
}

export function buildCommittedEntryStashItem(args: {
  entry: EntryWithSections;
  branchName: string;
  headCommitId: string | null;
}): CommittedEntryStashItem {
  const { entry, branchName, headCommitId } = args;

  return {
    id: crypto.randomUUID(),
    entryId: entry.id,
    createdAt: new Date().toISOString(),
    originalCreatedAt: entry.created_at,
    branchName,
    headCommitId,
    parentCommitId: entry.parent_commit_id,
    mergeSourceCommitId: entry.merge_source_commit_id,
    mergeSourceBranchName: entry.merge_source_branch_name,
    entryKind: entry.entry_kind,
    sectionCount: entry.sections?.length ?? 0,
  };
}

export function subscribeToStashChanges(
  streamId: string,
  callback: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (
      event.key === entryCreatorStashKey(streamId) ||
      event.key === committedEntryStashKey(streamId)
    ) {
      callback();
    }
  };

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<{ streamId?: string }>).detail;
    if (detail?.streamId === streamId) {
      callback();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", callback);
  window.addEventListener(STASH_CHANGED_EVENT, onCustom as EventListener);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", callback);
    window.removeEventListener(STASH_CHANGED_EVENT, onCustom as EventListener);
  };
}
