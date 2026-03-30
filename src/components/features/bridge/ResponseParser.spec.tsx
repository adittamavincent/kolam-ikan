// @vitest-environment jsdom
import React, { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";

const {
  mockSupabase,
  mockBranchContext,
  mockCanvasDraftActions,
  mockCanvasSelectMaybeSingle,
  mockCanvasSelectSingle,
  mockCanvasUpdate,
  mockCanvasUpdateEq,
  mockEntriesInsert,
  mockEntriesInsertSelectSingle,
  mockSectionsInsert,
  mockBranchesSelectMaybeSingle,
  mockBranchesUpdate,
  mockBranchesInsertSelectSingle,
  mockBranchesUpdateEq,
  mockPersonasMaybeSingle,
  mockAuditInsert,
  mockCanvasVersionInsert,
} = vi.hoisted(() => ({
  mockSupabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: vi.fn(),
  },
  mockBranchContext: {
    currentBranch: "main",
    currentBranchHeadId: "entry-parent",
  },
  mockCanvasDraftActions: {
    setLiveContent: vi.fn(),
    setLiveMarkdown: vi.fn(),
    markClean: vi.fn(),
    setSyncStatus: vi.fn(),
    setLocalStatus: vi.fn(),
  },
  mockCanvasSelectMaybeSingle: vi.fn(),
  mockCanvasSelectSingle: vi.fn(),
  mockCanvasUpdate: vi.fn(),
  mockCanvasUpdateEq: vi.fn(),
  mockEntriesInsert: vi.fn(),
  mockEntriesInsertSelectSingle: vi.fn(),
  mockSectionsInsert: vi.fn(),
  mockBranchesSelectMaybeSingle: vi.fn(),
  mockBranchesUpdate: vi.fn(),
  mockBranchesInsertSelectSingle: vi.fn(),
  mockBranchesUpdateEq: vi.fn(),
  mockPersonasMaybeSingle: vi.fn(),
  mockAuditInsert: vi.fn(),
  mockCanvasVersionInsert: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

vi.mock("@/lib/hooks/useLogBranchContext", () => ({
  useLogBranchContext: () => mockBranchContext,
}));

vi.mock("@/lib/hooks/useCanvasDraft", () => ({
  useCanvasDraft: (
    selector: (state: typeof mockCanvasDraftActions) => unknown,
  ) => selector(mockCanvasDraftActions),
}));

import {
  ResponseParser,
  type ResponseParserHandle,
  extractTagContentByAliases,
  normalizeBridgeResponseText,
  resolveCanvasBlocks,
} from "./ResponseParser";
import { blocksToStoredMarkdown } from "@/lib/content-protocol";
import { normalizeOaiCitationsInMarkdown } from "@/lib/oaicite";

mockSupabase.from.mockImplementation((table: string) => {
  if (table === "canvases") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: mockCanvasSelectMaybeSingle,
          single: mockCanvasSelectSingle,
        }),
      }),
      update: mockCanvasUpdate,
    };
  }

  if (table === "entries") {
    return {
      insert: mockEntriesInsert,
    };
  }

  if (table === "sections") {
    return {
      insert: mockSectionsInsert,
    };
  }

  if (table === "branches") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: mockBranchesSelectMaybeSingle,
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: mockBranchesInsertSelectSingle,
        }),
      }),
      update: mockBranchesUpdate,
    };
  }

  if (table === "personas") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: mockPersonasMaybeSingle,
            }),
          }),
        }),
      }),
    };
  }

  if (table === "audit_logs") {
    return {
      insert: mockAuditInsert,
    };
  }

  if (table === "canvas_versions") {
    return {
      insert: mockCanvasVersionInsert,
    };
  }

  throw new Error(`Unexpected table mock: ${table}`);
});

mockCanvasUpdate.mockImplementation(() => ({
  eq: mockCanvasUpdateEq,
}));

mockEntriesInsert.mockImplementation(() => ({
  select: () => ({
    single: mockEntriesInsertSelectSingle,
  }),
}));

mockBranchesUpdate.mockImplementation(() => ({
  eq: mockBranchesUpdateEq,
}));

describe("ResponseParser helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes escaped xml-like bridge responses", () => {
    const raw = String.raw`\ <response>
\ <log>
hello
\ </log>
\ <canvas>
+ # Title
\ + ### 1\. Track
\ </canvas>
\ </response>`
      .replace(/\\ /g, "\\");

    const normalized = normalizeBridgeResponseText(raw);

    expect(normalized).toContain("<response>");
    expect(normalized).toContain("<log>");
    expect(normalized).toContain("</canvas>");
    expect(normalized).toContain("### 1. Track");
  });

  it("reads preferred and legacy tags through aliases", () => {
    const preferred = "<response><log>hello</log><canvas>+ test</canvas></response>";
    const legacy =
      "<response><thought_log>hello</thought_log><canvas_update>+ test</canvas_update></response>";

    expect(extractTagContentByAliases(preferred, ["log", "thought_log"])).toBe(
      "hello",
    );
    expect(
      extractTagContentByAliases(legacy, ["log", "thought_log"]),
    ).toBe("hello");
    expect(
      extractTagContentByAliases(legacy, ["canvas", "canvas_update"]),
    ).toBe("+ test");
  });

  it("parses prefixed canvas diff lines into separate markdown blocks", () => {
    const result = resolveCanvasBlocks(`
  + # Project: Vincent Character Profile
  + 
  + ## Character Essence
  + Vincent is a study in contrasts.
  + 
  + * Bullet one
  + * Bullet two
`);

    expect(result.error).toBeUndefined();
    expect(result.blocks[0]?.type).toBe("heading");
    expect(result.blocks[1]?.type).toBe("heading");
    expect(result.blocks.some((block) => block.type === "bulletListItem")).toBe(
      true,
    );
  });

  it("preserves line-oriented markdown more faithfully for canvas output", () => {
    const result = resolveCanvasBlocks(`
  + # Project: Song Identification
  + 
  + ## Current Song
  + **Title:** Who Knows
  + **Artist:** Tevit
  + 
  + ### Lyrics Provided
  + > Line one
  + > Line two
    -----
  + 
  + ## Previous Snippet
  + *“Quoted text”*
`);

    const markdown = blocksToStoredMarkdown(result.blocks);

    expect(markdown).toContain("**Title:** Who Knows");
    expect(markdown).toContain("**Artist:** Tevit");
    expect(markdown).toContain("> Line one\n> Line two");
    expect(markdown).toContain("-----");
    expect(markdown).not.toContain("Who Knows Artist: Tevit");
  });

  it("normalizes ChatGPT contentReference citations before canvas parsing", () => {
    const normalized = normalizeOaiCitationsInMarkdown(`
## Song Identified
Bad Bunny :contentReference[oaicite:0]{index=0}
`);

    const result = resolveCanvasBlocks(normalized);
    const markdown = blocksToStoredMarkdown(result.blocks);

    expect(markdown).toContain("[1](#citation-1)");
    expect(markdown).toContain("## Citations");
    expect(markdown).toContain("1. OpenAI citation 1");
  });

  it("quick-apply creates a branch-linked AI commit, uses the current canvas as diff base, and refreshes the latest snapshot cache", async () => {
    const currentCanvasBlocks = [
      {
        id: "old-song",
        type: "bulletListItem",
        content: [{ type: "text", text: "kuberitahu" }],
        children: [],
      },
      {
        id: "end-list",
        type: "paragraph",
        content: [{ type: "text", text: "<!-- end list -->" }],
        children: [],
      },
    ];

    mockCanvasSelectMaybeSingle.mockResolvedValue({
      data: {
        id: "canvas-1",
        content_json: currentCanvasBlocks,
        updated_at: "2026-03-29T13:17:40.87026+00:00",
      },
      error: null,
    });
    mockCanvasSelectSingle.mockResolvedValue({
      data: { id: "canvas-1" },
      error: null,
    });
    mockCanvasUpdateEq.mockResolvedValue({ error: null });
    mockEntriesInsertSelectSingle.mockResolvedValue({
      data: { id: "entry-new" },
      error: null,
    });
    mockSectionsInsert.mockResolvedValue({ error: null });
    mockBranchesSelectMaybeSingle.mockResolvedValue({
      data: { id: "branch-1" },
      error: null,
    });
    mockBranchesInsertSelectSingle.mockResolvedValue({
      data: { id: "branch-1" },
      error: null,
    });
    mockBranchesUpdateEq.mockResolvedValue({ error: null });
    mockPersonasMaybeSingle.mockResolvedValue({
      data: { id: "persona-ai" },
      error: null,
    });
    mockAuditInsert.mockResolvedValue({ error: null });
    mockCanvasVersionInsert.mockResolvedValue({ error: null });

    const xml = `<response>
<log>
AI summary paragraph.
</log>
<canvas>
  - kuberitahu

  <!-- end list -->

  + # Song Project: Vincent's World
  + 
  + ## Featured Tracks
</canvas>
<base>2026-03-29T13:17:40.87026+00:00</base>
</response>`;

    const queryClient = new QueryClient();
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
    const ref = createRef<ResponseParserHandle>();

    render(
      <QueryClientProvider client={queryClient}>
        <ResponseParser
          ref={ref}
          streamId="stream-1"
          interactionMode="BOTH"
          pastedXML={xml}
          onPastedXMLChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());

    const didApply = await ref.current?.quickApply();

    expect(didApply).toBe(true);
    expect(mockEntriesInsertSelectSingle).toHaveBeenCalled();
    expect(mockEntriesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        stream_id: "stream-1",
        is_draft: false,
        parent_commit_id: "entry-parent",
      }),
    );
    expect(mockBranchesUpdate).toHaveBeenCalledWith({
      head_commit_id: "entry-new",
    });
    expect(mockBranchesUpdateEq).toHaveBeenCalledWith("id", "branch-1");
    expect(mockCanvasVersionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        branch_name: "main",
        source_entry_id: "entry-new",
      }),
    );
    expect(mockCanvasUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_markdown: expect.stringContaining("# Song Project: Vincent's World"),
      }),
    );
    const updatedCanvasMarkdown = mockCanvasUpdate.mock.calls[0]?.[0]?.raw_markdown;
    expect(updatedCanvasMarkdown).toContain("<!-- end list -->");
    expect(updatedCanvasMarkdown).not.toContain("- kuberitahu");
    expect(mockCanvasUpdateEq).toHaveBeenCalledWith("id", "canvas-1");

    const latestSnapshotInvalidation = invalidateQueriesSpy.mock.calls.some(
      ([args]) =>
        Array.isArray(args?.queryKey) &&
        args.queryKey[0] === "canvas-latest-version" &&
        args.queryKey[1] === "stream-1",
    );
    expect(latestSnapshotInvalidation).toBe(true);
  });
});
