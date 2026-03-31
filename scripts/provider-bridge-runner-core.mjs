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
      'div[data-is-streaming]',
      '[data-testid*="assistant"]',
      '[data-testid*="message-content"]',
      'article',
    ],
    newChatButtonNames: [/new chat/i, /start new/i],
    stopButtonNames: [/stop/i],
    sendButtonNames: [/send/i],
    copyButtonNames: [/copy/i, /copy response/i],
    loginPatterns: [/log in/i, /sign in/i, /continue with/i],
    modelPickerNames: [/claude/i, /sonnet/i, /haiku/i, /opus/i, /model/i],
  },
};

export const DEFAULT_BRIDGE_RUNNER_PROVIDERS = Object.freeze(
  Object.keys(PROVIDER_RUNNER_CONFIGS),
);
export const LOGIN_REQUIRED_CODE = "LOGIN_REQUIRED";
export const SESSION_RESET_REQUIRED_CODE = "SESSION_RESET_REQUIRED";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function buildResponseStabilityKey(value) {
  return normalizeText(value)
    .replace(/\b(copy( response)?|retry|edit|share|like|dislike|good response|bad response)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function responsesRoughlyMatch(candidate, expected) {
  const candidateNormalized = normalizeText(candidate);
  const expectedNormalized = normalizeText(expected);
  if (!candidateNormalized || !expectedNormalized) return false;

  return candidateNormalized === expectedNormalized ||
    candidateNormalized.includes(expectedNormalized) ||
    expectedNormalized.includes(candidateNormalized);
}

function extractBridgeInteractionMode(payload) {
  const match = String(payload || "").match(/Target:\s*(ASK|GO|BOTH)\b/i);
  return match ? match[1].toUpperCase() : "ASK";
}

function hasXmlTagContent(text, tagName) {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i").exec(
    String(text || ""),
  );
  return !!match && match[1].trim().length > 0;
}

function bridgeResponseNeedsRepair(payload, responseText) {
  const mode = extractBridgeInteractionMode(payload);
  const response = String(responseText || "");
  const hasResponseWrapper =
    /<response[\s>]/i.test(response) && /<\/response>/i.test(response);
  const hasLog = ["log", "thought_log", "answer", "final", "reply"].some((tag) =>
    hasXmlTagContent(response, tag),
  );
  const hasCanvas = [
    "canvas",
    "canvas_update",
    "canvas_md",
    "canvas_update_md",
    "canvas_json",
    "canvas_update_json",
    "artifact",
    "artifact_md",
    "artifact_json",
  ].some((tag) => hasXmlTagContent(response, tag));

  const missingLog = (mode === "ASK" || mode === "BOTH") && !hasLog;
  const missingCanvas = (mode === "GO" || mode === "BOTH") && !hasCanvas;

  return {
    mode,
    missingLog,
    missingCanvas,
    needsRepair: !hasResponseWrapper || missingLog || missingCanvas,
  };
}

function buildBridgeRepairPrompt(payload, responseText) {
  const { mode, missingLog, missingCanvas } = bridgeResponseNeedsRepair(
    payload,
    responseText,
  );
  const requiredTags =
    mode === "BOTH"
      ? "both a non-empty <log> and a non-empty <canvas>"
      : mode === "GO"
        ? "a non-empty <canvas>"
        : "a non-empty <log>";
  const missingBits = [
    !/<response[\s>]/i.test(String(responseText || "")) ||
    !/<\/response>/i.test(String(responseText || ""))
      ? "<response> wrapper"
      : null,
    missingLog ? "<log>" : null,
    missingCanvas ? "<canvas>" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `Rewrite your last answer only.
Return XML only with exactly one <response>...</response> wrapper.
The required output for this bridge turn is ${requiredTags}.
Your previous answer was missing or invalid for: ${missingBits || "required XML structure"}.
Do not omit required tags. Do not explain the mistake. Do not add commentary outside XML.
Preserve the same meaning and same bridge intent, but fix the structure now.`;
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

async function findVisibleLocatorInScope(scope, locators) {
  for (const getLocator of locators) {
    const locator = getLocator(scope);
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
  let byRole = await findVisibleLocatorByRoleNames(page, "button", config.copyButtonNames);
  if (byRole) return byRole;

  let fallback = await findVisibleLocator(page, [
    () => page.locator('button[aria-label*="copy" i]').last(),
    () => page.locator('button[title*="copy" i]').last(),
    () => page.locator('[data-testid*="copy"]').last(),
  ]);
  if (fallback) {
    return fallback;
  }

  if (provider === "claude") {
    const claudeExactCopyButton = await findVisibleLocator(page, [
      () =>
        page
          .locator(
            'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]',
          )
          .last(),
      () =>
        page
          .locator(
            'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[aria-label="Copy"]',
          )
          .last(),
      () =>
        page
          .locator(
            '[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]',
          )
          .last(),
    ]);
    if (claudeExactCopyButton) {
      return claudeExactCopyButton;
    }

    const hoverTargets = [
      () => page.locator("article").last(),
      ...config.responseSelectors.map((selector) => () => page.locator(selector).last()),
    ];

    for (const getTarget of hoverTargets) {
      const target = getTarget();
      if (!await target.isVisible().catch(() => false)) {
        continue;
      }

      await target.hover().catch(() => undefined);
      await sleep(150);

      const hoveredClaudeExactCopyButton = await findVisibleLocator(page, [
        () =>
          page
            .locator(
              'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]',
            )
            .last(),
        () =>
          page
            .locator(
              'div[data-is-streaming] + div[role="group"][aria-label="Message actions"] button[aria-label="Copy"]',
            )
            .last(),
        () =>
          page
            .locator(
              '[role="group"][aria-label="Message actions"] button[data-testid="action-bar-copy"]',
            )
            .last(),
      ]);
      if (hoveredClaudeExactCopyButton) {
        return hoveredClaudeExactCopyButton;
      }

      const scopedByRole = await findVisibleLocatorInScope(
        target,
        config.copyButtonNames.map((name) => (scope) =>
          scope.getByRole("button", { name }).last()),
      );
      if (scopedByRole) return scopedByRole;

      const scopedFallback = await findVisibleLocatorInScope(target, [
        (scope) => scope.locator('button[aria-label*="copy response" i]').last(),
        (scope) => scope.locator('button[aria-label*="copy" i]').last(),
        (scope) => scope.locator('button[title*="copy" i]').last(),
        (scope) => scope.locator('[data-testid*="copy"]').last(),
        // Claude sometimes renders the action row as unlabeled icon buttons; the first
        // visible action in the hovered latest response cluster is the copy control.
        (scope) => scope.locator('button, [role="button"]').first(),
      ]);
      if (scopedFallback) {
        return scopedFallback;
      }
    }
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
        const candidate =
          node instanceof HTMLElement ? node.cloneNode(true) : node?.cloneNode?.(true);
        if (candidate instanceof HTMLElement) {
          candidate
            .querySelectorAll(
              [
                "button",
                "svg",
                "form",
                "nav",
                "footer",
                '[role="toolbar"]',
                '[data-testid*="action"]',
                '[data-testid*="feedback"]',
                '[aria-label*="copy" i]',
                '[aria-label*="retry" i]',
                '[aria-label*="edit" i]',
                '[aria-label*="share" i]',
              ].join(","),
            )
            .forEach((child) => child.remove());
        }
        const text =
          (candidate instanceof HTMLElement
            ? candidate.innerText
            : candidate?.textContent) ??
          (node instanceof HTMLElement ? node.innerText : node.textContent);
        const trimmed = text?.trim();
        if (trimmed) texts.push(trimmed);
      }
      if (texts.length > 0) break;
    }

    return texts.at(-1) ?? "";
  }, getProviderConfig(provider).responseSelectors);
}

async function readClipboardText(page) {
  return page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  });
}

async function waitForCopiedClipboardText(
  page,
  provider,
  beforeCopy,
  expectedResponse = "",
) {
  const timeoutMs = provider === "claude" ? 3_500 : 1_250;
  const pollMs = provider === "claude" ? 150 : 100;
  const started = Date.now();
  let latestClipboard = "";

  while (Date.now() - started < timeoutMs) {
    latestClipboard = await readClipboardText(page);

    if (responsesRoughlyMatch(latestClipboard, expectedResponse)) {
      return latestClipboard;
    }

    if (
      latestClipboard.trim() &&
      (normalizeText(latestClipboard) !== normalizeText(beforeCopy) ||
        latestClipboard.includes("<response>"))
    ) {
      return latestClipboard;
    }

    await sleep(pollMs);
  }

  return latestClipboard;
}

export async function extractLatestProviderResponseViaCopy(
  page,
  provider,
  expectedResponse = "",
) {
  const copyButton = await findProviderCopyButton(page, provider);
  if (!copyButton) return "";

  const beforeCopy = await readClipboardText(page);

  await copyButton.click().catch(() => undefined);
  const afterCopy = await waitForCopiedClipboardText(
    page,
    provider,
    beforeCopy,
    expectedResponse,
  );

  if (!afterCopy.trim()) return "";
  if (responsesRoughlyMatch(afterCopy, expectedResponse)) {
    return afterCopy;
  }

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

async function canProviderResponseBeCopied(page, provider) {
  const copyButton = await findProviderCopyButton(page, provider);
  return !!copyButton;
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
  let lastStableKey = buildResponseStabilityKey(initialResponse);
  let generationCompletedAt = null;
  const started = Date.now();

  const startState = await waitForProviderGenerationStart(
    page,
    provider,
    initialResponse,
  );
  generatingSeen = startState.sawGenerating;
  lastSeen = startState.baselineResponse.trim() || lastSeen;
  lastMeaningfulResponse = lastSeen;
  lastStableKey = buildResponseStabilityKey(lastSeen);
  const baselineChanged =
    !!startState.baselineResponse.trim() &&
    startState.baselineResponse.trim() !== initialResponse.trim();

  while (Date.now() - started < 180_000) {
    if (await isProviderLoginRequired(page, provider)) {
      const error = new Error(`${getProviderConfig(provider).label} login required`);
      error.code = LOGIN_REQUIRED_CODE;
      throw error;
    }

    const stopButtonVisible = await isProviderGenerating(page, provider);
    const response = (await extractLatestProviderResponse(page, provider)).trim();
    const hasNewResponse = !!response && response !== initialResponse.trim();
    const responseStableKey = buildResponseStabilityKey(response);

    if (stopButtonVisible) {
      generatingSeen = true;
      generationCompletedAt = null;
    }

    if (hasNewResponse) {
      lastMeaningfulResponse = response;
    }

    if (!stopButtonVisible && hasNewResponse && generatingSeen) {
      generationCompletedAt = generationCompletedAt ?? Date.now();
    }

    if (hasNewResponse) {
      const hasCopyButton = await canProviderResponseBeCopied(page, provider);

      if (
        !stopButtonVisible &&
        hasCopyButton &&
        (generatingSeen || baselineChanged)
      ) {
        await sleep(200);
        const settledResponse = (
          await extractLatestProviderResponse(page, provider)
        ).trim();
        if (settledResponse && settledResponse === response) {
          return settledResponse;
        }
        if (!settledResponse) {
          return lastMeaningfulResponse;
        }
        lastMeaningfulResponse = settledResponse;
        lastSeen = settledResponse;
        stableCount = 0;
        await sleep(250);
        continue;
      }

      if (
        provider === "claude" &&
        !stopButtonVisible &&
        generationCompletedAt &&
        Date.now() - generationCompletedAt >= 4_000
      ) {
        return lastMeaningfulResponse;
      }

      if (
        responseStableKey &&
        responseStableKey === lastStableKey &&
        !stopButtonVisible &&
        (generatingSeen || baselineChanged)
      ) {
        stableCount += 1;
        if (stableCount >= 2) {
          return lastMeaningfulResponse;
        }
      } else {
        stableCount = 0;
      }
      lastSeen = response;
      lastStableKey = responseStableKey || lastStableKey;
    }

    await sleep(generatingSeen ? 700 : 350);
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
  const attempts = provider === "claude" ? 8 : 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const copiedResponse = await extractLatestProviderResponseViaCopy(
      page,
      provider,
      fallbackResponse,
    );
    if (copiedResponse.trim()) {
      return copiedResponse;
    }

    if (attempt < attempts - 1) {
      await sleep(provider === "claude" ? 300 + attempt * 200 : 250 + attempt * 150);
    }
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
  let finalResponse = await getFinalProviderResponse(page, provider, response);

  for (let repairAttempt = 0; repairAttempt < 2; repairAttempt += 1) {
    const repairState = bridgeResponseNeedsRepair(job.payload, finalResponse);
    if (!repairState.needsRepair) break;

    const repairPrompt = buildBridgeRepairPrompt(job.payload, finalResponse);
    await submitProviderPrompt(page, provider, repairPrompt, requestedModel);
    const repairedResponse = await waitForProviderResponse(
      page,
      provider,
      finalResponse,
    );
    finalResponse = await getFinalProviderResponse(
      page,
      provider,
      repairedResponse,
    );
  }

  sessionState.currentSessionKey = job.session_key;
  sessionState.currentModel = requestedModel || sessionState.currentModel || null;

  return finalResponse;
}

export { PROVIDER_RUNNER_CONFIGS };
