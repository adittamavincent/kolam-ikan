import { z } from "zod";

export const FileUploadFormSchema = z.object({
  streamId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
});

export const CreateSectionFileAttachmentSchema = z.object({
  sectionId: z.string().uuid(),
  documentId: z.string().uuid(),
  sortOrder: z.number().int().min(0).optional(),
  titleSnapshot: z.string().trim().max(300).optional().nullable(),
  annotationText: z.string().trim().max(3000).optional().nullable(),
  referencedPersonaId: z.string().uuid().optional().nullable(),
  referencedPage: z.number().int().positive().optional().nullable(),
});

export const UpdateSectionFileAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
  updates: z.object({
    sort_order: z.number().int().min(0).optional(),
    title_snapshot: z.string().trim().max(300).optional().nullable(),
    annotation_text: z.string().trim().max(3000).optional().nullable(),
    referenced_persona_id: z.string().uuid().optional().nullable(),
    referenced_page: z.number().int().positive().optional().nullable(),
  }),
});

export const ReorderSectionFileAttachmentsSchema = z.object({
  sectionId: z.string().uuid(),
  orderedAttachmentIds: z.array(z.string().uuid()).min(1),
});

export const DeleteSectionFileAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
});
