import { describe, it, expect } from "vitest";
import {
  BlockNoteBlock,
  EntryWithSections,
} from "@/lib/types";

// --- Test Personas ---
// Ibu Sari (organized teacher) generates XML for lesson planning with AI Dewi
// Pak Hadi (retired journalist) generates XML for his memoirs

// Re-implement pure helper functions from XMLGenerator.tsx for unit testing
function extractText(block: BlockNoteBlock): string {
  return block.content?.map((c) => c.text).join("") || "";
}

function blockToMarkdown(block: BlockNoteBlock): string {
  if (block.type === "heading") {
    const level = (block.props?.level as number) || 1;
    return "#".repeat(level) + " " + extractText(block);
  }
  if (block.type === "paragraph") {
    return extractText(block);
  }
  return extractText(block);
}

function canvasToMarkdown(blocks: BlockNoteBlock[]): string {
  return blocks.map(blockToMarkdown).join("\n\n");
}

function entryToMarkdown(entry: EntryWithSections): string {
  const dateStr = entry.created_at
    ? new Date(entry.created_at).toLocaleString()
    : "";

  let result = `<entry id="${entry.id}" date="${dateStr}">\n`;
  result += `<sections>\n`;

  entry.sections.forEach((section) => {
    const personaName =
      section.persona_name_snapshot || section.persona?.name || "User";
    const isShadow = section.persona?.is_shadow ? "true" : "false";
    const sectionType = section.section_type || "text";

    let content = canvasToMarkdown(
      (section.content_json as unknown as BlockNoteBlock[]) || []
    );

    if (
      section.section_pdf_attachments &&
      section.section_pdf_attachments.length > 0
    ) {
      const links = section.section_pdf_attachments
        .map(
          (att) => `[File: ${att.document?.original_filename}](#${att.document?.id})`
        )
        .join("\n");
      if (content.trim()) {
        content += "\n\n" + links;
      } else {
        content = links;
      }
    }

    result += `<section persona="${personaName}" shadow="${isShadow}" type="${sectionType}">\n${content}\n</section>\n`;
  });

  result += `</sections>\n</entry>`;

  return result;
}

// Helper to create test blocks
const para = (text: string): BlockNoteBlock => ({
  id: `b-${Math.random().toString(36).slice(2)}`,
  type: "paragraph",
  content: [{ type: "text", text }],
});

const heading = (text: string, level: number): BlockNoteBlock => ({
  id: `b-${Math.random().toString(36).slice(2)}`,
  type: "heading",
  props: { level },
  content: [{ type: "text", text }],
});

describe("extractText", () => {
  it("extracts from single content item", () => {
    expect(extractText(para("Hello"))).toBe("Hello");
  });

  it("concatenates multiple content items", () => {
    const block: BlockNoteBlock = {
      id: "b1",
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "World" },
      ],
    };
    expect(extractText(block)).toBe("Hello World");
  });

  it("returns empty for undefined content", () => {
    expect(extractText({ id: "b", type: "paragraph" })).toBe("");
  });
});

describe("blockToMarkdown", () => {
  it("converts heading level 1", () => {
    expect(blockToMarkdown(heading("Title", 1))).toBe("# Title");
  });

  it("converts heading level 3", () => {
    expect(blockToMarkdown(heading("Sub Section", 3))).toBe("### Sub Section");
  });

  it("defaults to h1 when heading has no level prop", () => {
    const block: BlockNoteBlock = {
      id: "b1",
      type: "heading",
      content: [{ type: "text", text: "No Level" }],
    };
    expect(blockToMarkdown(block)).toBe("# No Level");
  });

  it("converts paragraph to plain text", () => {
    expect(blockToMarkdown(para("Just text."))).toBe("Just text.");
  });

  it("handles unknown block types by extracting text", () => {
    const block: BlockNoteBlock = {
      id: "b1",
      type: "custom_unknown_type",
      content: [{ type: "text", text: "Fallback" }],
    };
    expect(blockToMarkdown(block)).toBe("Fallback");
  });
});

describe("canvasToMarkdown", () => {
  // Ibu Sari's lesson canvas
  it("converts multiple blocks to markdown with double newlines", () => {
    const blocks = [
      heading("Rantai Makanan", 1),
      para("Produsen menghasilkan energi dari matahari."),
      para("Konsumen primer memakan produsen."),
    ];

    const result = canvasToMarkdown(blocks);
    expect(result).toContain("# Rantai Makanan");
    expect(result).toContain("Produsen menghasilkan energi");
    expect(result).toContain("Konsumen primer");
    // Blocks separated by double newlines
    expect(result.split("\n\n")).toHaveLength(3);
  });

  it("handles empty canvas", () => {
    expect(canvasToMarkdown([])).toBe("");
  });
});

describe("entryToMarkdown", () => {
  // Pak Hadi's memoir entry
  it("formats entry with id and date as XML", () => {
    const entry: EntryWithSections = {
      id: "entry-hadi-1",
      stream_id: "s1",
      created_at: "2026-01-10T08:00:00Z",
      updated_at: "2026-01-10T08:00:00Z",
      deleted_at: null,
      is_draft: false,
      sections: [
        {
          id: "sec-1",
          entry_id: "entry-hadi-1",
          persona_id: "p1",
          persona_name_snapshot: "Pak Hadi",
          content_json: [
            {
              id: "b1",
              type: "paragraph",
              content: [{ type: "text", text: "Pantai di Bali sangat indah." }],
            },
          ] as unknown as import("@/lib/types/database.types").Json,
          search_text: "Pantai di Bali sangat indah.",
          sort_order: 0,
          created_at: "2026-01-10T08:00:00Z",
          updated_at: "2026-01-10T08:00:00Z",
          section_type: "text",
        },
      ],
    };

    const result = entryToMarkdown(entry);
    expect(result).toContain('<entry id="entry-hadi-1"');
    expect(result).toContain('persona="Pak Hadi" shadow="false" type="text"');
    expect(result).toContain("Pantai di Bali sangat indah.");
    expect(result).not.toContain("<files>");
  });

  it("handles entry with multiple sections and shadow personas", () => {
    const entry: EntryWithSections = {
      id: "entry-multi",
      stream_id: "s1",
      created_at: "2026-01-15T10:00:00Z",
      updated_at: "2026-01-15T10:00:00Z",
      deleted_at: null,
      is_draft: false,
      sections: [
        {
          id: "sec-1",
          entry_id: "entry-multi",
          persona_id: "p1",
          persona_name_snapshot: "Ibu Sari",
          content_json: [
            {
              id: "b1",
              type: "paragraph",
              content: [{ type: "text", text: "Question from teacher via WhatsApp." }],
            },
          ] as unknown as import("@/lib/types/database.types").Json,
          search_text: "Question",
          sort_order: 0,
          created_at: "2026-01-15T10:00:00Z",
          updated_at: "2026-01-15T10:00:00Z",
          section_type: "whatsapp",
          persona: {
            id: "p1",
            name: "Ibu Sari",
            is_shadow: true,
          } as import("@/lib/types/database.types").Tables<"personas">
        },
        {
          id: "sec-2",
          entry_id: "entry-multi",
          persona_id: "p2",
          persona_name_snapshot: "Dewi",
          content_json: [] as unknown as import("@/lib/types/database.types").Json,
          search_text: "AI answer",
          sort_order: 1,
          created_at: "2026-01-15T10:00:00Z",
          updated_at: "2026-01-15T10:00:00Z",
          section_type: "PDF",
          section_pdf_attachments: [
            {
              id: "att-1",
              section_id: "sec-2",
              document_id: "doc-1",
              created_at: "2026-01-15T10:00:00Z",
              document: {
                id: "doc-1",
                original_filename: "lesson_plan.pdf",
                extracted_markdown: "# Lesson Plan Content",
              } as import("@/lib/types").DocumentWithLatestJob
            }
          ] as import("@/lib/types").SectionPdfAttachmentWithDocument[]
        },
      ],
    };

    const result = entryToMarkdown(entry);
    
    // Ensure files are NOT rendered here because we made it a lampiran
    expect(result).not.toContain("<files>");
    expect(result).not.toContain('<file id="doc-1" name="lesson_plan.pdf">');
    expect(result).not.toContain("# Lesson Plan Content");
    
    // Check whatsapp section and shadow persona
    expect(result).toContain('persona="Ibu Sari" shadow="true" type="whatsapp"');
    expect(result).toContain("Question from teacher via WhatsApp.");
    
    // Check PDF section links
    expect(result).toContain('persona="Dewi" shadow="false" type="PDF"');
    expect(result).toContain("[File: lesson_plan.pdf](#doc-1)");
  });
});
