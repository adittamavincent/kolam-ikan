import { SectionWithPersona } from "@/lib/types";
import { BlockNoteEditor } from "@/components/shared/BlockNoteEditor";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { usePersonaMutations } from "@/lib/hooks/usePersonaMutations";
import { PartialBlock } from "@blocknote/core";
import { useMemo } from "react";
import { SectionPreset } from "@/components/shared/SectionPreset";
import { PersonaItem } from "../../shared/PersonaItem";
import { FileAttachmentItem } from "./FileAttachmentItem";

function isShadowPersona(persona: { is_shadow?: boolean | null }): boolean {
  return persona.is_shadow === true;
}

function isParsedReadyStatus(status?: string | null): boolean {
  return status === "completed" || status === "done";
}

interface LogSectionProps {
  section: SectionWithPersona;
  streamId: string;
  highlightTerm?: string;
  editable?: boolean;
  onContentChange?: (content: PartialBlock[]) => void;
  onPreviewAttachment?: (
    attachment: NonNullable<
      SectionWithPersona["section_attachments"]
    >[number],
    tab: "file" | "parsed",
  ) => void;
}

export function LogSection({
  section,
  streamId,
  highlightTerm,
  editable = false,
  onContentChange,
  onPreviewAttachment,
}: LogSectionProps) {
  const { personas } = usePersonas({ streamId, includeShadow: true });
  const { updateSectionPersona } = usePersonaMutations();

  // Prefer the resolved persona from global list; if missing, fall back to
  // the persona object returned on the section or the persona name snapshot
  // so that system / AI-created entries still display a sensible label.
  const resolvedPersona = personas?.find((p) => p.id === section.persona?.id) || section.persona;

  const currentPersona =
    resolvedPersona ||
    (section.persona_name_snapshot
      ? {
          id: `snapshot-${section.id}`,
          user_id: null,
          type: "AI",
          name: section.persona_name_snapshot,
          icon: "FileText",
          color: "#9CA3AF",
          is_system: false,
          // Provide fields expected by consumers of the Persona type
          deleted_at: null,
          is_shadow: false,
          shadow_document_id: null,
          shadow_stream_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : null);

  // Handle persona change
  const handlePersonaSelect = (personaId: string) => {
    if (currentPersona?.id === personaId) return;
    updateSectionPersona.mutate({
      sectionId: section.id,
      personaId,
    });
  };

  const trimmedContent = useMemo(() => {
    const blocks = (section.content_json as unknown as PartialBlock[]) ?? [];
    if (!Array.isArray(blocks) || blocks.length === 0) return [];

    const trimmableTypes = new Set([
      "paragraph",
      "heading",
      "quote",
      "bulletListItem",
      "numberedListItem",
      "checkListItem",
      "toggleListItem",
    ]);

    const hasMeaningfulInlineContent = (content: unknown): boolean => {
      if (typeof content === "string") return content.trim().length > 0;
      if (!Array.isArray(content)) return false;

      return content.some((item) => {
        if (!item || typeof item !== "object") return false;
        const typedItem = item as { type?: unknown; text?: unknown };

        if (typedItem.type === "text") {
          return (
            typeof typedItem.text === "string" &&
            typedItem.text.trim().length > 0
          );
        }

        // Non-text inline nodes (mentions, links, etc.) count as meaningful.
        return true;
      });
    };

    const isBlockEmpty = (block: PartialBlock | undefined): boolean => {
      if (!block || typeof block !== "object") return true;

      const blockType = (block as { type?: unknown }).type;
      if (typeof blockType !== "string" || !trimmableTypes.has(blockType))
        return false;

      const blockContent = (block as { content?: unknown }).content;
      const children = (block as { children?: PartialBlock[] }).children;
      const hasNonEmptyChild =
        Array.isArray(children) &&
        children.some((child) => !isBlockEmpty(child));

      return !hasMeaningfulInlineContent(blockContent) && !hasNonEmptyChild;
    };

    let start = 0;
    let end = blocks.length - 1;

    while (start <= end && isBlockEmpty(blocks[start])) start += 1;
    while (end >= start && isBlockEmpty(blocks[end])) end -= 1;

    if (start > end) return [];
    return blocks.slice(start, end + 1);
  }, [section.content_json]);

  const editableContent = useMemo(() => {
    const blocks = (section.content_json as unknown as PartialBlock[]) ?? [];
    return Array.isArray(blocks) ? blocks : [];
  }, [section.content_json]);

  const globalPersonas = useMemo(
    () => (personas ?? []).filter((persona) => !isShadowPersona(persona)),
    [personas],
  );

  const shadowPersonas = useMemo(
    () => (personas ?? []).filter((persona) => isShadowPersona(persona)),
    [personas],
  );
  const attachments = section.section_attachments ?? [];
  const hasAttachments = attachments.length > 0;
  const shouldShowEditor =
    section.section_type !== "FILE_ATTACHMENT" || editableContent.length > 0;
  const showEmptyAttachmentsNotice =
    section.section_type === "FILE_ATTACHMENT" && !hasAttachments;

  return (
    <SectionPreset
      persona={currentPersona || null}
      isAttachment={section.section_type === "FILE_ATTACHMENT"}
      className="flex flex-col group relative transition-all"
      centerHeader={
        <PersonaItem
          persona={currentPersona ?? null}
          menuProps={{
            currentPersona: currentPersona || null,
            isAttachment: section.section_type === "FILE_ATTACHMENT",
            filePersonaName: section.persona_name_snapshot ?? undefined,
            globalPersonas: globalPersonas,
            shadowPersonas: shadowPersonas,
            onSelect: handlePersonaSelect,
            readOnly: !editable,
          }}
        />
      }
      rightHeader={
        <span className="text-[10px] text-text-muted">
          {section.updated_at
            ? new Date(section.updated_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""}
        </span>
      }
      contentClassName="px-4"
    >
      <div className="min-w-0 flex-1 py-1">
        {shouldShowEditor && (
          <div
            className={`${editable ? "blocknote-editable" : "blocknote-readonly"} prose prose-sm dark:prose-invert max-w-none`}
          >
            <BlockNoteEditor
              key={
                editable
                  ? `editable-${section.id}`
                  : `readonly-${section.id}-${section.updated_at ?? "na"}`
              }
              initialContent={editable ? editableContent : trimmedContent}
              editable={editable}
              onChange={editable ? onContentChange : undefined}
              highlightTerm={editable ? undefined : highlightTerm}
            />
          </div>
        )}

        {hasAttachments && (
          <div className="space-y-1">
            {attachments.map((attachment) => {
              const importStatus =
                attachment.document?.import_status ??
                attachment.document?.latestJob?.status ??
                null;
              const canOpenParsed =
                isParsedReadyStatus(importStatus) &&
                !!(attachment.document_id ?? attachment.document?.id);

              return (
                <FileAttachmentItem
                  key={attachment.id}
                  keyId={attachment.id}
                  variant="log"
                  title={
                    attachment.title_snapshot ||
                    attachment.document?.title ||
                    "File Attachment"
                  }
                  annotationText={attachment.annotation_text}
                  documentId={attachment.document_id ?? attachment.document?.id ?? null}
                  storagePath={attachment.document?.storage_path}
                  thumbnailPath={attachment.document?.thumbnail_path}
                  thumbnailStatus={attachment.document?.thumbnail_status ?? null}
                  importStatus={importStatus}
                  progressPercent={
                    attachment.document?.latestJob?.progress_percent ?? 0
                  }
                  canOpenParsed={canOpenParsed}
                  onPreviewFile={
                    onPreviewAttachment
                      ? () => onPreviewAttachment(attachment, "file")
                      : undefined
                  }
                  onPreviewParsed={
                    onPreviewAttachment
                      ? () => onPreviewAttachment(attachment, "parsed")
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {showEmptyAttachmentsNotice && (
          <div className="text-[11px] text-text-muted">
            No file attachments in this section.
          </div>
        )}
      </div>
    </SectionPreset>
  );
}
