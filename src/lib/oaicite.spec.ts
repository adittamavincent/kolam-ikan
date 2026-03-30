import { describe, expect, it } from "vitest";

import {
  extractOaiCitations,
  normalizeOaiCitationsInMarkdown,
  replaceOaiCitationTokens,
} from "./oaicite";

describe("oaicite helpers", () => {
  it("extracts unique citations from ChatGPT contentReference tokens", () => {
    const citations = extractOaiCitations(
      "Alpha :contentReference[oaicite:0]{index=0} beta :contentReference[oaicite:1]{index=1} gamma :contentReference[oaicite:0]{index=0}",
    );

    expect(citations).toEqual([
      {
        id: "citation-1",
        index: 0,
        label: "1",
        target: "#citation-1",
      },
      {
        id: "citation-2",
        index: 1,
        label: "2",
        target: "#citation-2",
      },
    ]);
  });

  it("replaces contentReference tokens with internal markdown links", () => {
    expect(
      replaceOaiCitationTokens(
        "by :contentReference[oaicite:0]{index=0} & :contentReference[oaicite:1]{index=1}",
      ),
    ).toBe("by [1](#citation-1) & [2](#citation-2)");
  });

  it("appends a citations section when markdown includes oaicite tokens", () => {
    expect(
      normalizeOaiCitationsInMarkdown(
        "That is the song :contentReference[oaicite:0]{index=0}.",
      ),
    ).toBe(
      "That is the song [1](#citation-1).\n\n## Citations\n1. OpenAI citation 1",
    );
  });
});
