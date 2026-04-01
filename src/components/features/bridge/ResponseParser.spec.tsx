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
  mockCanvasInsert,
  mockCanvasInsertSelectSingle,
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
    currentBranchHeadId: "entry-parent" as string | null,
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
  mockCanvasInsert: vi.fn(),
  mockCanvasInsertSelectSingle: vi.fn(),
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
  applyCanvasMarkdownDiff,
  detectBridgeAssistantIdentity,
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
      insert: mockCanvasInsert,
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

mockCanvasInsert.mockImplementation(() => ({
  select: () => ({
    single: mockCanvasInsertSelectSingle,
  }),
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
    mockBranchContext.currentBranch = "main";
    mockBranchContext.currentBranchHeadId = "entry-parent";
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
    const relaxed =
      "<response><final>hello</final><artifact>+ test</artifact><citation_list>1. [A](https://example.com)</citation_list></response>";

    expect(extractTagContentByAliases(preferred, ["log", "thought_log"])).toBe(
      "hello",
    );
    expect(
      extractTagContentByAliases(legacy, ["log", "thought_log"]),
    ).toBe("hello");
    expect(
      extractTagContentByAliases(legacy, ["canvas", "canvas_update"]),
    ).toBe("+ test");
    expect(
      extractTagContentByAliases(relaxed, ["log", "thought_log", "answer", "final", "reply"]),
    ).toBe("hello");
    expect(
      extractTagContentByAliases(relaxed, ["canvas", "canvas_update", "artifact"]),
    ).toBe("+ test");
    expect(
      extractTagContentByAliases(relaxed, ["citations", "sources", "references", "citation_list"]),
    ).toBe("1. [A](https://example.com)");
  });

  it("detects assistant identity from structured metadata and model hints", () => {
    const identity = detectBridgeAssistantIdentity(`<response>
<assistant_identity>
assistant: ChatGPT
provider: OpenAI
model: GPT-4.1
</assistant_identity>
<log>Hello</log>
</response>`);

    expect(identity).toMatchObject({
      assistant: "ChatGPT",
      provider: "OpenAI",
      model: "GPT-4.1",
      displayLabel: "ChatGPT (GPT-4.1)",
      source: "assistant_identity",
    });

    const heuristicIdentity = detectBridgeAssistantIdentity(
      `<response><log>Provider: Anthropic\nModel: Claude Sonnet 4</log></response>`,
    );

    expect(heuristicIdentity).toMatchObject({
      assistant: "Claude",
      provider: "Anthropic",
      model: "Claude Sonnet 4",
      displayLabel: "Claude Sonnet 4",
    });
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

  it("preserves checklist markdown so task items stay editor-recognizable", () => {
    const result = resolveCanvasBlocks(`
## Next Steps
- [ ] Gather additional context
- [x] Perform web search
`);

    const markdown = blocksToStoredMarkdown(result.blocks);

    expect(result.blocks[1]?.type).toBe("checkListItem");
    expect(result.blocks[1]?.props).toMatchObject({ checked: false });
    expect(result.blocks[2]?.type).toBe("checkListItem");
    expect(result.blocks[2]?.props).toMatchObject({ checked: true });
    expect(markdown).toContain("- [ ] Gather additional context");
    expect(markdown).toContain("- [x] Perform web search");
    expect(markdown).not.toContain("\n[ ] Gather additional context");
  });

  it("treats plain markdown bullet lists as appendable markdown instead of diff removals", () => {
    const currentBlocks: Parameters<typeof resolveCanvasBlocks>[1] = [
      {
        id: "existing-block",
        type: "paragraph",
        content: [{ type: "text", text: "Existing canvas content" }],
        children: [],
      },
    ];

    const result = resolveCanvasBlocks(
      `
# New Section

- First bullet
- Second bullet
`,
      currentBlocks,
    );

    expect(result.error).toBeUndefined();
    expect(result.format).toBe("markdown");
    const markdown = blocksToStoredMarkdown([
      ...currentBlocks,
      ...result.blocks,
    ]);
    expect(markdown).toContain("Existing canvas content");
    expect(markdown).toContain("# New Section");
    expect(markdown).toContain("- First bullet");
    expect(markdown).toContain("- Second bullet");
  });

  it("applies messy continue diffs against raw markdown without duplicating canvas content", () => {
    const currentMarkdown = `# Song Information: "En Casita"
## Track Details
- **Artist:** Bad Bunny (feat. Gabriela Berlingeri)
- **Album:** *Las Que No Iban a Salir* (2020)
- **Genre:** Latin Trap / Lo-fi
## Key Lyrics Breakdown
> "Otro sunset bonito que veo en San Juan / Disfrutando de toda' esas cosas que extranan los que se van..."
- **Theme:** Appreciation for the simple beauty of home during isolation.
- **Context:** The song was recorded and released during the COVID-19 quarantine, focusing on the desire to be with someone while staying safe at home ("en casita").
- **Cultural Note:** Refers to the Puerto Rican diaspora (those who "leave") and the unique atmosphere of San Juan sunsets.`;

    const diff = `
  - # Song Information: "En Casita"

<!-- end list -->

  + # Song Information: "En Casita"

      - ## Track Details
      -   * **Artist:** Bad Bunny (feat. Gabriela Berlingeri)
      -   * **Album:** *Las Que No Iban a Salir* (2020)
      -   * **Genre:** Latin Trap / Lo-fi

<!-- end list -->

  + ## Track Details

  + 
  + **Artist:** Bad Bunny (feat. Gabriela Berlingeri)

  + 
  + **Album:** *Las Que No Iban a Salir* (2020)

  + 
  + **Genre:** Latin Trap / Lo-fi

    ## Key Lyrics Breakdown

    > "Otro sunset bonito que veo en San Juan / Disfrutando de toda' esas cosas que extranan los que se van..."

<!-- end list -->

  -   * **Theme:** Appreciation for the simple beauty of home during isolation.
  -   * **Context:** The song was recorded and released during the COVID-19 quarantine, focusing on the desire to be with someone while staying safe at home ("en casita").
  -   * **Cultural Note:** Refers to the Puerto Rican diaspora (those who "leave") and the unique atmosphere of San Juan sunsets.

<!-- end list -->

  + **Theme:** Appreciation for the simple beauty of home during isolation.
  + 
  + **Context:** The song was recorded and released during the COVID-19 quarantine, focusing on the desire to be with someone while staying safe at home ("en casita").
  + 
  + **Cultural Note:** Refers to the Puerto Rican diaspora (those who "leave") and the unique atmosphere of San Juan sunsets.
`;

    const patched = applyCanvasMarkdownDiff(currentMarkdown, diff);

    expect(patched).not.toContain("<!-- end list -->");
    expect(patched.match(/# Song Information: "En Casita"/g)?.length).toBe(1);
    expect(patched).toContain("## Track Details");
    expect(patched).toContain("**Artist:** Bad Bunny (feat. Gabriela Berlingeri)");
    expect(patched).not.toContain("- **Artist:** Bad Bunny (feat. Gabriela Berlingeri)");
    expect(patched).not.toContain("- **Theme:** Appreciation for the simple beauty of home during isolation.");
  });

  it("normalizes malformed inline list markers in canvas diff output", () => {
    const diff = `
  + # Song Profile: "En Casita"
  + **Artist:** Bad Bunny (feat. Gabriela Berlingeri)
  + **Album:** *Las Que No Iban a Salir* (2020)
  + **Key Themes:** + \\* Quarantine and social distancing
  +   * Nostalgia for Puerto Rico (San Juan)
  +   * Appreciation for simple moments/sunsets
`;

    const patched = applyCanvasMarkdownDiff("", diff);

    expect(patched).toContain('**Key Themes:**\n- Quarantine and social distancing');
    expect(patched).toContain("- Nostalgia for Puerto Rico (San Juan)");
    expect(patched).toContain("- Appreciation for simple moments/sunsets");
    expect(patched).not.toContain("+ *");
  });

  it("collapses duplicate consecutive headings after applying messy correction diffs", () => {
    const currentMarkdown = `# Song Identification: "Acho PR"
## Track Details
- **Artist:** Bad Bunny (feat. Arcángel, De La Ghetto, & Ñengo Flow)
- **Album:** *Nadie Sabe Lo Que Va a Pasar Mañana* (2023)
- **Genre:** Trap / Reggaeton (with a melodic outro)
## Key Lyrics Provided
> "Otro sunset bonito que veo en San Juan / Disfrutando de toda' esas cosas que extrañan los que se van..."
## Context & Themes
- **Location:** San Juan, Puerto Rico.
- **Theme:** Nostalgia, gratitude, and a connection to one's homeland.
- **Composition:** The song transitions from hard-hitting verses into this atmospheric, reflective closing section.`;

    const diff = `
  - # Song Identification: "Acho PR"

<!-- end list -->

  + # Song Identification: "DtMF" (Debí Tirar Más Fotos)
  + ## Track Details
      * **Artist:** Bad Bunny

<!-- end list -->

  -   * **Album:** *Nadie Sabe Lo Que Va a Pasar Mañana* (2023)
  -   * **Genre:** Trap / Reggaeton (with a melodic outro)

<!-- end list -->

  +   * **Album:** *Nadie Sabe Lo Que Va a Pasar Mañana* (2023)
  +   * **Genre:** Melodic Trap / Latin Pop / Bolero-inspired

\`\`\`
## Key Lyrics Provided

> "Otro sunset bonito que veo en San Juan / Disfrutando de toda' esas cosas que extrañan los que se van..."

## Context & Themes

  * **Location:** San Juan, Puerto Rico.
\`\`\`

<!-- end list -->

  -   * **Theme:** Nostalgia, gratitude, and a connection to one's homeland.
  -   * **Composition:** The song transitions from hard-hitting verses into this atmospheric, reflective closing section.

<!-- end list -->

  +   * **Theme:** Regret, nostalgia for a past love, and appreciation for his island home.
  +   * **Composition:** Known for its sentimental tone and "bolero" influence; the lyrics provided appear at both the beginning and the end of the track.
`;

    const patched = applyCanvasMarkdownDiff(currentMarkdown, diff);

    expect(patched.match(/^## Track Details$/gm)?.length).toBe(1);
    expect(patched).toContain('# Song Identification: "DtMF" (Debí Tirar Más Fotos)');
    expect(patched).toContain("- **Genre:** Melodic Trap / Latin Pop / Bolero-inspired");
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
        raw_markdown: "- kuberitahu\n<!-- end list -->",
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
    expect(updatedCanvasMarkdown).not.toContain("<!-- end list -->");
    expect(updatedCanvasMarkdown).not.toContain("- kuberitahu");
    expect(mockCanvasUpdateEq).toHaveBeenCalledWith("id", "canvas-1");

    const latestSnapshotInvalidation = invalidateQueriesSpy.mock.calls.some(
      ([args]) =>
        Array.isArray(args?.queryKey) &&
        args.queryKey[0] === "canvas-latest-version" &&
        args.queryKey[1] === "stream-1",
    );
    expect(latestSnapshotInvalidation).toBe(true);

    const quickEntriesInvalidation = invalidateQueriesSpy.mock.calls.some(
      ([args]) =>
        Array.isArray(args?.queryKey) &&
        args.queryKey[0] === "bridge-quick-entries" &&
        args.queryKey[1] === "stream-1",
    );
    expect(quickEntriesInvalidation).toBe(true);
  });

  it("synthesizes a minimal log entry when BOTH mode returns only canvas output", async () => {
    mockCanvasSelectMaybeSingle.mockResolvedValue({
      data: {
        id: "canvas-1",
        content_json: [],
        raw_markdown: "",
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
<canvas>
+ # New canvas note
</canvas>
<base>2026-03-29T13:17:40.87026+00:00</base>
</response>`;

    const ref = createRef<ResponseParserHandle>();

    render(
      <QueryClientProvider client={new QueryClient()}>
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
    expect(mockEntriesInsert).toHaveBeenCalled();
    expect(mockSectionsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        persona_name_snapshot: "AI",
        raw_markdown: expect.stringContaining("Updated the canvas for this turn."),
      }),
    );
  });

  it("appends AI log entries to the live branch head even when the branch hook is stale", async () => {
    mockBranchContext.currentBranchHeadId = null;
    mockCanvasSelectMaybeSingle.mockResolvedValue({
      data: {
        id: "canvas-1",
        content_json: [],
        raw_markdown: "",
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
      data: { id: "branch-1", head_commit_id: "entry-db-head" },
      error: null,
    });
    mockBranchesInsertSelectSingle.mockResolvedValue({
      data: { id: "branch-1", head_commit_id: null },
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
Append this AI note.
</log>
<canvas>
+ # Canvas note
</canvas>
<base>2026-03-29T13:17:40.87026+00:00</base>
</response>`;

    const ref = createRef<ResponseParserHandle>();

    render(
      <QueryClientProvider client={new QueryClient()}>
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
    expect(mockEntriesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        stream_id: "stream-1",
        is_draft: false,
        parent_commit_id: "entry-db-head",
      }),
    );
  });

  it("creates a missing canvas row when BOTH mode returns canvas content for a stream without one", async () => {
    mockCanvasSelectMaybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      });
    mockCanvasInsertSelectSingle.mockResolvedValue({
      data: { id: "canvas-new" },
      error: null,
    });
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
These lyrics are from **"Otro Atardecer"**.
</log>
<canvas>
+ # Song: "Otro Atardecer"
+ 
+ ## Key Themes
+ - San Juan sunset imagery
+ - Nostalgia for island life
</canvas>
<base>2026-03-31T03:19:31.315891+00:00</base>
</response>`;

    const ref = createRef<ResponseParserHandle>();

    render(
      <QueryClientProvider client={new QueryClient()}>
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
    expect(mockCanvasInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        stream_id: "stream-1",
        raw_markdown: expect.stringContaining('# Song: "Otro Atardecer"'),
      }),
    );
    expect(mockCanvasVersionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas_id: "canvas-new",
        stream_id: "stream-1",
      }),
    );
  });

  it("uses the parsed assistant identity as the persona snapshot when applying", async () => {
    mockCanvasSelectMaybeSingle.mockResolvedValue({
      data: {
        id: "canvas-1",
        content_json: [],
        raw_markdown: "",
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
<assistant_identity>
assistant: ChatGPT
provider: OpenAI
model: GPT-4.1
</assistant_identity>
<log>
Apply this with the detected identity.
</log>
<canvas>
+ # Canvas note
</canvas>
<base>2026-03-29T13:17:40.87026+00:00</base>
</response>`;

    const ref = createRef<ResponseParserHandle>();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ResponseParser
          ref={ref}
          streamId="stream-1"
          interactionMode="BOTH"
          aiPersonaLabel="Gemini"
          pastedXML={xml}
          onPastedXMLChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());

    const didApply = await ref.current?.quickApply();

    expect(didApply).toBe(true);
    expect(mockSectionsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        persona_name_snapshot: "ChatGPT (GPT-4.1)",
      }),
    );
  });
});
