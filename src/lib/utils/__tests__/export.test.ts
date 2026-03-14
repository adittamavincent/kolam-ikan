// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportEntriesToMarkdown, downloadMarkdown } from "../export";
import { EntryWithSections } from "@/lib/types";

// --- Test Personas ---
// Ibu Sari (organized teacher) exports her lesson plans
// Pak Hadi (retired journalist) exports his memoirs

const createEntry = (
  id: string,
  date: string,
  sections: Array<{
    personaName: string;
    blocks: Array<{
      type: string;
      text: string;
      props?: Record<string, unknown>;
    }>;
  }>,
): EntryWithSections => ({
  id,
  stream_id: "stream-1",
  created_at: date,
  updated_at: date,
  deleted_at: null,
  is_draft: false,
  sections: sections.map((s, i) => ({
    id: `section-${id}-${i}`,
    entry_id: id,
    persona_id: `persona-${i}`,
    persona_name_snapshot: s.personaName,
    content_json: s.blocks.map((b) => ({
      id: `block-${i}`,
      type: b.type,
      content: [{ type: "text" as const, text: b.text }],
      ...(b.props ? { props: b.props } : {}),
    })) as unknown as import("@/lib/types/database.types").Json,
    search_text: s.blocks.map((b) => b.text).join(" "),
    sort_order: i,
    created_at: date,
    updated_at: date,
    persona: {
      id: `persona-${i}`,
      user_id: "user-1",
      type: "HUMAN" as const,
      name: s.personaName,
      icon: "user",
      color: "#0ea5e9",
      is_system: false, is_shadow: false,
      created_at: date,
      updated_at: date,
      deleted_at: null,
    },
  })),
});

describe("exportEntriesToMarkdown", () => {
  // Scene: Ibu Sari exports her biology lesson entries
  it("exports a single entry with one section correctly", () => {
    const entries = [
      createEntry("e1", "2026-01-15T10:00:00Z", [
        {
          personaName: "Ibu Sari",
          blocks: [
            {
              type: "paragraph",
              text: "Rantai makanan dimulai dari produsen.",
            },
          ],
        },
      ]),
    ];

    const result = exportEntriesToMarkdown(entries);

    expect(result).toContain("## Entry");
    expect(result).toContain("### Ibu Sari");
    expect(result).toContain("Rantai makanan dimulai dari produsen.");
  });

  // Scene: Ibu Sari + AI Dewi multi-persona entry
  it("exports multi-persona entry with both human and AI sections", () => {
    const entries = [
      createEntry("e1", "2026-01-15T10:00:00Z", [
        {
          personaName: "Ibu Sari",
          blocks: [
            {
              type: "paragraph",
              text: "Bagaimana cara menjelaskan fotosintesis?",
            },
          ],
        },
        {
          personaName: "Dewi",
          blocks: [
            {
              type: "paragraph",
              text: "Gunakan diagram alur cahaya → klorofil → glukosa.",
            },
          ],
        },
      ]),
    ];

    const result = exportEntriesToMarkdown(entries);

    expect(result).toContain("### Ibu Sari");
    expect(result).toContain("### Dewi");
    expect(result).toContain("Bagaimana cara menjelaskan fotosintesis?");
    expect(result).toContain("diagram alur cahaya");
  });

  // Scene: Pak Hadi exports 3 days of memoir entries
  it("separates multiple entries with --- divider", () => {
    const entries = [
      createEntry("e1", "2026-01-10T08:00:00Z", [
        {
          personaName: "Pak Hadi",
          blocks: [{ type: "paragraph", text: "Masa kecil di Surabaya." }],
        },
      ]),
      createEntry("e2", "2026-01-11T09:00:00Z", [
        {
          personaName: "Pak Hadi",
          blocks: [{ type: "paragraph", text: "Pertama kali ke Jakarta." }],
        },
      ]),
      createEntry("e3", "2026-01-12T10:00:00Z", [
        {
          personaName: "Pak Hadi",
          blocks: [{ type: "paragraph", text: "Mulai bekerja di koran." }],
        },
      ]),
    ];

    const result = exportEntriesToMarkdown(entries);

    // Should have 2 dividers between 3 entries
    const dividers = result.split("---").length - 1;
    expect(dividers).toBe(2);
    expect(result).toContain("Masa kecil di Surabaya.");
    expect(result).toContain("Pertama kali ke Jakarta.");
    expect(result).toContain("Mulai bekerja di koran.");
  });

  // Scene: Handling different block types in export
  it("converts heading blocks to markdown heading syntax", () => {
    const entries = [
      createEntry("e1", "2026-01-15T10:00:00Z", [
        {
          personaName: "Ibu Sari",
          blocks: [
            { type: "heading", text: "Bab 1: Ekologi", props: { level: 2 } },
          ],
        },
      ]),
    ];

    const result = exportEntriesToMarkdown(entries);
    expect(result).toContain("## Bab 1: Ekologi");
  });

  it("converts bullet list items to markdown list syntax", () => {
    const entries = [
      createEntry("e1", "2026-01-15T10:00:00Z", [
        {
          personaName: "Ibu Sari",
          blocks: [
            { type: "bulletListItem", text: "Produsen" },
            { type: "bulletListItem", text: "Konsumen primer" },
          ],
        },
      ]),
    ];

    const result = exportEntriesToMarkdown(entries);
    expect(result).toContain("- Produsen");
    expect(result).toContain("- Konsumen primer");
  });

  it("converts numbered list items to markdown numbered list", () => {
    const entries = [
      createEntry("e1", "2026-01-15T10:00:00Z", [
        {
          personaName: "Ibu Sari",
          blocks: [
            { type: "numberedListItem", text: "Langkah pertama" },
            { type: "numberedListItem", text: "Langkah kedua" },
          ],
        },
      ]),
    ];

    const result = exportEntriesToMarkdown(entries);
    expect(result).toContain("1. Langkah pertama");
    expect(result).toContain("1. Langkah kedua");
  });

  // Edge case: empty entries array
  it("handles empty entries array gracefully", () => {
    const result = exportEntriesToMarkdown([]);
    expect(result).toBe("");
  });

  // Edge case: entry with no sections
  it("handles entry with empty sections", () => {
    const entry: EntryWithSections = {
      id: "e-empty",
      stream_id: "stream-1",
      created_at: "2026-01-15T10:00:00Z",
      updated_at: "2026-01-15T10:00:00Z",
      deleted_at: null,
      is_draft: false,
      sections: [],
    };

    const result = exportEntriesToMarkdown([entry]);
    expect(result).toContain("## Entry");
  });

  // Edge case: section where content_json is not an array
  it("handles non-array content_json gracefully", () => {
    const entry: EntryWithSections = {
      id: "e-bad",
      stream_id: "stream-1",
      created_at: "2026-01-15T10:00:00Z",
      updated_at: "2026-01-15T10:00:00Z",
      deleted_at: null,
      is_draft: false,
      sections: [
        {
          id: "sec-1",
          entry_id: "e-bad",
          persona_id: "p1",
          persona_name_snapshot: "Test",
          content_json:
            "not an array" as unknown as import("@/lib/types/database.types").Json,
          search_text: "",
          sort_order: 0,
          created_at: "2026-01-15T10:00:00Z",
          updated_at: "2026-01-15T10:00:00Z",
          persona: {
            id: "p1",
            user_id: "u1",
            type: "HUMAN" as const,
            name: "Test",
            icon: "user",
            color: "#000",
            is_system: false, is_shadow: false,
            created_at: "2026-01-15T10:00:00Z",
            updated_at: "2026-01-15T10:00:00Z",
            deleted_at: null,
          },
        },
      ],
    };

    // Should not throw
    expect(() => exportEntriesToMarkdown([entry])).not.toThrow();
  });
});

describe("downloadMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a blob URL and triggers download", () => {
    // Mock DOM APIs
    const mockClick = vi.fn();
    const mockAppendChild = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation(vi.fn());
    const mockRemoveChild = vi
      .spyOn(document.body, "removeChild")
      .mockImplementation(vi.fn());
    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:test-url");
    const mockRevokeObjectURL = vi.fn();

    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    const mockCreateElement = vi
      .spyOn(document, "createElement")
      .mockReturnValue({
        href: "",
        download: "",
        click: mockClick,
      } as unknown as HTMLAnchorElement);

    downloadMarkdown("# My Memoir", "memoir.md");

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockCreateElement).toHaveBeenCalledWith("a");
    expect(mockAppendChild).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockRemoveChild).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:test-url");

    mockAppendChild.mockRestore();
    mockRemoveChild.mockRestore();
    mockCreateElement.mockRestore();
  });
});
