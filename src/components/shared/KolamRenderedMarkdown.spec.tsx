// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import KolamRenderedMarkdown from "./KolamRenderedMarkdown";

describe("KolamRenderedMarkdown", () => {
  it("renders ChatGPT contentReference citations as clickable internal links", () => {
    render(
      <KolamRenderedMarkdown source="Song by :contentReference[oaicite:0]{index=0}" />,
    );

    const link = screen.getByRole("link", { name: "1" });
    expect(link).toHaveAttribute("href", "#citation-1");
    expect(screen.getByText("OpenAI citation 1").closest("li")).toHaveAttribute(
      "id",
      "citation-1",
    );
  });

  it("keeps citation links clickable inside bold text", () => {
    render(
      <KolamRenderedMarkdown source="**Otro Atardecer by [1](#citation-1)**\n\n## Citations\n1. [Source title](https://example.com/source-1)" />,
    );

    const link = screen.getByRole("link", { name: "1" });
    expect(link).toHaveAttribute("href", "#citation-1");
  });

  it("keeps normal markdown hyperlinks clickable", () => {
    render(
      <KolamRenderedMarkdown source="[OpenAI](https://openai.com)" />,
    );

    expect(screen.getByRole("link", { name: "OpenAI" })).toHaveAttribute(
      "href",
      "https://openai.com",
    );
  });
});
