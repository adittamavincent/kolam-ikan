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

    expect(payload).toContain("<session_followup>");
    expect(payload).toContain("<incremental_context>");
    expect(payload).toContain("Canvas delta");
    expect(payload).toContain("Apply the new changes only.");
    expect(payload).not.toContain("<system_directive>");
  });
});
