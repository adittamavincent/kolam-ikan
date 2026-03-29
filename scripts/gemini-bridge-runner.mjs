import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import {
  GEMINI_APP_URL,
  LOGIN_REQUIRED_CODE,
  SESSION_RESET_REQUIRED_CODE,
  runGeminiBridgeJob,
  sleep,
} from "./gemini-bridge-runner-core.mjs";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: false });
loadEnv({ path: path.resolve(process.cwd(), ".env"), override: false });

const APP_URL = (process.env.BRIDGE_RUNNER_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const RUNNER_SECRET = process.env.BRIDGE_RUNNER_SECRET || "";
const RUNNER_ID = process.env.BRIDGE_RUNNER_ID || "local-gemini-runner";
const USER_DATA_DIR =
  process.env.BRIDGE_RUNNER_PROFILE_DIR || ".auth/gemini-sidecar-profile";
const POLL_MS = Number(process.env.BRIDGE_RUNNER_POLL_INTERVAL_MS || "3000");
const HEADLESS = process.env.BRIDGE_RUNNER_HEADLESS === "true";
const RUNNER_BROWSER_CHANNEL = process.env.BRIDGE_RUNNER_BROWSER_CHANNEL || "chrome";
const RUNNER_BROWSER_PATH = process.env.BRIDGE_RUNNER_BROWSER_PATH || "";
const CHROME_SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

if (!RUNNER_SECRET) {
  throw new Error("BRIDGE_RUNNER_SECRET is required");
}

async function runnerFetch(path, init = {}) {
  return fetch(`${APP_URL}${path}`, {
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
        `Body preview: ${rawText.slice(0, 200)}. Parse error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function claimNextJob() {
  const response = await runnerFetch(
    `/api/bridge/jobs/next?provider=gemini&runnerId=${encodeURIComponent(RUNNER_ID)}`,
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
  return payload.job ?? null;
}

async function completeJob(jobId, rawResponse, page) {
  const response = await runnerFetch(`/api/bridge/jobs/${jobId}/result`, {
    method: "POST",
    body: JSON.stringify({
      rawResponse,
      runnerDetails: {
        runnerId: RUNNER_ID,
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

async function failJob(jobId, error, page) {
  const response = await runnerFetch(`/api/bridge/jobs/${jobId}/fail`, {
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
    viewport: { width: 1440, height: 960 },
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
      console.log("[gemini-bridge-runner] shutting down", { signal });
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
      console.warn("[gemini-bridge-runner] configured browser unavailable; falling back", {
        requestedChannel: RUNNER_BROWSER_PATH ? null : launchBrowserChannelLabel(),
        requestedPath: RUNNER_BROWSER_PATH || null,
      });
      return chromium.launchPersistentContext(userDataDir, buildLaunchOptions({ useConfiguredBrowser: false }));
    }

    if (HEADLESS || !isPersistentContextLaunchFailure(error)) {
      throw error;
    }

    const backupDir = await backupProfileDir(userDataDir).catch(() => null);
    if (!backupDir) {
      throw error;
    }

    console.warn("[gemini-bridge-runner] headed profile failed to launch; using a fresh profile", {
      userDataDir,
      backupDir,
    });

    return chromium.launchPersistentContext(userDataDir, buildLaunchOptions());
  }
}

export async function main() {
  console.log("[gemini-bridge-runner] starting", {
    appUrl: APP_URL,
    runnerId: RUNNER_ID,
    userDataDir: USER_DATA_DIR,
    headless: HEADLESS,
    pollMs: POLL_MS,
    browserChannel: RUNNER_BROWSER_PATH ? null : launchBrowserChannelLabel(),
    browserPath: RUNNER_BROWSER_PATH || null,
  });

  const context = await launchRunnerContext(USER_DATA_DIR);
  installShutdownHandlers(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://gemini.google.com",
  }).catch(() => undefined);

  let page = context.pages()[0] ?? (await context.newPage());
  let sessionState = {
    currentSessionKey: null,
  };

  await page.goto(GEMINI_APP_URL, { waitUntil: "domcontentloaded" });
  console.log("[gemini-bridge-runner] browser ready", { pageUrl: page.url() });

  while (true) {
    try {
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }

      console.log("[gemini-bridge-runner] claimed job", {
        id: job.id,
        payloadVariant: job.payload_variant,
        sessionKey: job.session_key,
      });

      page = page.isClosed() ? await context.newPage() : page;

      try {
        const response = await runGeminiBridgeJob(page, job, sessionState);
        await completeJob(job.id, response, page);
        console.log("[gemini-bridge-runner] completed job", { id: job.id });
      } catch (error) {
        if (error?.code === SESSION_RESET_REQUIRED_CODE) {
          sessionState.currentSessionKey = null;
        }
        await failJob(job.id, error, page);
        console.error("[gemini-bridge-runner] failed job", {
          id: job.id,
          code: error?.code ?? "RUNNER_ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      console.error("[gemini-bridge-runner]", error);
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
    console.error("[gemini-bridge-runner] fatal", error);
    process.exitCode = 1;
  });
}
