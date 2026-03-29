"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  MarkdownBlock,
  EntryWithSections,
  STREAM_KIND,
} from "@/lib/types";
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

  const payload = useMemo(
    () =>
      buildBridgePayload({
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
      }),
    [
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
};

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
}: BuildBridgePayloadArgs) {
  if (payloadVariant === "followup") {
    return buildBridgeFollowupPayload({
      stream,
      interactionMode,
      userInput,
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

  return `<system_directive>
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

<instruction>
${userInput}
</instruction>`;
}

function buildBridgeFollowupPayload({
  stream,
  interactionMode,
  userInput,
}: Pick<BuildBridgePayloadArgs, "stream" | "interactionMode" | "userInput">) {
  const domainName = (stream?.domain as { name?: string } | undefined)?.name || "";
  const isGlobal = stream?.stream_kind === STREAM_KIND.GLOBAL;

  return `<session_followup>
Continue the active Kolam Ikan bridge session that is already loaded in this provider conversation.
Reuse the original bridge rules, response XML format, and parsing contract from the earlier full payload.
Only respond to this incremental follow-up.

Target: ${interactionMode}
Stream: ${(stream?.name as string | undefined) || ""} ${isGlobal ? "(Global)" : ""}
Domain: ${domainName}
</session_followup>

<incremental_instruction>
${userInput}
</incremental_instruction>`;
}

export function canvasToMarkdown(blocks: MarkdownBlock[]): string {
  return blocks.map(blockToMarkdown).join("\n\n");
}

function blockToMarkdown(block: MarkdownBlock): string {
  if (block.type === "heading") {
    const level = (block.props?.level as number) || 1;
    return `${"#".repeat(level)} ${extractText(block)}`;
  }
  if (block.type === "paragraph") {
    return extractText(block);
  }
  return extractText(block);
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
  const askCore = `You MUST include a <thought_log> tag containing your analysis, reasoning, or answer.
This content will be saved as a new entry (log item) in the stream's left pillar.

Write in natural prose. Separate paragraphs with blank lines.
Each double-newline-separated paragraph becomes a distinct block in the entry.`;

  const canvasRules = canvasIsEmpty
    ? `The canvas is currently EMPTY. You are creating fresh content from scratch.
Format the content as a unified diff (like \`git diff\`) where every line is a new addition.
Every single line inside <canvas_update> MUST start with \`+ \` (plus, then a space), then the content.
This includes headings, bullets, numbered lists, and blank lines — EVERYTHING.
A blank line is represented as: \`+ \` (plus, then a single space, nothing after).
Do NOT use \`*\`, \`#\`, or \`-\` as the first character of a line. ALWAYS prefix with \`+ \`.

\`\`\`diff
+ # My Title
+ 
+ ## Section One
+ - First item
+ - Second item
+ 
+ Some paragraph text here.
\`\`\`

Wrap the above inside <canvas_update>...</canvas_update> (no \`\`\`diff fences inside the tag).`
    : `The canvas has existing content. Use unified diff format (like \`git diff\` / \`diff -u\`) to describe your changes.
Every line inside <canvas_update> MUST start with one of:
- \`+ \` (plus, space) — add this line
- \`- \` (minus, space) — remove this line
- \` \` (single space) — unchanged context line (use sparingly for clarity)

Do NOT use \`*\` as a line prefix. This is NOT markdown — it is a strict git-style unified diff.

\`\`\`diff
- # Old Title
+ # Updated Title
 
+ ## New Section
+ - Added item
- - Removed item
\`\`\`

Wrap the above inside <canvas_update>...</canvas_update> (no \`\`\`diff fences inside the tag).`;

  const goCore = `You MUST include a <canvas_update> tag using unified diff format (git diff style).

${canvasRules}

${canvasUpdatedAt ? `<canvas_base_updated_at>${canvasUpdatedAt}</canvas_base_updated_at>\nEcho this exact <canvas_base_updated_at> value back in your response for conflict detection.` : ""}

CRITICAL FORMATTING RULES:
- Every line inside <canvas_update> MUST begin with \`+ \`, \`- \`, or \` \` (space). NO EXCEPTIONS.
- Do NOT write raw markdown lines. Do NOT start lines directly with \`#\`, \`*\`, or \`-\`.
- A heading: \`+ # My Heading\` — a bullet: \`+ - item\` — a blank line: \`+ \`
- If any line is missing the \`+\`/\`-\`/\` \` prefix, YOUR RESPONSE WILL BE REJECTED.`;

  const askDirective = `<response_format_ask>
${askCore}

Do NOT include any canvas-related tags.

Example response:
<response>
<thought_log>
Your analysis paragraph one goes here.

Another paragraph with further reasoning.
</thought_log>
</response>
</response_format_ask>`;

  const goDirective = `<response_format_go>
${goCore}

Do NOT include any thought_log tags in GO mode.

Example response:
<response>
<canvas_update>
+ # Example Title
+ 
+ - Example bullet
</canvas_update>
${canvasUpdatedAt ? `<canvas_base_updated_at>${canvasUpdatedAt}</canvas_base_updated_at>` : ""}
</response>
</response_format_go>`;

  const bothDirective = `<response_format_both>
${askCore}

${goCore}

Example response:
<response>
<thought_log>
Your reasoning goes here.
</thought_log>
<canvas_update>
+ # Title
+ 
+ ## Section
+ - Task one
+ - Task two
</canvas_update>
${canvasUpdatedAt ? `<canvas_base_updated_at>${canvasUpdatedAt}</canvas_base_updated_at>` : ""}
</response>
</response_format_both>`;

  const modeDirectives: Record<string, string> = {
    ASK: askDirective,
    GO: goDirective,
    BOTH: bothDirective,
  };

  return `<response_instructions>
You are an AI assistant integrated into a structured knowledge management system called "Kolam Ikan".
Your response MUST be wrapped in a <response> root tag and follow the structured output format below exactly.
Do NOT output any text outside the <response> tags. The system parses your XML response programmatically.

The user's interaction mode is: ${mode}
${mode === "ASK" ? "- ASK mode: Generate a thought log entry only (left pillar / log)." : ""}${mode === "GO" ? "- GO mode: Generate a canvas update only (right pillar / canvas)." : ""}${mode === "BOTH" ? "- BOTH mode: Generate both a thought log entry AND a canvas update." : ""}

${modeDirectives[mode] || modeDirectives.ASK}
</response_instructions>`;
}
