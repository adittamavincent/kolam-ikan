const PROVIDER_RUNNER_CONFIGS = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    appUrl: "https://chatgpt.com/",
    origin: "https://chatgpt.com",
    composerSelectors: [
      'textarea',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="plaintext-only"]',
    ],
    responseSelectors: [
      '[data-message-author-role="assistant"]',
      'article',
      '[data-testid*="conversation-turn"]',
    ],
    newChatButtonNames: [/new chat/i],
    stopButtonNames: [/stop/i],
    sendButtonNames: [/send/i, /submit/i],
    copyButtonNames: [/copy/i],
    loginPatterns: [/log in/i, /sign up/i, /continue with/i],
    modelPickerNames: [/gpt/i, /chatgpt/i, /model/i],
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    appUrl: "https://gemini.google.com/app",
    origin: "https://gemini.google.com",
    composerSelectors: [
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-label]',
      '[contenteditable="plaintext-only"]',
    ],
    responseSelectors: [
      '[data-message-author-role="assistant"]',
      '[data-message-author-role="model"]',
      'model-response',
      '[data-response-id]',
      'article',
    ],
    newChatButtonNames: [/new chat/i],
    stopButtonNames: [/stop/i],
    sendButtonNames: [/send/i, /submit/i],
    copyButtonNames: [/copy/i],
    loginPatterns: [/sign in/i, /log in/i, /choose an account/i],
    modelPickerNames: [/gemini/i, /flash/i, /pro/i, /model/i],
  },
  claude: {
    id: "claude",
    label: "Claude",
    appUrl: "https://claude.ai/chats",
    origin: "https://claude.ai",
    composerSelectors: [
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-is-streaming]',
      '[contenteditable="plaintext-only"]',
    ],
    responseSelectors: [
      '[data-testid*="assistant"]',
      '[data-testid*="message-content"]',
      'article',
    ],
    newChatButtonNames: [/new chat/i, /start new/i],
    stopButtonNames: [/stop/i],
    sendButtonNames: [/send/i],
    copyButtonNames: [/copy/i],
    loginPatterns: [/log in/i, /sign in/i, /continue with/i],
    modelPickerNames: [/claude/i, /sonnet/i, /haiku/i, /opus/i, /model/i],
  },
};

export const DEFAULT_BRIDGE_RUNNER_PROVIDERS = Object.freeze(
  Object.keys(PROVIDER_RUNNER_CONFIGS),
);
export const LOGIN_REQUIRED_CODE = "LOGIN_REQUIRED";
export const SESSION_RESET_REQUIRED_CODE = "SESSION_RESET_REQUIRED";
export const GEMINI_APP_URL = PROVIDER_RUNNER_CONFIGS.gemini.appUrl;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getProviderConfig(provider) {
  const config = PROVIDER_RUNNER_CONFIGS[provider];
  if (!config) {
    throw new Error(`Unsupported bridge provider: ${provider}`);
  }
  return config;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getEnvDefaultModel(provider) {
  const providerKey = provider.toUpperCase();
  return (
    process.env[`BRIDGE_RUNNER_MODEL_${providerKey}`] ||
    process.env.BRIDGE_RUNNER_MODEL ||
    ""
  ).trim();
}

export function getRequestedModel(job, provider) {
  const details = isRecord(job?.runner_details) ? job.runner_details : {};
  const nestedModels = isRecord(details.models) ? details.models : null;
  const requestedModel = [
    nestedModels?.[provider],
    details.model,
    details.modelId,
    details.modelName,
    getEnvDefaultModel(provider),
  ].find((value) => typeof value === "string" && value.trim());

  return typeof requestedModel === "string" ? requestedModel.trim() : "";
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findVisibleLocatorBySelectors(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function findVisibleLocatorByRoleNames(page, role, names) {
  for (const name of names) {
    const locator = page.getByRole(role, { name }).last();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function findVisibleLocator(page, locators) {
  for (const getLocator of locators) {
    const locator = getLocator();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

export async function isProviderLoginRequired(page, provider) {
  const { loginPatterns } = getProviderConfig(provider);
  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
  if (!bodyText) return false;

  const looksLoggedOut = loginPatterns.some((pattern) => pattern.test(bodyText));
  if (!looksLoggedOut) return false;

  const composer = await findProviderComposer(page, provider);
  return !composer;
}

export async function findProviderComposer(page, provider) {
  return findVisibleLocatorBySelectors(
    page,
    getProviderConfig(provider).composerSelectors,
  );
}

export async function findProviderSendButton(page, provider) {
  const config = getProviderConfig(provider);
  const byRole = await findVisibleLocatorByRoleNames(
    page,
    "button",
    config.sendButtonNames,
  );
  if (byRole) return byRole;

  const fallback = page.locator('button[aria-label*="send" i]').last();
  if (await fallback.isVisible().catch(() => false)) {
    return fallback;
  }

  return null;
}

export async function findProviderCopyButton(page, provider) {
  const config = getProviderConfig(provider);
  const byRole = await findVisibleLocatorByRoleNames(
    page,
    "button",
    config.copyButtonNames,
  );
  if (byRole) return byRole;

  const fallback = page.locator('button[aria-label*="copy" i]').last();
  if (await fallback.isVisible().catch(() => false)) {
    return fallback;
  }

  return null;
}

async function findModelPicker(page, provider) {
  const config = getProviderConfig(provider);
  return findVisibleLocator(page, [
    () => page.locator('[data-testid*="model"]').first(),
    () => page.locator('button[aria-haspopup="menu"]').first(),
    () => page.locator('button[aria-haspopup="listbox"]').first(),
    () =>
      page
        .getByRole("button", { name: config.modelPickerNames[0] ?? /model/i })
        .first(),
    ...config.modelPickerNames.map((name) => () =>
      page.getByRole("button", { name }).first()),
  ]);
}

export async function maybeSelectProviderModel(page, provider, requestedModel) {
  const trimmedModel = requestedModel.trim();
  if (!trimmedModel) return false;

  const picker = await findModelPicker(page, provider);
  if (!picker) return false;

  await picker.click().catch(() => undefined);
  await sleep(250);

  const exactModel = new RegExp(escapeRegExp(trimmedModel), "i");
  const option = await findVisibleLocator(page, [
    () => page.getByRole("menuitemradio", { name: exactModel }).first(),
    () => page.getByRole("option", { name: exactModel }).first(),
    () => page.getByRole("button", { name: exactModel }).first(),
    () => page.getByRole("link", { name: exactModel }).first(),
    () => page.locator(`[aria-label*="${trimmedModel}" i]`).first(),
    () => page.locator(`text=${trimmedModel}`).first(),
  ]);

  if (!option) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return false;
  }

  await option.click().catch(() => undefined);
  await sleep(350);
  return true;
}

export async function ensureProviderReady(page, provider, requestedModel = "") {
  const config = getProviderConfig(provider);
  if (!page.url().startsWith(config.origin)) {
    await page.goto(config.appUrl, { waitUntil: "domcontentloaded" });
  }

  await page.waitForLoadState("domcontentloaded");
  await sleep(1200);

  if (await isProviderLoginRequired(page, provider)) {
    const error = new Error(`${config.label} login required`);
    error.code = LOGIN_REQUIRED_CODE;
    throw error;
  }

  if (requestedModel.trim()) {
    await maybeSelectProviderModel(page, provider, requestedModel).catch(
      () => false,
    );
  }

  const composer = await findProviderComposer(page, provider);
  if (!composer) {
    const error = new Error(`${config.label} composer is not available`);
    error.code = LOGIN_REQUIRED_CODE;
    throw error;
  }

  return composer;
}

export async function startFreshProviderChat(page, provider) {
  const config = getProviderConfig(provider);
  const newChat = await findVisibleLocatorByRoleNames(
    page,
    "button",
    config.newChatButtonNames,
  );

  if (newChat) {
    await newChat.click().catch(() => undefined);
    await sleep(500);
    return;
  }

  await page.goto(config.appUrl, { waitUntil: "domcontentloaded" });
  await sleep(700);
}

export async function submitProviderPrompt(
  page,
  provider,
  payload,
  requestedModel = "",
) {
  const composer = await ensureProviderReady(page, provider, requestedModel);

  await composer.click().catch(() => undefined);
  await composer.fill("").catch(() => undefined);
  await composer
    .press(`${process.platform === "darwin" ? "Meta" : "Control"}+A`)
    .catch(() => undefined);
  await composer.press("Backspace").catch(() => undefined);
  await page.keyboard.insertText(payload);

  const sendButton = await findProviderSendButton(page, provider);
  if (sendButton) {
    await sendButton.click();
    return;
  }

  await page.keyboard.press("Enter");
}

export async function extractLatestProviderResponse(page, provider) {
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
  }, getProviderConfig(provider).responseSelectors);
}

export async function extractLatestProviderResponseViaCopy(page, provider) {
  const copyButton = await findProviderCopyButton(page, provider);
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
  if (
    normalizeText(afterCopy) === normalizeText(beforeCopy) &&
    !afterCopy.includes("<response>")
  ) {
    return "";
  }

  return afterCopy;
}

export async function isProviderGenerating(page, provider) {
  const stopButton = await findVisibleLocatorByRoleNames(
    page,
    "button",
    getProviderConfig(provider).stopButtonNames,
  );
  return !!stopButton;
}

export async function waitForProviderGenerationStart(
  page,
  provider,
  initialResponse = "",
) {
  const started = Date.now();
  const initial = initialResponse.trim();

  while (Date.now() - started < 20_000) {
    if (await isProviderLoginRequired(page, provider)) {
      const error = new Error(`${getProviderConfig(provider).label} login required`);
      error.code = LOGIN_REQUIRED_CODE;
      throw error;
    }

    const generating = await isProviderGenerating(page, provider);
    const response = (await extractLatestProviderResponse(page, provider)).trim();

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

export async function waitForProviderResponse(
  page,
  provider,
  initialResponse = "",
) {
  let stableCount = 0;
  let generatingSeen = false;
  let lastSeen = initialResponse.trim();
  let lastMeaningfulResponse = initialResponse.trim();
  const started = Date.now();

  const startState = await waitForProviderGenerationStart(
    page,
    provider,
    initialResponse,
  );
  generatingSeen = startState.sawGenerating;
  lastSeen = startState.baselineResponse.trim() || lastSeen;
  lastMeaningfulResponse = lastSeen;

  while (Date.now() - started < 180_000) {
    if (await isProviderLoginRequired(page, provider)) {
      const error = new Error(`${getProviderConfig(provider).label} login required`);
      error.code = LOGIN_REQUIRED_CODE;
      throw error;
    }

    const stopButtonVisible = await isProviderGenerating(page, provider);
    const response = (await extractLatestProviderResponse(page, provider)).trim();
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

  throw new Error(
    `Timed out waiting for ${getProviderConfig(provider).label} response`,
  );
}

export async function getFinalProviderResponse(
  page,
  provider,
  fallbackResponse = "",
) {
  const copiedResponse = await extractLatestProviderResponseViaCopy(
    page,
    provider,
  );
  if (copiedResponse.trim()) {
    return copiedResponse;
  }

  return fallbackResponse;
}

export async function runBridgeJob(page, job, sessionState) {
  const provider = job.provider || "gemini";
  const requestedModel = getRequestedModel(job, provider);

  if (
    job.payload_variant === "followup" &&
    sessionState.currentSessionKey &&
    sessionState.currentSessionKey !== job.session_key
  ) {
    const error = new Error(
      `Follow-up job does not match the active ${getProviderConfig(provider).label} session`,
    );
    error.code = SESSION_RESET_REQUIRED_CODE;
    throw error;
  }

  const shouldResetForFullPayload =
    job.payload_variant === "full" &&
    sessionState.currentSessionKey &&
    sessionState.currentSessionKey !== job.session_key;
  const shouldResetForModelChange =
    requestedModel &&
    sessionState.currentModel &&
    sessionState.currentModel !== requestedModel;

  if (shouldResetForFullPayload || shouldResetForModelChange) {
    await startFreshProviderChat(page, provider);
    sessionState.currentSessionKey = null;
  }

  const initialResponse = await extractLatestProviderResponse(page, provider);
  await submitProviderPrompt(page, provider, job.payload, requestedModel);
  const response = await waitForProviderResponse(page, provider, initialResponse);
  const finalResponse = await getFinalProviderResponse(page, provider, response);
  sessionState.currentSessionKey = job.session_key;
  sessionState.currentModel = requestedModel || sessionState.currentModel || null;

  return finalResponse;
}

export async function isGeminiLoginRequired(page) {
  return isProviderLoginRequired(page, "gemini");
}

export async function findComposer(page) {
  return findProviderComposer(page, "gemini");
}

export async function findSendButton(page) {
  return findProviderSendButton(page, "gemini");
}

export async function findCopyButton(page) {
  return findProviderCopyButton(page, "gemini");
}

export async function ensureGeminiReady(page, requestedModel = "") {
  return ensureProviderReady(page, "gemini", requestedModel);
}

export async function startFreshGeminiChat(page) {
  return startFreshProviderChat(page, "gemini");
}

export async function submitGeminiPrompt(page, payload, requestedModel = "") {
  return submitProviderPrompt(page, "gemini", payload, requestedModel);
}

export async function extractLatestGeminiResponse(page) {
  return extractLatestProviderResponse(page, "gemini");
}

export async function extractLatestGeminiResponseViaCopy(page) {
  return extractLatestProviderResponseViaCopy(page, "gemini");
}

export async function isGeminiGenerating(page) {
  return isProviderGenerating(page, "gemini");
}

export async function waitForGeminiGenerationStart(page, initialResponse = "") {
  return waitForProviderGenerationStart(page, "gemini", initialResponse);
}

export async function waitForGeminiResponse(page, initialResponse = "") {
  return waitForProviderResponse(page, "gemini", initialResponse);
}

export async function getFinalGeminiResponse(page, fallbackResponse = "") {
  return getFinalProviderResponse(page, "gemini", fallbackResponse);
}

export async function runGeminiBridgeJob(page, job, sessionState) {
  return runBridgeJob(page, { provider: "gemini", ...job }, sessionState);
}

export { PROVIDER_RUNNER_CONFIGS };
