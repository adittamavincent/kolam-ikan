import { describe, expect, it } from "vitest";
import {
  CreateSectionPdfAttachmentSchema,
  PdfUploadFormSchema,
  ReorderSectionPdfAttachmentsSchema,
} from "@/lib/validation/pdf";

describe("pdf validation", () => {
  it("accepts valid upload form payload", () => {
    const parsed = PdfUploadFormSchema.safeParse({
      streamId: "660e8400-e29b-41d4-a716-446655440000",
      title: "Meeting transcript",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid stream id in upload form", () => {
    const parsed = PdfUploadFormSchema.safeParse({
      streamId: "invalid",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts attachment creation payload with persona reference", () => {
    const parsed = CreateSectionPdfAttachmentSchema.safeParse({
      sectionId: "660e8400-e29b-41d4-a716-446655440000",
      documentId: "660e8400-e29b-41d4-a716-446655440001",
      annotationText: "Persona comments on methodology in this file",
      referencedPersonaId: "660e8400-e29b-41d4-a716-446655440002",
      referencedPage: 4,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects empty reorder payload", () => {
    const parsed = ReorderSectionPdfAttachmentsSchema.safeParse({
      sectionId: "660e8400-e29b-41d4-a716-446655440000",
      orderedAttachmentIds: [],
    });

    expect(parsed.success).toBe(false);
  });
});
