const GEMINI_APP_URL = "https://gemini.google.com/app";

export const LOGIN_REQUIRED_CODE = "LOGIN_REQUIRED";
export const SESSION_RESET_REQUIRED_CODE = "SESSION_RESET_REQUIRED";

const COMPOSER_SELECTORS = [
  'textarea',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][aria-label]',
  '[contenteditable="plaintext-only"]',
];

const RESPONSE_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-message-author-role="model"]',
  'model-response',
  '[data-response-id]',
  'article',
];

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isGeminiLoginRequired(page) {
  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
  if (!bodyText) return false;

  const looksLoggedOut =
    /sign in/i.test(bodyText) ||
    /log in/i.test(bodyText) ||
    /choose an account/i.test(bodyText);

  if (!looksLoggedOut) return false;

  const composer = await findComposer(page);
  return !composer;
}

export async function findComposer(page) {
  for (const selector of COMPOSER_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

export async function findSendButton(page) {
  const names = [/send/i, /submit/i];
  for (const name of names) {
    const locator = page.getByRole("button", { name }).last();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  const fallback = page.locator('button[aria-label*="send" i]').last();
  if (await fallback.isVisible().catch(() => false)) {
    return fallback;
  }

  return null;
}

export async function findCopyButton(page) {
  const names = [/copy/i];
  for (const name of names) {
    const locator = page.getByRole("button", { name }).last();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  const fallback = page.locator('button[aria-label*="copy" i]').last();
  if (await fallback.isVisible().catch(() => false)) {
    return fallback;
  }

  return null;
}

export async function ensureGeminiReady(page) {
  if (!page.url().startsWith("https://gemini.google.com")) {
    await page.goto(GEMINI_APP_URL, { waitUntil: "domcontentloaded" });
  }

  await page.waitForLoadState("domcontentloaded");
  await sleep(1200);

  if (await isGeminiLoginRequired(page)) {
    const error = new Error("Gemini login required");
    error.code = LOGIN_REQUIRED_CODE;
    throw error;
  }

  const composer = await findComposer(page);
  if (!composer) {
    const error = new Error("Gemini composer is not available");
    error.code = LOGIN_REQUIRED_CODE;
    throw error;
  }

  return composer;
}

export async function startFreshGeminiChat(page) {
  const newChat = page.getByRole("button", { name: /new chat/i }).first();
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click();
    await sleep(500);
    return;
  }

  await page.goto(GEMINI_APP_URL, { waitUntil: "domcontentloaded" });
  await sleep(700);
}

export async function submitGeminiPrompt(page, payload) {
  const composer = await ensureGeminiReady(page);

  await composer.click();
  await composer.fill("").catch(() => undefined);
  await composer.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+A`,
  ).catch(() => undefined);
  await composer.press("Backspace").catch(() => undefined);
  await page.keyboard.insertText(payload);

  const sendButton = await findSendButton(page);
  if (sendButton) {
    await sendButton.click();
    return;
  }

  await page.keyboard.press("Enter");
}

export async function extractLatestGeminiResponse(page) {
  return page.evaluate((selectors) => {
    const texts = [];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const text =
          (node instanceof HTMLElement ? node.innerText : node.textContent)?.trim();
        if (text) texts.push(text);
      }
      if (texts.length > 0) break;
    }

    return texts.at(-1) ?? "";
  }, RESPONSE_SELECTORS);
}

export async function extractLatestGeminiResponseViaCopy(page) {
  const copyButton = await findCopyButton(page);
  if (!copyButton) return "";

  const beforeCopy = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  });

  await copyButton.click();
  await sleep(250);

  const afterCopy = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  });

  if (!afterCopy.trim()) return "";
  if (afterCopy === beforeCopy && !afterCopy.includes("<response>")) {
    return "";
  }

  return afterCopy;
}

export async function isGeminiGenerating(page) {
  return page
    .getByRole("button", { name: /stop/i })
    .isVisible()
    .catch(() => false);
}

export async function waitForGeminiGenerationStart(page, initialResponse = "") {
  const started = Date.now();
  const initial = initialResponse.trim();

  while (Date.now() - started < 20_000) {
    if (await isGeminiLoginRequired(page)) {
      const error = new Error("Gemini login required");
      error.code = LOGIN_REQUIRED_CODE;
      throw error;
    }

    const generating = await isGeminiGenerating(page);
    const response = (await extractLatestGeminiResponse(page)).trim();

    if (generating) {
      return { sawGenerating: true, baselineResponse: response || initial };
    }

    if (response && response !== initial) {
      return { sawGenerating: false, baselineResponse: response };
    }

    await sleep(400);
  }

  return { sawGenerating: false, baselineResponse: initial };
}

export async function waitForGeminiResponse(page, initialResponse = "") {
  let stableCount = 0;
  let generatingSeen = false;
  let lastSeen = initialResponse.trim();
  let lastMeaningfulResponse = initialResponse.trim();
  const started = Date.now();

  const startState = await waitForGeminiGenerationStart(page, initialResponse);
  generatingSeen = startState.sawGenerating;
  lastSeen = startState.baselineResponse.trim() || lastSeen;
  lastMeaningfulResponse = lastSeen;

  while (Date.now() - started < 180_000) {
    if (await isGeminiLoginRequired(page)) {
      const error = new Error("Gemini login required");
      error.code = LOGIN_REQUIRED_CODE;
      throw error;
    }

    const stopButtonVisible = await isGeminiGenerating(page);
    const response = (await extractLatestGeminiResponse(page)).trim();
    const hasNewResponse = !!response && response !== initialResponse.trim();

    if (stopButtonVisible) {
      generatingSeen = true;
    }

    if (hasNewResponse) {
      lastMeaningfulResponse = response;
    }

    if (hasNewResponse) {
      if (
        response === lastSeen &&
        !stopButtonVisible &&
        (generatingSeen || response !== startState.baselineResponse.trim())
      ) {
        stableCount += 1;
        if (stableCount >= 3) {
          return lastMeaningfulResponse;
        }
      } else {
        stableCount = 0;
      }
      lastSeen = response;
    }

    await sleep(generatingSeen ? 1200 : 700);
  }

  throw new Error("Timed out waiting for Gemini response");
}

export async function getFinalGeminiResponse(page, fallbackResponse = "") {
  const copiedResponse = await extractLatestGeminiResponseViaCopy(page);
  if (copiedResponse.trim()) {
    return copiedResponse;
  }

  return fallbackResponse;
}

export async function runGeminiBridgeJob(page, job, sessionState) {
  if (
    job.payload_variant === "followup" &&
    sessionState.currentSessionKey &&
    sessionState.currentSessionKey !== job.session_key
  ) {
    const error = new Error("Follow-up job does not match the active Gemini session");
    error.code = SESSION_RESET_REQUIRED_CODE;
    throw error;
  }

  if (
    job.payload_variant === "full" &&
    sessionState.currentSessionKey &&
    sessionState.currentSessionKey !== job.session_key
  ) {
    await startFreshGeminiChat(page);
    sessionState.currentSessionKey = null;
  }

  const initialResponse = await extractLatestGeminiResponse(page);
  await submitGeminiPrompt(page, job.payload);
  const response = await waitForGeminiResponse(page, initialResponse);
  const finalResponse = await getFinalGeminiResponse(page, response);
  sessionState.currentSessionKey = job.session_key;

  return finalResponse;
}

export { GEMINI_APP_URL };
