// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  readCommittedEntryStash,
  readEntryCreatorStash,
  STASH_CHANGED_EVENT,
  writeCommittedEntryStash,
  writeEntryCreatorStash,
} from "./stash";

describe("stash utils", () => {
  const storage = new Map<string, string>();
  let localStorageMock: Storage;

  beforeEach(() => {
    storage.clear();
    localStorageMock = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      clear: vi.fn(() => {
        storage.clear();
      }),
      key: vi.fn(),
      get length() {
        return storage.size;
      },
    } as unknown as Storage;
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes and reads both stash stores", () => {
    writeCommittedEntryStash("stream-1", [
      {
        id: "commit-stash-1",
        entryId: "entry-1",
        createdAt: "2026-03-29T10:00:00.000Z",
        originalCreatedAt: "2026-03-29T09:00:00.000Z",
        branchName: "main",
        headCommitId: "entry-2",
        parentCommitId: "entry-0",
        mergeSourceCommitId: null,
        mergeSourceBranchName: null,
        entryKind: "commit",
        sectionCount: 2,
      },
    ]);

    writeEntryCreatorStash("stream-1", [
      {
        id: "draft-stash-1",
        createdAt: "2026-03-29T11:00:00.000Z",
        branchName: "main",
        headCommitId: "entry-2",
        sections: [
          {
            instanceId: "section-1",
            draft: {
              sectionType: "PERSONA",
              personaId: "persona-1",
              content: [],
            },
          },
        ],
      },
    ]);

    expect(readCommittedEntryStash("stream-1")).toHaveLength(1);
    expect(readEntryCreatorStash("stream-1")).toHaveLength(1);
  });

  it("dispatches a same-tab stash changed event on writes", async () => {
    const listener = vi.fn();
    window.addEventListener(STASH_CHANGED_EVENT, listener as EventListener);

    listener.mockClear();
    writeCommittedEntryStash("stream-1", []);

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(listener).toHaveBeenCalled();
    expect(
      listener.mock.calls.some((call) => {
        const event = call[0];
        return (
          event instanceof CustomEvent &&
          event.detail?.streamId === "stream-1"
        );
      }),
    ).toBe(true);

    window.removeEventListener(STASH_CHANGED_EVENT, listener as EventListener);
  });
});
