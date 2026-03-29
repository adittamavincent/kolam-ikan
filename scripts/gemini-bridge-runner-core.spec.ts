import { describe, expect, it } from "vitest";
import {
  extractLatestGeminiResponseViaCopy,
  getFinalGeminiResponse,
  LOGIN_REQUIRED_CODE,
  SESSION_RESET_REQUIRED_CODE,
  runGeminiBridgeJob,
  submitGeminiPrompt,
  waitForGeminiGenerationStart,
  waitForGeminiResponse,
} from "./gemini-bridge-runner-core.mjs";

function createFakePage(options: {
  bodyText?: string;
  hasComposer?: boolean;
  stopVisible?: boolean[];
  responses?: string[];
}) {
  let responseIndex = 0;
  let insertedText = "";
  let clipboardText = options.responses?.[0] ?? "";
  const stopSteps = options.stopVisible ?? [false];
  const responses = options.responses ?? [""];

  return {
    url: () => "https://gemini.google.com/app",
    goto: async () => undefined,
    waitForLoadState: async () => undefined,
    keyboard: {
      insertText: async (value: string) => {
        insertedText = value;
      },
      press: async () => undefined,
    },
    locator(selector: string) {
      if (selector === "body") {
        return {
          innerText: async () => options.bodyText ?? "",
          first() {
            return this;
          },
          isVisible: async () => false,
        };
      }

      if (selector === "textarea") {
        return {
          first() {
            return this;
          },
          isVisible: async () => options.hasComposer ?? true,
          click: async () => undefined,
          fill: async () => undefined,
          press: async () => undefined,
          evaluate: async () => true,
        };
      }

      if (selector === 'button[aria-label*="copy" i]') {
        return {
          last() {
            return this;
          },
          isVisible: async () => true,
          click: async () => {
            clipboardText = "<response>\nline one\n**bold**\n</response>";
          },
        };
      }

      return {
        first() {
          return this;
        },
        last() {
          return this;
        },
        isVisible: async () => false,
      };
    },
    getByRole(_role: string, { name }: { name: RegExp }) {
      return {
        first() {
          return this;
        },
        last() {
          return this;
        },
        isVisible: async () => {
          if (/stop/i.test(String(name))) {
            const step = Math.min(responseIndex, stopSteps.length - 1);
            return stopSteps[step];
          }
          if (/copy/i.test(String(name))) {
            return true;
          }
          return /send/i.test(String(name));
        },
        click: async () => {
          if (/copy/i.test(String(name))) {
            clipboardText = "<response>\nline one\n**bold**\n</response>";
          }
        },
      };
    },
    evaluate: async (callback: unknown) => {
      const source = String(callback);
      if (source.includes("navigator.clipboard.readText")) {
        return clipboardText;
      }

      const step = Math.min(responseIndex, responses.length - 1);
      const value = responses[step];
      responseIndex += 1;
      return value;
    },
    __getInsertedText: () => insertedText,
  };
}

describe("gemini bridge runner core", () => {
  it("inserts the whole prompt as text before sending", async () => {
    const page = createFakePage({});

    await submitGeminiPrompt(page, "line one\nline two\nline three");

    expect(page.__getInsertedText()).toBe("line one\nline two\nline three");
  });

  it("waits for Gemini to enter generating state when stop appears", async () => {
    const page = createFakePage({
      responses: ["", "", "Draft"],
      stopVisible: [false, true, true],
    });

    await expect(waitForGeminiGenerationStart(page, "")).resolves.toMatchObject({
      sawGenerating: true,
    });
  });

  it("waits for a stable response", async () => {
    const page = createFakePage({
      responses: ["", "", "Draft", "Draft", "Draft", "Draft"],
      stopVisible: [true, true, false, false, false, false],
    });

    await expect(waitForGeminiResponse(page, "")).resolves.toBe("Draft");
  });

  it("prefers Gemini's copied response when available", async () => {
    const page = createFakePage({
      responses: ["flat response"],
    });

    await expect(extractLatestGeminiResponseViaCopy(page)).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
    await expect(getFinalGeminiResponse(page, "flat response")).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
  });

  it("fails follow-up jobs when the session key drifts", async () => {
    const page = createFakePage({
      responses: ["", "Answer", "Answer", "Answer"],
    });

    await expect(
      runGeminiBridgeJob(
        page,
        {
          payload_variant: "followup",
          session_key: "gemini:stream-2",
          payload: "<bridge />",
        },
        { currentSessionKey: "gemini:stream-1" },
      ),
    ).rejects.toMatchObject({ code: SESSION_RESET_REQUIRED_CODE });
  });

  it("surfaces login-required pages", async () => {
    const page = createFakePage({
      bodyText: "Sign in to continue",
      hasComposer: false,
    });

    await expect(waitForGeminiResponse(page, "")).rejects.toMatchObject({
      code: LOGIN_REQUIRED_CODE,
    });
  });
});
