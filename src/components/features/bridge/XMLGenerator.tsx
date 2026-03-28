"use client";

import { Copy, Check } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  MarkdownBlock,
  EntryWithSections,
  STREAM_KIND,
} from "@/lib/types";

interface XMLGeneratorProps {
  streamId: string;
  interactionMode: string;
  selectedEntries: string[];
  includeCanvas: boolean;
  includeGlobalStream: boolean;
  globalStreamIds: string[];
  globalStreamName: string | null;
  userInput: string;
  onXMLGenerated?: (xml: string) => void;
}

export function XMLGenerator({
  streamId,
  interactionMode,
  selectedEntries,
  includeCanvas,
  includeGlobalStream,
  globalStreamIds,
  globalStreamName,
  userInput,
  onXMLGenerated,
}: XMLGeneratorProps) {
  const [copied, setCopied] = useState(false);
  const supabase = createClient();

  // Fetch data
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
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0)
        return [];
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
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0)
        return [];
      const { data } = await supabase
        .from("canvases")
        .select("*")
        .in("stream_id", additionalGlobalStreamIds);
      return data ?? [];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const currentXML = useMemo(() => {
    const domainName = stream?.domain?.name || "";
    const isGlobal = stream?.stream_kind === STREAM_KIND.GLOBAL;
    const streamNameById = new Map(
      (globalStreamsMeta ?? []).map((globalStream) => [
        globalStream.id,
        globalStream.name || globalStream.id,
      ]),
    );
    const canvasUpdatedAt = (canvas as Record<string, unknown>)?.updated_at as
      | string
      | undefined;
    const canvasContent =
      (canvas?.content_json as unknown as MarkdownBlock[]) || [];
    const canvasIsEmpty =
      canvasContent.length === 0 ||
      canvasContent.every((b) => !extractText(b).trim());

    const responseFormatDirective = buildResponseDirective(
      interactionMode,
      canvasUpdatedAt,
      canvasIsEmpty,
    );

    // Extract files from entries to be shown at the top
    const allFiles: { id: string; name: string; content: string }[] = [];
    const collectFiles = (ents: EntryWithSections[] | undefined) => {
      if (!ents) return;
      ents.forEach((entry) => {
        entry.sections.forEach((section) => {
          if (section.section_attachments) {
            section.section_attachments.forEach((att) => {
              if (att.document && !allFiles.some((f) => f.id === att.document!.id)) {
                allFiles.push({
                  id: att.document.id,
                  name: att.document.original_filename,
                  content:
                    att.document.extracted_markdown || "[No content extracted]",
                });
              }
            });
          }
        });
      });
    };

    collectFiles(entries as unknown as EntryWithSections[]);
    if (includeGlobalStream) {
      collectFiles(globalEntries as unknown as EntryWithSections[]);
    }

    const filesStr =
      allFiles.length > 0
        ? `<attached_files>\n${allFiles
            .map(
              (f) =>
                `<file id="${f.id}" name="${f.name}">\n${f.content}\n</file>`,
            )
            .join("\n\n")}\n</attached_files>\n\n`
        : "";

    return `<system_directive>
Target: ${interactionMode}
Stream: ${stream?.name || ""} ${isGlobal ? "(Global)" : ""}
Domain: ${domainName}

${responseFormatDirective}
</system_directive>

${filesStr}${
  includeCanvas
    ? `<canvas_state>
${canvasToMarkdown((canvas?.content_json as unknown as MarkdownBlock[]) || [])}
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
    const streamName =
      streamNameById.get(canvasItem.stream_id) || canvasItem.stream_id;
    return `<global_canvas stream="${streamName}">
${canvasToMarkdown((canvasItem.content_json as unknown as MarkdownBlock[]) || [])}
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
  }, [
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
  ]);

  useEffect(() => {
    onXMLGenerated?.(currentXML);
  }, [currentXML, onXMLGenerated]);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(currentXML);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-6 space-y-3">
      <div>
        <label className="text-sm font-semibold text-text-default">
          Generated Bridge Payload
        </label>
        <p className="text-xs text-text-muted mt-0.5 mb-2">
          Review and copy this payload to your model before generating a
          response.
        </p>
      </div>

      <div className="relative group border border-border-default bg-[#0d1117] overflow-hidden">
        <textarea
          readOnly
          rows={6}
          value={currentXML}
          className="w-full bg-transparent p-4 font-mono text-[13px] leading-relaxed text-[#c9d1d9] resize-y min-h-35"
        />
        <div className="absolute top-2 right-2">
          <button
            onClick={copyToClipboard}
            className={`flex items-center gap-1.5  px-3 py-1.5 text-xs font-semibold backdrop-blur-md transition-all ${
              copied
                ? "bg-status-success-bg text-status-success-text border border-status-success-bg"
                : "bg-white/10 text-white border border-white/20 hover:bg-white/20 opacity-0 group-hover:opacity-100"
            }`}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper functions
function canvasToMarkdown(blocks: MarkdownBlock[]): string {
  // Convert markdown blocks to markdown text.
  return blocks.map(blockToMarkdown).join("\n\n");
}

function blockToMarkdown(block: MarkdownBlock): string {
  // Implementation depends on block type
  if (block.type === "heading") {
    const level = (block.props?.level as number) || 1;
    return "#".repeat(level) + " " + extractText(block);
  }
  if (block.type === "paragraph") {
    return extractText(block);
  }
  // ... handle other types
  return extractText(block);
}

function extractText(block: MarkdownBlock): string {
  return block.content?.map((c) => c.text).join("") || "";
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
    const isLocal = section.persona?.is_shadow ? "true" : "false";
    const sectionType = section.section_type || "text";

    let content = canvasToMarkdown(
      (section.content_json as unknown as MarkdownBlock[]) || []
    );

    if (
      section.section_attachments &&
      section.section_attachments.length > 0
    ) {
      const links = section.section_attachments
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

    result += `<section persona="${personaName}" local="${isLocal}" type="${sectionType}">\n${content}\n</section>\n`;
  });

  result += `</sections>\n</entry>`;

  return result;
}

function buildResponseDirective(
  mode: string,
  canvasUpdatedAt?: string,
  canvasIsEmpty?: boolean,
): string {
  // --- Shared core blocks ---

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

  // --- Directives composed from shared cores ---

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

${modeDirectives[mode] || modeDirectives["ASK"]}
</response_instructions>`;
}
