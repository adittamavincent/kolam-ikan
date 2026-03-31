"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  MarkdownBlock,
  EntryWithSections,
  STREAM_KIND,
} from "@/lib/types";
import { blocksToStoredMarkdown } from "@/lib/content-protocol";
import type { BridgePayloadVariant } from "./bridge-config";

interface UseBridgePayloadOptions {
  streamId: string;
  interactionMode: string;
  selectedEntries: string[];
  includeCanvas: boolean;
  includeGlobalStream: boolean;
  globalStreamIds: string[];
  globalStreamName: string | null;
  userInput: string;
  payloadVariant?: BridgePayloadVariant;
  sessionLoadedAt?: string | null;
  onPayloadGenerated?: (payload: string) => void;
}

export function useBridgePayload({
  streamId,
  interactionMode,
  selectedEntries,
  includeCanvas,
  includeGlobalStream,
  globalStreamIds,
  globalStreamName,
  userInput,
  payloadVariant = "full",
  sessionLoadedAt,
  onPayloadGenerated,
}: UseBridgePayloadOptions) {
  const supabase = createClient();

  const { data: stream } = useQuery({
    queryKey: ["stream", streamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("streams")
        .select("*, domain:domains(*)")
        .eq("id", streamId)
        .single();
      return data;
    },
  });

  const { data: entries } = useQuery({
    queryKey: ["entries-xml", streamId, selectedEntries],
    queryFn: async () => {
      const { data } = await supabase
        .from("entries")
        .select(
          "*, sections(*, persona:personas(*), section_attachments(*, document:documents(*)))",
        )
        .in("id", selectedEntries)
        .order("created_at", { ascending: true });
      return data as unknown as EntryWithSections[];
    },
    enabled: selectedEntries.length > 0,
  });

  const { data: canvas } = useQuery({
    queryKey: ["canvas", streamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("canvases")
        .select("*")
        .eq("stream_id", streamId)
        .single();
      return data;
    },
    enabled: includeCanvas,
  });

  const additionalGlobalStreamIds = useMemo(
    () => (globalStreamIds ?? []).filter((id) => id !== streamId),
    [globalStreamIds, streamId],
  );

  const { data: globalStreamsMeta } = useQuery({
    queryKey: ["global-streams-meta-xml", additionalGlobalStreamIds],
    queryFn: async () => {
      if (additionalGlobalStreamIds.length === 0) return [];
      const { data } = await supabase
        .from("streams")
        .select("id, name")
        .in("id", additionalGlobalStreamIds);
      return data ?? [];
    },
    enabled: additionalGlobalStreamIds.length > 0,
  });

  const { data: globalEntries } = useQuery({
    queryKey: [
      "global-entries-xml",
      additionalGlobalStreamIds,
      includeGlobalStream,
    ],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0) return [];
      const { data } = await supabase
        .from("entries")
        .select(
          "*, sections(*, persona:personas(*), section_attachments(*, document:documents(*)))",
        )
        .in("stream_id", additionalGlobalStreamIds)
        .eq("is_draft", false)
        .order("created_at", { ascending: true });
      return data as unknown as EntryWithSections[];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const { data: globalCanvases } = useQuery({
    queryKey: [
      "global-canvas-xml",
      additionalGlobalStreamIds,
      includeGlobalStream,
    ],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0) return [];
      const { data } = await supabase
        .from("canvases")
        .select("*")
        .in("stream_id", additionalGlobalStreamIds);
      return data ?? [];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const incrementalContext = useMemo(
    () =>
      selectIncrementalBridgeContext({
        payloadVariant,
        sessionLoadedAt,
        entries,
        canvas,
        globalEntries,
        globalCanvases,
      }),
    [canvas, entries, globalCanvases, globalEntries, payloadVariant, sessionLoadedAt],
  );

  const payload = useMemo(
    () =>
      buildBridgePayload({
        stream,
        interactionMode,
        includeCanvas,
        canvas: incrementalContext.canvas,
        entries: incrementalContext.entries,
        includeGlobalStream,
        additionalGlobalStreamIds,
        globalStreamsMeta,
        globalCanvases: incrementalContext.globalCanvases,
        globalEntries: incrementalContext.globalEntries,
        globalStreamName,
        userInput,
        payloadVariant,
        sessionLoadedAt,
      }),
    [
      stream,
      interactionMode,
      includeCanvas,
      incrementalContext.canvas,
      incrementalContext.entries,
      includeGlobalStream,
      additionalGlobalStreamIds,
      globalStreamsMeta,
      incrementalContext.globalCanvases,
      incrementalContext.globalEntries,
      globalStreamName,
      userInput,
      payloadVariant,
      sessionLoadedAt,
    ],
  );

  useEffect(() => {
    onPayloadGenerated?.(payload);
  }, [payload, onPayloadGenerated]);

  const isReady =
    !!stream &&
    (!includeCanvas || canvas !== undefined) &&
    (selectedEntries.length === 0 || entries !== undefined);

  return {
    payload,
    isReady,
  };
}

type BuildBridgePayloadArgs = {
  stream: Record<string, unknown> | null | undefined;
  interactionMode: string;
  includeCanvas: boolean;
  canvas: Record<string, unknown> | null | undefined;
  entries: EntryWithSections[] | undefined;
  includeGlobalStream: boolean;
  additionalGlobalStreamIds: string[];
  globalStreamsMeta: Array<{ id: string; name: string | null }> | undefined;
  globalCanvases: Array<Record<string, unknown>> | undefined;
  globalEntries: EntryWithSections[] | undefined;
  globalStreamName: string | null;
  userInput: string;
  payloadVariant: BridgePayloadVariant;
  sessionLoadedAt?: string | null;
};

type IncrementalBridgeContextArgs = {
  payloadVariant: BridgePayloadVariant;
  sessionLoadedAt?: string | null;
  entries: EntryWithSections[] | undefined;
  canvas: Record<string, unknown> | null | undefined;
  globalEntries: EntryWithSections[] | undefined;
  globalCanvases: Array<Record<string, unknown>> | undefined;
};

function buildColdBootInstruction(
  userInput: string,
  entries: EntryWithSections[] | undefined,
) {
  const trimmed = userInput.trim();
  if (trimmed) {
    return `<instruction state="provided">
${trimmed}
</instruction>`;
  }

  const latestEntry = [...(entries ?? [])].reverse().find((entry) =>
    entry.sections.some((section) => {
      const raw = typeof section.raw_markdown === "string" ? section.raw_markdown.trim() : "";
      const content = canvasToMarkdown(
        (section.content_json as unknown as MarkdownBlock[] | undefined) || [],
      ).trim();
      return Boolean(raw || content);
    }),
  );

  const latestSectionText = latestEntry?.sections
    .map((section) => {
      const raw = typeof section.raw_markdown === "string" ? section.raw_markdown.trim() : "";
      const content = canvasToMarkdown(
        (section.content_json as unknown as MarkdownBlock[] | undefined) || [],
      ).trim();
      return raw || content;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return `<instruction state="derived_from_log_context">
No explicit instruction was provided for this cold-boot turn.
Infer the user's request from the most recent relevant content in <log_context>.
Respond only to the request supported by the supplied stream/global context.
Do not mention unrelated prior chats, saved memory, project names, or preferences unless they appear in this payload.
${latestSectionText ? `Latest relevant content:\n${latestSectionText}` : ""}
</instruction>`;
}

function hasTimestampAfter(
  value: string | null | undefined,
  thresholdMs: number | null,
) {
  if (thresholdMs === null || !value) return true;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > thresholdMs;
}

export function selectIncrementalBridgeContext({
  payloadVariant,
  sessionLoadedAt,
  entries,
  canvas,
  globalEntries,
  globalCanvases,
}: IncrementalBridgeContextArgs) {
  if (payloadVariant !== "followup") {
    return {
      entries,
      canvas,
      globalEntries,
      globalCanvases,
    };
  }

  const sessionLoadedAtMs = sessionLoadedAt ? Date.parse(sessionLoadedAt) : Number.NaN;
  const thresholdMs = Number.isFinite(sessionLoadedAtMs) ? sessionLoadedAtMs : null;

  return {
    entries: (entries ?? []).filter((entry) =>
      hasTimestampAfter(entry.created_at, thresholdMs),
    ),
    canvas:
      canvas && hasTimestampAfter(canvas.updated_at as string | undefined, thresholdMs)
        ? canvas
        : null,
    globalEntries: (globalEntries ?? []).filter((entry) =>
      hasTimestampAfter(entry.created_at, thresholdMs),
    ),
    globalCanvases: (globalCanvases ?? []).filter((item) =>
      hasTimestampAfter(item.updated_at as string | undefined, thresholdMs),
    ),
  };
}

export function buildBridgePayload({
  stream,
  interactionMode,
  includeCanvas,
  canvas,
  entries,
  includeGlobalStream,
  additionalGlobalStreamIds,
  globalStreamsMeta,
  globalCanvases,
  globalEntries,
  globalStreamName,
  userInput,
  payloadVariant,
  sessionLoadedAt,
}: BuildBridgePayloadArgs) {
  if (payloadVariant === "followup") {
    return buildBridgeFollowupPayload({
      stream,
      interactionMode,
      canvas,
      entries,
      includeGlobalStream,
      globalCanvases,
      globalEntries,
      globalStreamName,
      userInput,
      sessionLoadedAt,
    });
  }

  const domainName = (stream?.domain as { name?: string } | undefined)?.name || "";
  const isGlobal = stream?.stream_kind === STREAM_KIND.GLOBAL;
  const streamNameById = new Map(
    (globalStreamsMeta ?? []).map((globalStream) => [
      globalStream.id,
      globalStream.name || globalStream.id,
    ]),
  );
  const canvasUpdatedAt = canvas?.updated_at as string | undefined;
  const canvasContent = (canvas?.content_json as MarkdownBlock[] | undefined) || [];
  const canvasIsEmpty =
    canvasContent.length === 0 || canvasContent.every((block) => !extractText(block).trim());

  const responseFormatDirective = buildResponseDirective(
    interactionMode,
    canvasUpdatedAt,
    canvasIsEmpty,
  );

  const allFiles: { id: string; name: string; content: string }[] = [];
  const collectFiles = (items: EntryWithSections[] | undefined) => {
    if (!items) return;
    items.forEach((entry) => {
      entry.sections.forEach((section) => {
        section.section_attachments?.forEach((attachment) => {
          if (attachment.document && !allFiles.some((file) => file.id === attachment.document!.id)) {
            allFiles.push({
              id: attachment.document.id,
              name: attachment.document.original_filename,
              content: attachment.document.extracted_markdown || "[No content extracted]",
            });
          }
        });
      });
    });
  };

  collectFiles(entries);
  if (includeGlobalStream) collectFiles(globalEntries);

  const filesStr =
    allFiles.length > 0
      ? `<attached_files>\n${allFiles
          .map(
            (file) =>
              `<file id="${file.id}" name="${file.name}">\n${file.content}\n</file>`,
          )
          .join("\n\n")}\n</attached_files>\n\n`
      : "";
  const instructionSection = buildColdBootInstruction(userInput, entries);

  return `<session_boot phase="cold_boot">
This is the cold-boot prompt for a fresh Kolam Ikan bridge session.
Treat this first user message as the full session introduction, source-of-truth context, and response contract for the rest of this provider conversation.
Your structured XML is only an output transport layer. Keep using your normal assistant behavior, your provider/company system prompt style, and your best response quality inside the tags you return.
Do not let the XML wrapper make the answer stiff, robotic, or less helpful.
Later continuation prompts in this same conversation may send only changed context and a diff-style instruction instead of repeating everything.
</session_boot>

<system_directive>
Target: ${interactionMode}
Stream: ${(stream?.name as string | undefined) || ""} ${isGlobal ? "(Global)" : ""}
Domain: ${domainName}

${responseFormatDirective}
</system_directive>

${filesStr}${
    includeCanvas
      ? `<canvas_state>
${canvasToMarkdown(canvasContent)}
</canvas_state>`
      : ""
  }

<log_context>
${entries?.map((entry) => entryToMarkdown(entry)).join("\n\n") || ""}
</log_context>

${
  includeGlobalStream && additionalGlobalStreamIds.length > 0
    ? `<global_context>
${globalStreamName || "Domain Global Streams"}

<global_canvases>
${(globalCanvases ?? [])
  .map((canvasItem) => {
    const streamId = canvasItem.stream_id as string;
    const streamName = streamNameById.get(streamId) || streamId;
    return `<global_canvas stream="${streamName}">
${canvasToMarkdown((canvasItem.content_json as MarkdownBlock[] | undefined) || [])}
</global_canvas>`;
  })
  .join("\n\n")}
</global_canvases>

<global_entries>
${
  globalEntries
    ?.map((entry) => {
      const streamName = streamNameById.get(entry.stream_id) || entry.stream_id;
      return `<global_entry stream="${streamName}">
${entryToMarkdown(entry)}
</global_entry>`;
    })
    .join("\n\n") || ""
}
</global_entries>
</global_context>`
    : ""
}

${instructionSection}`;
}

function buildBridgeFollowupPayload({
  stream,
  interactionMode,
  canvas,
  entries,
  includeGlobalStream,
  globalCanvases,
  globalEntries,
  globalStreamName,
  userInput,
  sessionLoadedAt,
}: Pick<
  BuildBridgePayloadArgs,
  | "stream"
  | "interactionMode"
  | "canvas"
  | "entries"
  | "includeGlobalStream"
  | "globalCanvases"
  | "globalEntries"
  | "globalStreamName"
  | "userInput"
  | "sessionLoadedAt"
>) {
  const domainName = (stream?.domain as { name?: string } | undefined)?.name || "";
  const isGlobal = stream?.stream_kind === STREAM_KIND.GLOBAL;
  const sessionWindow = sessionLoadedAt?.trim() || "unknown";
  const canvasContent = (canvas?.content_json as MarkdownBlock[] | undefined) || [];
  const hasCanvasChanges =
    Array.isArray(canvasContent) && canvasContent.length > 0;
  const hasEntryChanges = (entries?.length ?? 0) > 0;
  const hasGlobalChanges =
    includeGlobalStream &&
    ((globalEntries?.length ?? 0) > 0 || (globalCanvases?.length ?? 0) > 0);
  const trimmedInstruction = userInput.trim();

  const incrementalSections = [
    hasCanvasChanges
      ? `<changed_canvas>
${canvasToMarkdown(canvasContent)}
</changed_canvas>`
      : "",
    hasEntryChanges
      ? `<changed_entries>
${entries?.map((entry) => entryToMarkdown(entry)).join("\n\n") || ""}
</changed_entries>`
      : "",
    hasGlobalChanges
      ? `<changed_global_context>
${globalStreamName || "Domain Global Streams"}

<global_canvases>
${(globalCanvases ?? [])
  .map((canvasItem) => {
    const streamLabel = (canvasItem.stream_id as string | undefined) || "unknown";
    return `<global_canvas stream="${streamLabel}">
${canvasToMarkdown((canvasItem.content_json as MarkdownBlock[] | undefined) || [])}
</global_canvas>`;
  })
  .join("\n\n")}
</global_canvases>

<global_entries>
${globalEntries?.map((entry) => entryToMarkdown(entry)).join("\n\n") || ""}
</global_entries>
</changed_global_context>`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const incrementalInstructionSection = trimmedInstruction
    ? `<incremental_instruction state="provided">
${trimmedInstruction}
</incremental_instruction>`
    : `<incremental_instruction state="empty">
No new user instruction was provided for this continue turn.
Do not invent new recommendations, extra analysis, or adjacent ideas.
Only reflect the delta contained in <incremental_context>.
</incremental_instruction>`;

  return `<session_followup phase="continue">
Continue the active Kolam Ikan bridge session that is already loaded in this provider conversation.
The earlier cold-boot prompt already established the full session context, response XML contract, and baseline rules.
This continuation message is only a diff/update packet, not a brand-new session introduction.
Keep using your normal assistant behavior and provider/company system prompt style inside the structured XML you return.
Use the prior session context together with the changed context below, and focus only on what has changed or what this new instruction asks.

Target: ${interactionMode}
Stream: ${(stream?.name as string | undefined) || ""} ${isGlobal ? "(Global)" : ""}
Domain: ${domainName}
Session window start: ${sessionWindow}
</session_followup>

<continue_response_rules>
Use the same XML wrapper and parser contract from the cold-boot turn.
For <log>: always return a concise append-ready log entry for this turn. Do not rewrite or summarize prior log entries, and do not add generic greetings, confirmations, or filler. Keep it to the new delta only.
For <canvas>: return only a unified git-style diff patch against the already-loaded canvas in this provider conversation. Never restate the full canvas. Remove old lines with \`- \`, add new lines with \`+ \`, and include unchanged context lines with a single leading space only when needed for orientation.
Treat <changed_canvas> as a reference snapshot of the new desired state, not as an output template. Use it to compute the diff against the previously loaded canvas, then output only the patch lines.
Treat <incremental_context> as delta-only context. It may overlap with earlier session memory, so do not echo it back wholesale.
If <incremental_instruction> is empty, do not invent recommendations or tangential additions. Mirror only the supplied delta.

Example continue response:
<response>
<log>
Updated the track identification and canvas notes for this turn.
</log>
<canvas>
- # Track Profile: "San Juan"
+ # Track Profile: "En Casita"
  ## Context & Significance
- **Themes:** Nostalgia, appreciation for Puerto Rico, and the feeling of home.
+ **Themes:** Home, longing, and the simple beauty of Puerto Rico.
</canvas>
<base>${(canvas?.updated_at as string | undefined) || "BASE_TIMESTAMP_FROM_COLD_BOOT"}</base>
</response>
</continue_response_rules>

<incremental_context>
${incrementalSections || "No new stream, canvas, or global-context changes were detected since the active session started."}
</incremental_context>

${incrementalInstructionSection}`;
}

export function canvasToMarkdown(blocks: MarkdownBlock[]): string {
  return blocksToStoredMarkdown(blocks);
}

function extractText(block: MarkdownBlock): string {
  return block.content?.map((content) => content.text).join("") || "";
}

export function entryToMarkdown(entry: EntryWithSections): string {
  const dateStr = entry.created_at ? new Date(entry.created_at).toLocaleString() : "";

  let result = `<entry id="${entry.id}" date="${dateStr}">\n`;
  result += "<sections>\n";

  entry.sections.forEach((section) => {
    const personaName = section.persona_name_snapshot || section.persona?.name || "User";
    const isLocal = section.persona?.is_shadow ? "true" : "false";
    const sectionType = section.section_type || "text";

    let content = canvasToMarkdown(
      (section.content_json as unknown as MarkdownBlock[] | undefined) || [],
    );
    if (!content.trim() && typeof section.raw_markdown === "string") {
      content = section.raw_markdown;
    }

    if (section.section_attachments && section.section_attachments.length > 0) {
      const links = section.section_attachments
        .map((attachment) => `[File: ${attachment.document?.original_filename}](#${attachment.document?.id})`)
        .join("\n");
      content = content.trim() ? `${content}\n\n${links}` : links;
    }

    result += `<section persona="${personaName}" local="${isLocal}" type="${sectionType}">\n${content}\n</section>\n`;
  });

  result += "</sections>\n</entry>";

  return result;
}

export function buildResponseDirective(
  mode: string,
  canvasUpdatedAt?: string,
  canvasIsEmpty?: boolean,
) {
  const askCore = `Use <log>...</log> for the log entry.
Write natural prose with blank lines between paragraphs.
Return only the final answer text inside <log>.

If you cite web sources, use parser-friendly citations:
- Inline references inside <log> or <canvas>: use markdown links like \`[1](#citation-1)\`, \`[2](#citation-2)\`
- Put the source list in an optional <citations>...</citations> block
- Inside <citations>, use a numbered markdown list, one source per line, for example:
  \`1. [Source title](https://example.com/source-1)\`
  \`2. [Another source](https://example.com/source-2)\`
- Citation numbers must match the inline references exactly
- Do not use \`:contentReference[oaicite:...]\`, footnotes, or bare URLs in prose`;

  const canvasRules = canvasIsEmpty
    ? `Canvas is empty. Use <canvas>...</canvas>.
Inside <canvas>, every line must start with \`+ \`.
Blank line: \`+ \`.`
    : `Canvas has content. Use <canvas>...</canvas> as unified diff.
Every line inside <canvas> must start with one of:
- \`+ \` (plus, space) — add this line
- \`- \` (minus, space) — remove this line
- \` \` (single space) — unchanged context line (use sparingly for clarity)
Do not use code fences.`;

  const allowCanvasOmission = mode !== "BOTH";
  const goCore = `Use <canvas>...</canvas>.

${canvasRules}

${canvasUpdatedAt ? `Also echo <base>${canvasUpdatedAt}</base> exactly.` : ""}

Canvas is a whiteboard/artifact surface, not the conversation surface.
Only put durable working content in <canvas>: plans, outlines, checklists, notes, drafts, specifications, or other reference material the user would want to revisit visually.
Do NOT use <canvas> for session acknowledgements, boot/init messages, meta-instructions, status banners, "ready" messages, summaries of the protocol, or placeholder text like "awaiting further instructions".
${allowCanvasOmission
    ? "If the user has not asked for any actual whiteboard/artifact content yet, omit <canvas> entirely and respond only with <log> when the mode allows it."
    : "In BOTH mode, <canvas> is mandatory. If the user did not explicitly ask for whiteboard content, create a minimal durable note that captures the answer in revisit-friendly form instead of omitting <canvas>."}
Do not write raw markdown lines outside the diff prefixes.`;

  const askDirective = `<response_format_ask>
${askCore}

Do NOT include any canvas-related tags.

Example response:
<response>
<log>
Your analysis paragraph one goes here [1](#citation-1).

Another paragraph with further reasoning.
</log>
<citations>
1. [Source title](https://example.com/source-1)
</citations>
</response>
</response_format_ask>`;

  const goDirective = `<response_format_go>
${goCore}

Do NOT include any log tags in GO mode.

Example response:
<response>
<canvas>
+ # Example Title
+ 
+ - Example bullet [1](#citation-1)
</canvas>
<citations>
1. [Source title](https://example.com/source-1)
</citations>
${canvasUpdatedAt ? `<base>${canvasUpdatedAt}</base>` : ""}
</response>
</response_format_go>`;

  const bothDirective = `<response_format_both>
${askCore}

${goCore}

BOTH mode is strict:
- <log> is required
- <canvas> is required
- Before sending, self-check that both tags are present and non-empty inside one <response> wrapper
- If either tag is missing, rewrite your answer before sending it

Example response:
<response>
<log>
Your reasoning goes here [1](#citation-1).
</log>
<canvas>
+ # Title
+ 
+ ## Section
+ - Task one
+ - Task two [1](#citation-1)
</canvas>
<citations>
1. [Source title](https://example.com/source-1)
</citations>
${canvasUpdatedAt ? `<base>${canvasUpdatedAt}</base>` : ""}
</response>
</response_format_both>`;

  const modeDirectives: Record<string, string> = {
    ASK: askDirective,
    GO: goDirective,
    BOTH: bothDirective,
  };

  return `<response_instructions>
Return XML only. No code fences. No text outside <response>.
Preferred tags: <log>, <canvas>, <citations>, <base>.
Legacy tags still work, but prefer the short tags to save tokens.
This structure is for machine parsing only. Inside those tags, write with your normal high-quality assistant voice and reasoning style.
Follow the provider's existing system prompt quality bar; the XML wrapper does not replace it.

The user's interaction mode is: ${mode}
${mode === "ASK" ? "- ASK mode: Generate a thought log entry only (left pillar / log)." : ""}${mode === "GO" ? "- GO mode: Generate a canvas update only (right pillar / canvas)." : ""}${mode === "BOTH" ? "- BOTH mode: Generate both a thought log entry AND a canvas update." : ""}

${modeDirectives[mode] || modeDirectives.ASK}
</response_instructions>`;
}
