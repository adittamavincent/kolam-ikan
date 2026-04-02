import { describe, expect, it } from "vitest";
import { buildBridgePayload, selectIncrementalBridgeContext } from "./bridge-payload";
import type { EntryWithSections, MarkdownBlock } from "@/lib/types";

function makeEntry(id: string, createdAt: string): EntryWithSections {
  return {
    id,
    created_at: createdAt,
    stream_id: "stream-1",
    is_draft: false,
    created_by: null,
    sections: [],
    kind: null,
    branch_id: null,
    parent_entry_id: null,
    merge_base_entry_id: null,
    merge_metadata: null,
  } as unknown as EntryWithSections;
}

function makeCanvas(updatedAt: string, text: string) {
  const content: MarkdownBlock[] = [
    {
      id: "block-1",
      type: "paragraph",
      content: [{ type: "text", text }],
      children: [],
    },
  ];

  return {
    id: "canvas-1",
    stream_id: "stream-1",
    updated_at: updatedAt,
    content_json: content,
  };
}

describe("selectIncrementalBridgeContext", () => {
  it("keeps only changes that happened after the active session started", () => {
    const sessionLoadedAt = "2026-03-29T10:00:00.000Z";
    const olderEntry = makeEntry("entry-old", "2026-03-29T09:59:59.000Z");
    const newerEntry = makeEntry("entry-new", "2026-03-29T10:05:00.000Z");
    const olderCanvas = makeCanvas("2026-03-29T09:58:00.000Z", "old");
    const newerGlobalCanvas = {
      ...makeCanvas("2026-03-29T10:06:00.000Z", "global"),
      stream_id: "global-1",
    };

    const result = selectIncrementalBridgeContext({
      payloadVariant: "followup",
      sessionLoadedAt,
      entries: [olderEntry, newerEntry],
      canvas: olderCanvas,
      globalEntries: [olderEntry, newerEntry],
      globalCanvases: [olderCanvas, newerGlobalCanvas],
    });

    expect(result.entries).toEqual([newerEntry]);
    expect(result.canvas).toBeNull();
    expect(result.globalEntries).toEqual([newerEntry]);
    expect(result.globalCanvases).toEqual([newerGlobalCanvas]);
  });
});

describe("buildBridgePayload followup", () => {
  it("includes only incremental context and followup instructions", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Current Stream",
        stream_kind: "REGULAR",
        domain: { name: "Demo Domain" },
      },
      interactionMode: "BOTH",
      includeCanvas: true,
      canvas: makeCanvas("2026-03-29T10:05:00.000Z", "Canvas delta"),
      entries: [makeEntry("entry-new", "2026-03-29T10:05:00.000Z")],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "Apply the new changes only.",
      payloadVariant: "followup",
      sessionLoadedAt: "2026-03-29T10:00:00.000Z",
    });

    expect(payload).toContain('<session_followup phase="continue">');
    expect(payload).toContain("<continue_contract_ref>cold_boot.response_instructions</continue_contract_ref>");
    expect(payload).toContain("<continue_delta_rules>");
    expect(payload).toContain("<incremental_context>");
    expect(payload).toContain("delta-only context");
    expect(payload).toContain("append-ready prose for this turn only");
    expect(payload).toContain("unified diff against the canvas already loaded");
    expect(payload).toContain("Treat <changed_canvas> as a reference snapshot");
    expect(payload).toContain("Canvas delta");
    expect(payload).toContain("Apply the new changes only.");
    expect(payload).toContain('<incremental_instruction state="provided">');
    expect(payload).not.toContain("<continue_response_rules>");
    expect(payload).not.toContain("Example continue response:");
    expect(payload).not.toContain("model: Gemini 2.5 Pro");
    expect(payload).not.toContain("<system_directive>");
    expect(payload).not.toContain("Session window start:");
  });

  it("tells empty continue turns not to invent new content", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Current Stream",
        stream_kind: "REGULAR",
        domain: { name: "Demo Domain" },
      },
      interactionMode: "BOTH",
      includeCanvas: true,
      canvas: makeCanvas("2026-03-29T10:05:00.000Z", "Canvas delta"),
      entries: [],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "   ",
      payloadVariant: "followup",
      sessionLoadedAt: "2026-03-29T10:00:00.000Z",
    });

    expect(payload).toContain('<incremental_instruction state="empty">');
    expect(payload).toContain("No new instruction for this continue turn");
    expect(payload).toContain("do not add recommendations or adjacent ideas");
    expect(payload).toContain("<changed_canvas>");
    expect(payload).toContain("Canvas delta");
  });

  it("marks followup context as empty when no incremental changes were found", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Current Stream",
        stream_kind: "REGULAR",
        domain: { name: "Demo Domain" },
      },
      interactionMode: "BOTH",
      includeCanvas: true,
      canvas: null,
      entries: [],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "   ",
      payloadVariant: "followup",
      sessionLoadedAt: "2026-03-29T10:00:00.000Z",
    });

    expect(payload).toContain('<incremental_context state="empty">');
    expect(payload).toContain("No new stream, canvas, or global-context changes were detected.");
  });

  it("preserves structured canvas markdown in followup snapshots", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Current Stream",
        stream_kind: "REGULAR",
        domain: { name: "Demo Domain" },
      },
      interactionMode: "BOTH",
      includeCanvas: true,
      canvas: {
        id: "canvas-1",
        stream_id: "stream-1",
        updated_at: "2026-03-29T10:05:00.000Z",
        content_json: [
          {
            id: "heading-1",
            type: "heading",
            props: { level: 2 },
            content: [{ type: "text", text: "Next Steps" }],
            children: [],
          },
          {
            id: "bullet-1",
            type: "bulletListItem",
            content: [{ type: "text", text: "Search exact lyrics" }],
            children: [],
          },
          {
            id: "bullet-2",
            type: "bulletListItem",
            content: [{ type: "text", text: "Check recent Bad Bunny tracks" }],
            children: [],
          },
        ],
      },
      entries: [],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "",
      payloadVariant: "followup",
      sessionLoadedAt: "2026-03-29T10:00:00.000Z",
    });

    expect(payload).toContain("## Next Steps");
    expect(payload).toContain("- Search exact lyrics");
    expect(payload).toContain("- Check recent Bad Bunny tracks");
  });

  it("frames the full payload as a cold-boot session setup without replacing provider behavior", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Current Stream",
        stream_kind: "REGULAR",
        domain: { name: "Demo Domain" },
      },
      interactionMode: "ASK",
      includeCanvas: false,
      canvas: null,
      entries: [],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "Introduce the session.",
      payloadVariant: "full",
      sessionLoadedAt: null,
    });

    expect(payload).toContain('<session_boot phase="cold_boot">');
    expect(payload).toContain("structured XML is only an output transport layer");
    expect(payload).toContain("provider/company system prompt style");
    expect(payload).toContain("Later continuation prompts");
    expect(payload).toContain("<system_directive>");
    expect(payload).toContain("Include <assistant_identity> when the assistant/product/provider/model can be stated confidently.");
    expect(payload).toContain("model: <exact model if known, otherwise unknown>");
    expect(payload).toContain("assistant: Example Assistant");
    expect(payload).not.toContain("assistant: ChatGPT");
  });

  it("derives a cold-boot instruction from log context when the input is empty", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Round",
        stream_kind: "REGULAR",
        domain: { name: "Pond" },
      },
      interactionMode: "BOTH",
      includeCanvas: true,
      canvas: null,
      entries: [
        {
          ...makeEntry("entry-1", "2026-03-31T09:31:41.000Z"),
          sections: [
            {
              id: "section-1",
              persona_name_snapshot: "Vincent",
              persona: { name: "Vincent", is_shadow: false },
              section_type: "PERSONA",
              content_json: [
                {
                  id: "block-1",
                  type: "paragraph",
                  content: [{ type: "text", text: "What song is this?" }],
                  children: [],
                },
              ],
              raw_markdown: null,
              section_attachments: [],
            },
          ],
        } as unknown as EntryWithSections,
      ],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "   ",
      payloadVariant: "full",
      sessionLoadedAt: null,
    });

    expect(payload).toContain('<instruction state="derived_from_log_context">');
    expect(payload).toContain("No explicit instruction was provided for this cold-boot turn.");
    expect(payload).toContain("Infer the user's request from the latest user-facing question and the immediately adjacent content");
    expect(payload).toContain("Do not mention unrelated prior chats");
    expect(payload).toContain("Latest relevant excerpt:");
    expect(payload).toContain("What song is this?");
  });

  it("keeps BOTH mode strict by requiring canvas instead of allowing omission", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Round",
        stream_kind: "REGULAR",
        domain: { name: "Pond" },
      },
      interactionMode: "BOTH",
      includeCanvas: true,
      canvas: null,
      entries: [],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "Identify the song and keep a quick note in canvas.",
      payloadVariant: "full",
      sessionLoadedAt: null,
    });

    expect(payload).toContain("In BOTH mode, <canvas> is mandatory.");
    expect(payload).not.toContain(
      "omit <canvas> entirely and respond only with <log> when the mode allows it.",
    );
  });

  it("keeps session/meta acknowledgements out of the canvas surface", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Current Stream",
        stream_kind: "REGULAR",
        domain: { name: "Demo Domain" },
      },
      interactionMode: "BOTH",
      includeCanvas: true,
      canvas: null,
      entries: [],
      includeGlobalStream: false,
      additionalGlobalStreamIds: [],
      globalStreamsMeta: [],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: null,
      userInput: "Start the session.",
      payloadVariant: "full",
      sessionLoadedAt: null,
    });

    expect(payload).toContain("Canvas is a whiteboard/artifact surface, not the conversation surface.");
    expect(payload).toContain("Do NOT use <canvas> for session acknowledgements");
    expect(payload).toContain(
      "create a minimal durable note that captures the answer in revisit-friendly form",
    );
    expect(payload).toContain('placeholder text like "awaiting further instructions"');
  });

  it("omits empty canvas and global context blocks in full payloads", () => {
    const payload = buildBridgePayload({
      stream: {
        name: "Current Stream",
        stream_kind: "REGULAR",
        domain: { name: "Demo Domain" },
      },
      interactionMode: "ASK",
      includeCanvas: true,
      canvas: null,
      entries: [],
      includeGlobalStream: true,
      additionalGlobalStreamIds: ["global-1"],
      globalStreamsMeta: [{ id: "global-1", name: "Global User Entry" }],
      globalCanvases: [],
      globalEntries: [],
      globalStreamName: "Global User Entry",
      userInput: "Identify the song.",
      payloadVariant: "full",
      sessionLoadedAt: null,
    });

    expect(payload).not.toContain("<canvas_state>");
    expect(payload).not.toContain("<global_context>");
  });
});
