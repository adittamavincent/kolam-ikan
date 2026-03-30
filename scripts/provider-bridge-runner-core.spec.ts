import { describe, expect, it } from "vitest";
import {
  extractLatestProviderResponseViaCopy,
  getFinalProviderResponse,
  LOGIN_REQUIRED_CODE,
  SESSION_RESET_REQUIRED_CODE,
  runBridgeJob,
  submitProviderPrompt,
  waitForProviderGenerationStart,
  waitForProviderResponse,
} from "./provider-bridge-runner-core.mjs";

function createFakePage(options: {
  bodyText?: string;
  hasComposer?: boolean;
  stopVisible?: boolean[];
  responses?: string[];
  copyVisible?: boolean;
  copyVisibleAfterHover?: boolean;
  copyVisibleAfterChecks?: number;
  copyVisibleAsFirstResponseAction?: boolean;
  copyVisibleViaClaudeActionBarSelector?: boolean;
  initialClipboardText?: string;
  copiedClipboardText?: string;
  clipboardSettlesAfterReads?: number;
}) {
  let responseIndex = 0;
  let insertedText = "";
  let clipboardText =
    options.initialClipboardText ?? options.responses?.[0] ?? "";
  const copiedClipboardText =
    options.copiedClipboardText ?? "<response>\nline one\n**bold**\n</response>";
  let copyHovered = false;
  let copyVisibilityChecks = 0;
  let pendingClipboardText: string | null = null;
  let pendingClipboardReadsRemaining = 0;
  const stopSteps = options.stopVisible ?? [false];
  const responses = options.responses ?? [""];

  const readClipboard = () => {
    if (pendingClipboardText !== null) {
      if (pendingClipboardReadsRemaining <= 0) {
        clipboardText = pendingClipboardText;
        pendingClipboardText = null;
      } else {
        pendingClipboardReadsRemaining -= 1;
      }
    }

    return clipboardText;
  };

  const triggerCopy = () => {
    if ((options.clipboardSettlesAfterReads ?? 0) > 0) {
      pendingClipboardText = copiedClipboardText;
      pendingClipboardReadsRemaining = options.clipboardSettlesAfterReads ?? 0;
      return;
    }

    clipboardText = copiedClipboardText;
  };

  const isCopyVisible = () => {
    if (options.copyVisibleAfterHover) {
      return copyHovered;
    }

    if (typeof options.copyVisibleAfterChecks === "number") {
      copyVisibilityChecks += 1;
      return copyVisibilityChecks > options.copyVisibleAfterChecks;
    }

    return options.copyVisible ?? true;
  };

  const createCopyActionLocator = () => ({
    first() {
      return this;
    },
    last() {
      return this;
    },
    isVisible: async () => isCopyVisible(),
    click: async () => {
      triggerCopy();
    },
  });

  const createResponseLocator = () => ({
    first() {
      return this;
    },
    last() {
      return this;
    },
    isVisible: async () => true,
    hover: async () => {
      copyHovered = true;
    },
    locator(selector: string) {
      if (
        options.copyVisibleAsFirstResponseAction &&
        selector === 'button, [role="button"]'
      ) {
        return createCopyActionLocator();
      }

      if (
        options.copyVisibleViaClaudeActionBarSelector &&
        (selector ===
          'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]' ||
          selector ===
            'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[aria-label="Copy"]' ||
          selector ===
            '[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]')
      ) {
        return createCopyActionLocator();
      }

      if (selector === 'button[aria-label*="copy response" i]') {
        if (options.copyVisibleAsFirstResponseAction) {
          return {
            first() {
              return this;
            },
            last() {
              return this;
            },
            isVisible: async () => false,
          };
        }
        return createCopyActionLocator();
      }

      if (selector === 'button[aria-label*="copy" i]') {
        if (options.copyVisibleAsFirstResponseAction) {
          return {
            first() {
              return this;
            },
            last() {
              return this;
            },
            isVisible: async () => false,
          };
        }
        return createCopyActionLocator();
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
      if (/copy/i.test(String(name)) && options.copyVisibleAsFirstResponseAction) {
        return {
          first() {
            return this;
          },
          last() {
            return this;
          },
          isVisible: async () => false,
          click: async () => undefined,
        };
      }

      return createCopyActionLocator();
    },
  });

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

      if (
        selector === 'div[data-is-streaming]' ||
        selector === '[data-testid*="assistant"]' ||
        selector === '[data-testid*="message-content"]' ||
        selector === "article"
      ) {
        return createResponseLocator();
      }

      if (
        options.copyVisibleViaClaudeActionBarSelector &&
        (selector ===
          'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]' ||
          selector ===
            'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[aria-label="Copy"]' ||
          selector ===
            '[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]')
      ) {
        return createCopyActionLocator();
      }

      if (selector === 'button[aria-label*="copy" i]') {
        if (
          options.copyVisibleAsFirstResponseAction ||
          options.copyVisibleViaClaudeActionBarSelector
        ) {
          return {
            last() {
              return this;
            },
            isVisible: async () => false,
            click: async () => undefined,
          };
        }
        return {
          last() {
            return this;
          },
          isVisible: async () => isCopyVisible(),
          click: async () => {
            triggerCopy();
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
            if (options.copyVisibleAsFirstResponseAction) {
              return false;
            }
            if (options.copyVisibleViaClaudeActionBarSelector) {
              return false;
            }
            return isCopyVisible();
          }
          return /send/i.test(String(name));
        },
        click: async () => {
          if (/copy/i.test(String(name))) {
            triggerCopy();
          }
        },
      };
    },
    evaluate: async (callback: unknown) => {
      const source = String(callback);
      if (source.includes("navigator.clipboard.readText")) {
        return readClipboard();
      }

      const step = Math.min(responseIndex, responses.length - 1);
      const value = responses[step];
      responseIndex += 1;
      return value;
    },
    __getInsertedText: () => insertedText,
  };
}

describe("provider bridge runner core", () => {
  it("inserts the whole prompt as text before sending", async () => {
    const page = createFakePage({});

    await submitProviderPrompt(page, "gemini", "line one\nline two\nline three");

    expect(page.__getInsertedText()).toBe("line one\nline two\nline three");
  });

  it("waits for the provider to enter generating state when stop appears", async () => {
    const page = createFakePage({
      responses: ["", "", "Draft"],
      stopVisible: [false, true, true],
    });

    await expect(waitForProviderGenerationStart(page, "gemini", "")).resolves.toMatchObject({
      sawGenerating: true,
    });
  });

  it("waits for a stable response", async () => {
    const page = createFakePage({
      responses: ["", "", "Draft", "Draft", "Draft", "Draft"],
      stopVisible: [true, true, false, false, false, false],
    });

    await expect(waitForProviderResponse(page, "gemini", "")).resolves.toBe("Draft");
  });

  it("returns as soon as the provider is done and the response is copyable", async () => {
    const page = createFakePage({
      responses: ["", "Draft", "Draft", "Draft"],
      stopVisible: [true, false, false, false],
    });

    await expect(waitForProviderResponse(page, "gemini", "")).resolves.toBe("Draft");
  });

  it("treats Claude toolbar text as non-meaningful when settling the response", async () => {
    const page = createFakePage({
      responses: [
        "",
        "Draft",
        "Draft Copy response",
        "Draft Copy response Retry",
        "Draft Copy response",
      ],
      stopVisible: [true, false, false, false, false],
      copyVisible: false,
    });

    await expect(waitForProviderResponse(page, "claude", "")).resolves.toContain("Draft");
  });

  it(
    "eventually returns Claude's last response even without a visible copy action",
    async () => {
      const page = createFakePage({
        responses: [
          "",
          "Draft",
          "Draft extended",
          "Draft extended with more detail",
          "Draft extended with more detail and ending",
          "Draft extended with more detail and ending plus footer",
        ],
        stopVisible: [true, false, false, false, false, false],
        copyVisible: false,
      });

      await expect(waitForProviderResponse(page, "claude", "")).resolves.toContain(
        "Draft extended with more detail and ending",
      );
    },
    8_000,
  );

  it("prefers the provider's copied response when available", async () => {
    const page = createFakePage({
      responses: ["flat response"],
    });

    await expect(extractLatestProviderResponseViaCopy(page, "gemini")).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
    await expect(getFinalProviderResponse(page, "gemini", "flat response")).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
  });

  it("reveals Claude's copy action by hovering the latest response", async () => {
    const page = createFakePage({
      responses: ["flat response"],
      copyVisible: false,
      copyVisibleAfterHover: true,
    });

    await expect(extractLatestProviderResponseViaCopy(page, "claude")).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
  });

  it("accepts Claude copied output when clipboard text is unchanged but matches the final response", async () => {
    const page = createFakePage({
      responses: ["Markdown final answer"],
      initialClipboardText: "Markdown final answer",
      copiedClipboardText: "Markdown final answer",
    });

    await expect(
      extractLatestProviderResponseViaCopy(
        page,
        "claude",
        "Markdown final answer",
      ),
    ).resolves.toBe("Markdown final answer");
  });

  it("waits for Claude's clipboard write to settle after clicking copy", async () => {
    const page = createFakePage({
      responses: ["Markdown final answer"],
      initialClipboardText: "clipboard before copy",
      copiedClipboardText: "<response>\nsettled copy\n</response>",
      clipboardSettlesAfterReads: 3,
    });

    await expect(extractLatestProviderResponseViaCopy(page, "claude")).resolves.toBe(
      "<response>\nsettled copy\n</response>",
    );
  });

  it("keeps retrying Claude copy when the action appears late after completion", async () => {
    const page = createFakePage({
      responses: ["Markdown final answer"],
      copyVisibleAfterChecks: 5,
    });

    await expect(getFinalProviderResponse(page, "claude", "Markdown final answer")).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
  });

  it("falls back to Claude's first visible response action when the copy button is unlabeled", async () => {
    const page = createFakePage({
      responses: ["Markdown final answer"],
      copyVisibleAsFirstResponseAction: true,
    });

    await expect(extractLatestProviderResponseViaCopy(page, "claude")).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
  });

  it("finds Claude's copy button via the exact action-bar test id selector", async () => {
    const page = createFakePage({
      responses: ["Markdown final answer"],
      copyVisibleViaClaudeActionBarSelector: true,
    });

    await expect(extractLatestProviderResponseViaCopy(page, "claude")).resolves.toBe(
      "<response>\nline one\n**bold**\n</response>",
    );
  });

  it("fails follow-up jobs when the session key drifts", async () => {
    const page = createFakePage({
      responses: ["", "Answer", "Answer", "Answer"],
    });

    await expect(
      runBridgeJob(
        page,
        {
          provider: "gemini",
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

    await expect(waitForProviderResponse(page, "gemini", "")).rejects.toMatchObject({
      code: LOGIN_REQUIRED_CODE,
    });
  });
});
