import { describe, expect, it } from "vitest";
import {
  resolveDocumentImportCompatibility,
  stripImportFileExtension,
} from "./importCompatibility";

describe("importCompatibility", () => {
  it("infers image support from file extension when the browser omits the MIME type", () => {
    expect(
      resolveDocumentImportCompatibility({
        fileName: "receipt.jpg",
        contentType: "",
      }),
    ).toMatchObject({
      supported: true,
      kind: "image",
      contentType: "image/jpeg",
    });
  });

  it("keeps common media attachments on the Docling path", () => {
    expect(
      resolveDocumentImportCompatibility({
        fileName: "voice-note.m4a",
        contentType: "audio/x-m4a",
      }),
    ).toMatchObject({
      supported: true,
      kind: "media",
      contentType: "audio/mp4",
    });
  });

  it("rejects unsupported binary attachments", () => {
    expect(
      resolveDocumentImportCompatibility({
        fileName: "archive.zip",
        contentType: "application/zip",
      }),
    ).toMatchObject({
      supported: false,
      kind: "unknown",
      contentType: "application/zip",
    });
  });

  it("derives titles by stripping the final extension instead of only .pdf", () => {
    expect(stripImportFileExtension("meeting-photo.jpeg")).toBe(
      "meeting-photo",
    );
    expect(stripImportFileExtension("quarterly.report.v2.docx")).toBe(
      "quarterly.report.v2",
    );
  });
});
