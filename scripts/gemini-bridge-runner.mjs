import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import {
  DEFAULT_BRIDGE_RUNNER_PROVIDERS,
  getRequestedModel,
  LOGIN_REQUIRED_CODE,
  PROVIDER_RUNNER_CONFIGS,
  runBridgeJob,
  SESSION_RESET_REQUIRED_CODE,
  sleep,
} from "./gemini-bridge-runner-core.mjs";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: false });
loadEnv({ path: path.resolve(process.cwd(), ".env"), override: false });

const APP_URL = (process.env.BRIDGE_RUNNER_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const RUNNER_SECRET = process.env.BRIDGE_RUNNER_SECRET || "";
const RUNNER_ID = process.env.BRIDGE_RUNNER_ID || "local-bridge-runner";
const USER_DATA_DIR =
  process.env.BRIDGE_RUNNER_PROFILE_DIR || ".auth/bridge-runner-profile";
const POLL_MS = Number(process.env.BRIDGE_RUNNER_POLL_INTERVAL_MS || "3000");
const HEADLESS = process.env.BRIDGE_RUNNER_HEADLESS === "true";
const RUNNER_BROWSER_CHANNEL = process.env.BRIDGE_RUNNER_BROWSER_CHANNEL || "chrome";
const RUNNER_BROWSER_PATH = process.env.BRIDGE_RUNNER_BROWSER_PATH || "";
const RUNNER_BROWSER_WIDTH = Number(process.env.BRIDGE_RUNNER_BROWSER_WIDTH || "1280");
const RUNNER_BROWSER_HEIGHT = Number(process.env.BRIDGE_RUNNER_BROWSER_HEIGHT || "820");
const CHROME_SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

if (!RUNNER_SECRET) {
  throw new Error("BRIDGE_RUNNER_SECRET is required");
}

function parseEnabledProviders() {
  const configured = (process.env.BRIDGE_RUNNER_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const normalized = (configured.length > 0
    ? configured
    : DEFAULT_BRIDGE_RUNNER_PROVIDERS
  ).filter((provider, index, values) => {
    return provider in PROVIDER_RUNNER_CONFIGS && values.indexOf(provider) === index;
  });

  return normalized.length > 0 ? normalized : ["gemini"];
}

const ENABLED_PROVIDERS = parseEnabledProviders();

async function runnerFetch(requestPath, init = {}) {
  return fetch(`${APP_URL}${requestPath}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNNER_SECRET}`,
      "x-bridge-runner-id": RUNNER_ID,
      ...(init.headers ?? {}),
    },
  });
}

async function readJsonResponse(response, context) {
  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error(
      `${context} returned non-JSON response (${response.status} ${response.statusText}). ` +
        `Content-Type: ${contentType || "unknown"}. Body preview: ${rawText.slice(0, 200)}`,
    );
  }

  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `${context} returned invalid JSON (${response.status} ${response.statusText}). ` +
        `Body preview: ${rawText.slice(0, 200)}. Parse error: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
}

let nextProviderIndex = 0;

async function claimNextJob(providers = ENABLED_PROVIDERS) {
  for (let offset = 0; offset < providers.length; offset += 1) {
    const providerIndex = (nextProviderIndex + offset) % providers.length;
    const provider = providers[providerIndex];
    const response = await runnerFetch(
      `/api/bridge/jobs/next?provider=${provider}&runnerId=${encodeURIComponent(
        RUNNER_ID,
      )}`,
    );
    if (!response.ok) {
      const payload = await readJsonResponse(response, "Claim bridge job");
      throw new Error(
        payload?.error
          ? `Failed to claim bridge job (${response.status}): ${payload.error}`
          : `Failed to claim bridge job (${response.status})`,
      );
    }

    const payload = await readJsonResponse(response, "Claim bridge job");
    if (payload.job) {
      nextProviderIndex = (providerIndex + 1) % providers.length;
      return payload.job;
    }
  }

  return null;
}

async function completeJob(job, rawResponse, page, provider, requestedModel) {
  const response = await runnerFetch(`/api/bridge/jobs/${job.id}/result`, {
    method: "POST",
    body: JSON.stringify({
      rawResponse,
      runnerDetails: {
        runnerId: RUNNER_ID,
        provider,
        model: requestedModel || null,
        pageUrl: page.url(),
      },
    }),
  });

  if (!response.ok) {
    const payload = await readJsonResponse(response, "Complete bridge job");
    throw new Error(
      payload?.error
        ? `Failed to complete bridge job (${response.status}): ${payload.error}`
        : `Failed to complete bridge job (${response.status})`,
    );
  }
}

async function failJob(job, error, page, provider, requestedModel) {
  const response = await runnerFetch(`/api/bridge/jobs/${job.id}/fail`, {
    method: "POST",
    body: JSON.stringify({
      errorCode:
        error?.code === LOGIN_REQUIRED_CODE
          ? LOGIN_REQUIRED_CODE
          : error?.code === SESSION_RESET_REQUIRED_CODE
            ? SESSION_RESET_REQUIRED_CODE
            : "RUNNER_ERROR",
      errorMessage: error instanceof Error ? error.message : "Runner error",
      runnerDetails: {
        runnerId: RUNNER_ID,
        provider,
        model: requestedModel || null,
        pageUrl: page?.url?.() ?? null,
      },
    }),
  });

  if (!response.ok) {
    const payload = await readJsonResponse(response, "Fail bridge job");
    throw new Error(
      payload?.error
        ? `Failed to report bridge job failure (${response.status}): ${payload.error}`
        : `Failed to report bridge job failure (${response.status})`,
    );
  }
}

export function isPersistentContextLaunchFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /launchPersistentContext/i.test(message) &&
    /Target page, context or browser has been closed/i.test(message);
}

export async function removeStaleChromeSingletons(userDataDir) {
  await Promise.all(
    CHROME_SINGLETON_FILES.map(async (filename) => {
      const filePath = path.join(userDataDir, filename);
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // Ignore cleanup failures and let Chromium surface the real launch error.
      }
    }),
  );
}

export async function backupProfileDir(userDataDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${userDataDir}.broken-${timestamp}`;
  await fs.rename(userDataDir, backupDir);
  return backupDir;
}

function buildLaunchOptions({ useConfiguredBrowser = true } = {}) {
  const launchOptions = {
    headless: HEADLESS,
    viewport: {
      width: Number.isFinite(RUNNER_BROWSER_WIDTH) ? RUNNER_BROWSER_WIDTH : 1280,
      height: Number.isFinite(RUNNER_BROWSER_HEIGHT) ? RUNNER_BROWSER_HEIGHT : 820,
    },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  };

  if (!useConfiguredBrowser) {
    return launchOptions;
  }

  if (RUNNER_BROWSER_PATH) {
    return {
      ...launchOptions,
      executablePath: RUNNER_BROWSER_PATH,
    };
  }

  if (!HEADLESS && RUNNER_BROWSER_CHANNEL) {
    return {
      ...launchOptions,
      channel: RUNNER_BROWSER_CHANNEL,
    };
  }

  return launchOptions;
}

function isConfiguredBrowserUnavailable(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /executable doesn't exist/i.test(message) ||
    /failed to launch/i.test(message) ||
    /cannot find .*chrome/i.test(message) ||
    /unknown channel/i.test(message) ||
    /distribution .* not found/i.test(message)
  );
}

let activeContext = null;
let shutdownPromise = null;
let signalHandlersInstalled = false;

export async function closeRunnerContext(context) {
  if (!context) return;
  await context.close().catch(() => undefined);
}

export function installShutdownHandlers(context) {
  activeContext = context;

  if (signalHandlersInstalled) {
    return;
  }

  signalHandlersInstalled = true;

  const shutdown = async (signal) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      console.log("[bridge-runner] shutting down", { signal });
      await closeRunnerContext(activeContext);
    })();

    return shutdownPromise;
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void shutdown(signal).finally(() => {
        process.exit(0);
      });
    });
  }

  process.once("beforeExit", () => shutdown("beforeExit"));
}

export async function launchRunnerContext(userDataDir) {
  const launchOptions = buildLaunchOptions();

  await removeStaleChromeSingletons(userDataDir);

  try {
    return await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (error) {
    if (
      (RUNNER_BROWSER_PATH || (!HEADLESS && RUNNER_BROWSER_CHANNEL)) &&
      isConfiguredBrowserUnavailable(error)
    ) {
      console.warn("[bridge-runner] configured browser unavailable; falling back", {
        requestedChannel: RUNNER_BROWSER_PATH ? null : launchBrowserChannelLabel(),
        requestedPath: RUNNER_BROWSER_PATH || null,
      });
      return chromium.launchPersistentContext(
        userDataDir,
        buildLaunchOptions({ useConfiguredBrowser: false }),
      );
    }

    if (HEADLESS || !isPersistentContextLaunchFailure(error)) {
      throw error;
    }

    const backupDir = await backupProfileDir(userDataDir).catch(() => null);
    if (!backupDir) {
      throw error;
    }

    console.warn("[bridge-runner] headed profile failed to launch; using a fresh profile", {
      userDataDir,
      backupDir,
    });

    return chromium.launchPersistentContext(userDataDir, buildLaunchOptions());
  }
}

async function getProviderPage(context, provider, pagesByProvider) {
  const current = pagesByProvider.get(provider);
  if (current && !current.isClosed()) {
    return current;
  }

  const config = PROVIDER_RUNNER_CONFIGS[provider];
  const existingPage = context
    .pages()
    .find((page) => !page.isClosed() && page.url().startsWith(config.origin));

  if (existingPage) {
    pagesByProvider.set(provider, existingPage);
    return existingPage;
  }

  const page = await context.newPage();
  pagesByProvider.set(provider, page);
  return page;
}

async function ensureProviderPageReady(context, provider, pagesByProvider) {
  const page = await getProviderPage(context, provider, pagesByProvider);
  const { appUrl, origin } = PROVIDER_RUNNER_CONFIGS[provider];

  if (!page.url() || page.url() === "about:blank" || !page.url().startsWith(origin)) {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  }

  return page;
}

export async function main() {
  console.log("[bridge-runner] starting", {
    appUrl: APP_URL,
    runnerId: RUNNER_ID,
    userDataDir: USER_DATA_DIR,
    headless: HEADLESS,
    pollMs: POLL_MS,
    providers: ENABLED_PROVIDERS,
    browserChannel: RUNNER_BROWSER_PATH ? null : launchBrowserChannelLabel(),
    browserPath: RUNNER_BROWSER_PATH || null,
  });

  const context = await launchRunnerContext(USER_DATA_DIR);
  installShutdownHandlers(context);

  for (const provider of ENABLED_PROVIDERS) {
    await context
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: PROVIDER_RUNNER_CONFIGS[provider].origin,
      })
      .catch(() => undefined);
  }

  const pagesByProvider = new Map();
  const sessionStates = new Map(
    ENABLED_PROVIDERS.map((provider) => [
      provider,
      { currentSessionKey: null, currentModel: null },
    ]),
  );

  for (const provider of ENABLED_PROVIDERS) {
    const page = await ensureProviderPageReady(context, provider, pagesByProvider);
    console.log("[bridge-runner] provider page ready", {
      provider,
      pageUrl: page.url(),
    });
  }

  console.log("[bridge-runner] browser ready", {
    providers: ENABLED_PROVIDERS,
  });

  while (true) {
    try {
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }

      const provider = job.provider;
      const requestedModel = getRequestedModel(job, provider);
      const page = await ensureProviderPageReady(context, provider, pagesByProvider);
      const sessionState =
        sessionStates.get(provider) ?? {
          currentSessionKey: null,
          currentModel: null,
        };
      sessionStates.set(provider, sessionState);

      console.log("[bridge-runner] claimed job", {
        id: job.id,
        provider,
        model: requestedModel || null,
        payloadVariant: job.payload_variant,
        sessionKey: job.session_key,
      });

      try {
        const response = await runBridgeJob(page, job, sessionState);
        await completeJob(job, response, page, provider, requestedModel);
        console.log("[bridge-runner] completed job", {
          id: job.id,
          provider,
          model: requestedModel || null,
        });
      } catch (error) {
        if (error?.code === SESSION_RESET_REQUIRED_CODE) {
          sessionState.currentSessionKey = null;
        }
        await failJob(job, error, page, provider, requestedModel);
        console.error("[bridge-runner] failed job", {
          id: job.id,
          provider,
          model: requestedModel || null,
          code: error?.code ?? "RUNNER_ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      console.error("[bridge-runner]", error);
      await sleep(POLL_MS);
    }
  }
}

function launchBrowserChannelLabel() {
  if (HEADLESS || !RUNNER_BROWSER_CHANNEL) {
    return null;
  }

  return RUNNER_BROWSER_CHANNEL;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[bridge-runner] fatal", error);
    process.exitCode = 1;
  });
}
