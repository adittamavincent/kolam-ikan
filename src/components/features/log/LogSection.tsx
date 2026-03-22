import { SectionWithPersona } from "@/lib/types";
import { BlockNoteEditor } from "@/components/shared/BlockNoteEditor";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { usePersonaMutations } from "@/lib/hooks/usePersonaMutations";
import { PartialBlock } from "@blocknote/core";
import { useMemo } from "react";
import { SectionPreset } from "@/components/shared/SectionPreset";
import { PersonaItem } from "../../shared/PersonaItem";
import { FileAttachmentItem } from "./FileAttachmentItem";
import { FileText, Paperclip } from "lucide-react";

function isLocalPersona(persona: { is_shadow?: boolean | null }): boolean {
  return persona.is_shadow === true;
}

function isParsedReadyStatus(status?: string | null): boolean {
  return status === "completed" || status === "done";
}

interface LogSectionProps {
  section: SectionWithPersona;
  streamId: string;
  sectionIndex?: number;
  highlightTerm?: string;
  editable?: boolean;
  currentEditedContent?: PartialBlock[];
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
  sectionIndex = 0,
  highlightTerm,
  editable = false,
  currentEditedContent,
  onContentChange,
  onPreviewAttachment,
}: LogSectionProps) {
  const { personas } = usePersonas({ streamId, includeLocal: true });
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
    () => (personas ?? []).filter((persona) => !isLocalPersona(persona)),
    [personas],
  );

  const localPersonas = useMemo(
    () => (personas ?? []).filter((persona) => isLocalPersona(persona)),
    [personas],
  );
  const attachments = section.section_attachments ?? [];
  const hasAttachments = attachments.length > 0;
  const shouldShowEditor =
    section.section_type !== "FILE_ATTACHMENT" || editableContent.length > 0;
  const showEmptyAttachmentsNotice =
    section.section_type === "FILE_ATTACHMENT" && !hasAttachments;
  const isAttachmentSection = section.section_type === "FILE_ATTACHMENT";
  const sectionLabel = isAttachmentSection ? "Attachment" : "Message";
  const SectionIcon = isAttachmentSection ? Paperclip : FileText;

  return (
    <SectionPreset
      persona={currentPersona || null}
      isAttachment={isAttachmentSection}
      className="flex flex-col"
      headerClassName="bg-surface-subtle/55"
      bodyClassName="bg-surface-default/55"
      centerHeader={
        <PersonaItem
          persona={currentPersona ?? null}
          menuProps={{
            currentPersona: currentPersona || null,
            isAttachment: isAttachmentSection,
            filePersonaName: section.persona_name_snapshot ?? undefined,
            globalPersonas: globalPersonas,
            localPersonas: localPersonas,
            onSelect: handlePersonaSelect,
            readOnly: !editable,
          }}
        />
      }
      leftHeader={
        <div className="inline-flex items-center gap-1 border border-border-default/55 bg-surface-default/80 px-1 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-text-muted">
          <span className="text-text-default/80">S{sectionIndex + 1}</span>
          <span className="h-px w-1.5 bg-border-strong" />
          <SectionIcon className="h-3 w-3" />
          <span>{sectionLabel}</span>
        </div>
      }
      rightHeader={
        <span className="border border-border-default/45 bg-surface-default/75 px-1 py-0.5 text-[10px] text-text-muted">
          {section.updated_at
            ? new Date(section.updated_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""}
        </span>
      }
      contentClassName="space-y-1"
    >
      <div className="min-w-0 flex-1 space-y-1">
        {shouldShowEditor && (
          <div
            className={`section-editor-surface ${editable ? "blocknote-editable" : "blocknote-readonly"} prose prose-sm max-w-none dark:prose-invert`}
          >
            <BlockNoteEditor
              key={
                editable
                  ? `editable-${section.id}`
                  : `readonly-${section.id}-${section.updated_at ?? "na"}`
              }
              initialContent={editable ? (currentEditedContent ?? editableContent) : trimmedContent}
              editable={editable}
              onChange={editable ? onContentChange : undefined}
              highlightTerm={editable ? undefined : highlightTerm}
            />
          </div>
        )}

        {hasAttachments && (
          <div className="space-y-1.5">
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
          <div className="border border-dashed border-border-default/55 bg-surface-default/60 px-2 py-1.5 text-[11px] text-text-muted">
            No file attachments in this section.
          </div>
        )}
      </div>
    </SectionPreset>
  );
}
