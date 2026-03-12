// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDraftSystem } from "../useDraftSystem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PartialBlock } from "@blocknote/core";
import React from "react";

const mockSupabase = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  },
  from: vi.fn(),
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

describe("useDraftSystem - Edge Cases (Localized V2)", () => {
  let queryClient: QueryClient;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    queryClient = new QueryClient();
    wrapper = ({ children }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );

    vi.clearAllMocks();
    localStorage.clear();

    mockSupabase.from = vi.fn((table: string) => {
      if (table === "entries") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi
            .fn()
            .mockResolvedValue({ data: { id: "new-entry" }, error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }
      if (table === "sections") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("should initialize with no entry identifier and delete legacy drafts", async () => {
    const mockDelete = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    mockDelete.mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: mockEq }) });

    mockSupabase.from = vi.fn((table) => {
      if (table === "entries") return { delete: mockDelete, eq: mockDelete };
      return {};
    });

    const { result } = renderHook(
      () => useDraftSystem({ streamId: "stream-new" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.activeEntryId).toBeNull();
    expect(mockDelete).toHaveBeenCalled();
  });

  it("should load initial drafts from local storage on mount", async () => {
    localStorage.setItem(
      "kolam_draft_v2_stream-local",
      JSON.stringify({
        sections: {
          "inst-1": {
            personaId: "persona-1",
            content: [{ type: "paragraph", content: "loaded" }],
            updatedAt: Date.now(),
          },
        },
        updatedAt: Date.now(),
      }),
    );

    const { result } = renderHook(
      () => useDraftSystem({ streamId: "stream-local" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.recoveryAvailable).toBe(true);
    expect(Object.keys(result.current.initialDrafts)).toHaveLength(1);
  });

  it("should remove section from localStorage immediately when saveDraft(forceDelete) is called", async () => {
    const { result } = renderHook(
      () => useDraftSystem({ streamId: "stream-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const content = [
      {
        id: "b1",
        type: "paragraph",
        content: [{ type: "text", text: "Will be removed" }],
      },
    ] as PartialBlock[];

    act(() => {
      result.current.saveDraft("inst-rm", "persona-a", content, "Persona A");
      result.current.saveDraft("inst-keep", "persona-b", content, "Persona B");
    });

    let draft = JSON.parse(
      localStorage.getItem("kolam_draft_v2_stream-1") || "{}",
    );
    expect(draft.sections["inst-rm"]).toBeDefined();

    // Simulate User removing section via X
    act(() => {
      result.current.saveDraft("inst-rm", "persona-a", [], "Persona A", true);
    });

    draft = JSON.parse(localStorage.getItem("kolam_draft_v2_stream-1") || "{}");
    expect(draft.sections["inst-rm"]).toBeUndefined();
    expect(draft.sections["inst-keep"]).toBeDefined(); // keeps other sections
  });

  it("should completely wipe localStorage when clearDraft is called", async () => {
    const { result } = renderHook(
      () => useDraftSystem({ streamId: "stream-clear" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const content = [
      { id: "b1", type: "paragraph", content: "Commit me" },
    ] as PartialBlock[];

    act(() => {
      result.current.saveDraft(
        "inst-commit",
        "persona-a",
        content,
        "Persona A",
      );
    });

    expect(localStorage.getItem("kolam_draft_v2_stream-clear")).not.toBeNull();

    act(() => {
      result.current.clearDraft();
    });

    expect(localStorage.getItem("kolam_draft_v2_stream-clear")).toBeNull();
  });

  it("should completely wipe localStorage when commitDraft is called", async () => {
    const { result } = renderHook(
      () => useDraftSystem({ streamId: "stream-commit" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const content = [
      { id: "b1", type: "paragraph", content: "Commit me" },
    ] as PartialBlock[];

    act(() => {
      result.current.saveDraft(
        "inst-commit",
        "persona-a",
        content,
        "Persona A",
      );
    });

    expect(localStorage.getItem("kolam_draft_v2_stream-commit")).not.toBeNull();

    await act(async () => {
      await result.current.commitDraft();
    });

    expect(localStorage.getItem("kolam_draft_v2_stream-commit")).toBeNull();
  });
});
