import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import { Fragment } from "react";
import { SectionWithPersona } from "@/lib/types";
import { BlockNoteEditor } from "@/components/shared/BlockNoteEditor";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { usePersonaMutations } from "@/lib/hooks/usePersonaMutations";
import { Check, FileText } from "lucide-react";
import { PartialBlock } from "@blocknote/core";
import { useMemo } from "react";
import { PdfAttachmentItem } from "./PdfAttachmentItem";

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
      SectionWithPersona["section_pdf_attachments"]
    >[number],
    tab: "pdf" | "parsed",
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
  const isPdfSection = section.section_type === "PDF";

  const currentPersona = section.persona;
  const displayName =
    section.persona_name_snapshot || currentPersona?.name || "Unknown";

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

  if (isPdfSection) {
    return (
      <div className="group relative flex gap-2 p-1.5 transition-all hover:bg-surface-hover/40  border border-border-subtle">
        <div className="shrink-0 pt-1">
          <div className="flex h-8 w-8 items-center justify-center  bg-surface-subtle text-text-subtle border border-border-subtle">
            <FileText className="h-4 w-4" />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-default">
              PDF Section
            </span>
            <span className="text-[10px] text-text-muted">
              •{" "}
              {section.updated_at
                ? new Date(section.updated_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </span>
          </div>

          <div className="space-y-1">
            {(section.section_pdf_attachments ?? []).map((attachment) => {
              const importStatus =
                attachment.document?.import_status ??
                attachment.document?.latestJob?.status ??
                null;
              const canOpenParsed =
                isParsedReadyStatus(importStatus) &&
                !!(attachment.document_id ?? attachment.document?.id);

              return (
                <PdfAttachmentItem
                  key={attachment.id}
                  keyId={attachment.id}
                  variant="log"
                  title={
                    attachment.title_snapshot ||
                    attachment.document?.title ||
                    "Attached PDF"
                  }
                  annotationText={attachment.annotation_text}
                  storagePath={attachment.document?.storage_path}
                  thumbnailPath={attachment.document?.thumbnail_path}
                  importStatus={importStatus}
                  progressPercent={
                    attachment.document?.latestJob?.progress_percent ?? 0
                  }
                  canOpenParsed={canOpenParsed}
                  onPreviewPdf={
                    onPreviewAttachment
                      ? () => onPreviewAttachment(attachment, "pdf")
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
            {(section.section_pdf_attachments ?? []).length === 0 && (
              <div className="text-[11px] text-text-muted">
                No PDF attachments in this section.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex gap-2 p-1.5 transition-all hover:bg-surface-hover/30 ">
      {/* Sidebar / Persona Indicator */}
      <div className="shrink-0 pt-1">
        <Menu as="div" className="relative">
          <MenuButton
            className="flex h-8 w-8 items-center justify-center  transition-all hover:scale-105 focus:outline-none"
            style={{
              backgroundColor: `${currentPersona?.color || "#94a3b8"}15`,
              color: currentPersona?.color || "#94a3b8",
            }}
            title={`Author: ${currentPersona?.name || "Unknown"}`}
          >
            <DynamicIcon
              name={currentPersona?.icon || "user"}
              className="h-4 w-4"
            />
          </MenuButton>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <MenuItems className="absolute left-0 top-full z-50 mt-1 max-h-60 w-56 overflow-auto  border border-border-default bg-surface-default p-1 ring-1 ring-black/5 focus:outline-none">
              <div className="px-2 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">
                Assign Persona
              </div>
              {globalPersonas.length > 0 && (
                <div className="px-2 py-1 text-[10px] font-semibold text-text-muted">
                  Global Personas
                </div>
              )}
              {globalPersonas.map((persona) => (
                <MenuItem key={persona.id}>
                  {({ focus }) => (
                    <button
                      onClick={() => handlePersonaSelect(persona.id)}
                      className={`${
                        focus
                          ? "bg-surface-subtle text-text-default"
                          : "text-text-subtle"
                      } group flex w-full items-center justify-between  px-2 py-1.5 text-xs transition-colors`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="flex h-5 w-5 items-center justify-center "
                          style={{
                            backgroundColor: `${persona.color}20`,
                            color: persona.color,
                          }}
                        >
                          <DynamicIcon
                            name={persona.icon}
                            className="h-3 w-3"
                          />
                        </div>
                        <span>{persona.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className=" border border-border-subtle bg-surface-subtle px-1.5 py-0.5 text-[10px] text-text-muted">
                          Global
                        </span>
                        {currentPersona?.id === persona.id && (
                          <Check className="h-3 w-3 text-action-primary-bg" />
                        )}
                      </div>
                    </button>
                  )}
                </MenuItem>
              ))}
              {shadowPersonas.length > 0 && (
                <div className="mt-1 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Shadow Personas
                </div>
              )}
              {shadowPersonas.map((persona) => (
                <MenuItem key={persona.id}>
                  {({ focus }) => (
                    <button
                      onClick={() => handlePersonaSelect(persona.id)}
                      className={`${
                        focus
                          ? "bg-surface-subtle text-text-default"
                          : "text-text-subtle"
                      } group flex w-full items-center justify-between  px-2 py-1.5 text-xs transition-colors`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="flex h-5 w-5 items-center justify-center  ring-1 ring-amber-500/40"
                          style={{
                            backgroundColor: `${persona.color}20`,
                            color: persona.color,
                          }}
                        >
                          <DynamicIcon
                            name={persona.icon}
                            className="h-3 w-3"
                          />
                        </div>
                        <span>{persona.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className=" border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                          Shadow
                        </span>
                        {currentPersona?.id === persona.id && (
                          <Check className="h-3 w-3 text-action-primary-bg" />
                        )}
                      </div>
                    </button>
                  )}
                </MenuItem>
              ))}
            </MenuItems>
          </Transition>
        </Menu>
      </div>

      {/* Content Area */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-default">
            {displayName}
          </span>
          {currentPersona && isShadowPersona(currentPersona) && (
            <span className=" border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              Shadow Persona
            </span>
          )}
          <span className="text-[10px] text-text-muted">
            •{" "}
            {section.updated_at
              ? new Date(section.updated_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""}
          </span>
        </div>

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
      </div>
    </div>
  );
}
