import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchPersistentContext = vi.fn();

vi.mock("@playwright/test", () => ({
  chromium: {
    launchPersistentContext,
  },
}));

describe("provider bridge runner", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.BRIDGE_RUNNER_SECRET = "test-secret";
    delete process.env.BRIDGE_RUNNER_APP_URL;
  });

  afterEach(() => {
    delete process.env.BRIDGE_RUNNER_SECRET;
    delete process.env.BRIDGE_RUNNER_APP_URL;
  });

  it("removes stale Chrome singleton files from the profile directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-runner-"));
    const profileDir = path.join(tempDir, "profile");
    await fs.mkdir(profileDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(profileDir, "SingletonLock"), "lock"),
      fs.writeFile(path.join(profileDir, "SingletonSocket"), "socket"),
      fs.writeFile(path.join(profileDir, "SingletonCookie"), "cookie"),
      fs.writeFile(path.join(profileDir, "Preferences"), "{}"),
    ]);

    const { removeStaleChromeSingletons } = await import("./provider-bridge-runner.mjs");
    await removeStaleChromeSingletons(profileDir);

    await expect(fs.stat(path.join(profileDir, "Preferences"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(profileDir, "SingletonLock"))).rejects.toBeTruthy();
    await expect(fs.stat(path.join(profileDir, "SingletonSocket"))).rejects.toBeTruthy();
    await expect(fs.stat(path.join(profileDir, "SingletonCookie"))).rejects.toBeTruthy();
  });

  it("falls back to localhost when the runner app URL is not set", async () => {
    const { resolveRunnerAppUrl } = await import("./provider-bridge-runner.mjs");

    expect(resolveRunnerAppUrl({})).toBe("http://localhost:3000");
  });

  it("prefers an explicit bridge runner app URL override", async () => {
    const { resolveRunnerAppUrl } = await import("./provider-bridge-runner.mjs");

    expect(
      resolveRunnerAppUrl({
        BRIDGE_RUNNER_APP_URL: "https://runner-target.example.com/path",
      }),
    ).toBe("https://runner-target.example.com");
  });

  it("backs up a broken headed profile and retries once with a clean directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-runner-"));
    const profileDir = path.join(tempDir, "profile");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "SingletonLock"), "lock");
    await fs.writeFile(path.join(profileDir, "Preferences"), '{"ok":true}');

    const launchError = new Error(
      "browserType.launchPersistentContext: Target page, context or browser has been closed",
    );
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockRejectedValueOnce(launchError).mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./provider-bridge-runner.mjs");
    const context = await launchRunnerContext(profileDir);

    expect(context).toBe(fakeContext);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
    expect(launchPersistentContext).toHaveBeenNthCalledWith(
      1,
      profileDir,
      expect.objectContaining({ headless: false }),
    );
    expect(launchPersistentContext).toHaveBeenNthCalledWith(
      2,
      profileDir,
      expect.objectContaining({ headless: false }),
    );
    await expect(fs.stat(profileDir)).rejects.toBeTruthy();

    const entries = await fs.readdir(tempDir);
    const backupDirName = entries.find((entry) => entry.startsWith("profile.broken-"));
    expect(backupDirName).toBeTruthy();
    await expect(fs.stat(path.join(tempDir, backupDirName ?? "", "Preferences"))).resolves.toBeTruthy();
  });

  it("uses the built-in Chrome channel for headed login", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-runner-"));
    const profileDir = path.join(tempDir, "profile");
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./provider-bridge-runner.mjs");
    const context = await launchRunnerContext(profileDir);

    expect(context).toBe(fakeContext);
    expect(launchPersistentContext).toHaveBeenCalledWith(
      profileDir,
      expect.objectContaining({
        channel: "chrome",
        headless: false,
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled"],
      }),
    );
  });

  it("uses the fixed default viewport", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-runner-"));
    const profileDir = path.join(tempDir, "profile");
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./provider-bridge-runner.mjs");
    await launchRunnerContext(profileDir);

    expect(launchPersistentContext).toHaveBeenCalledWith(
      profileDir,
      expect.objectContaining({
        viewport: { width: 1280, height: 820 },
      }),
    );
  });

  it("falls back to the default browser engine when Chrome is unavailable", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-runner-"));
    const profileDir = path.join(tempDir, "profile");
    const missingChromeError = new Error("Chromium distribution 'chrome' is not found");
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockRejectedValueOnce(missingChromeError).mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./provider-bridge-runner.mjs");
    const context = await launchRunnerContext(profileDir);

    expect(context).toBe(fakeContext);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
    expect(launchPersistentContext).toHaveBeenNthCalledWith(
      1,
      profileDir,
      expect.objectContaining({ channel: "chrome" }),
    );
    expect(launchPersistentContext).toHaveBeenNthCalledWith(
      2,
      profileDir,
      expect.not.objectContaining({ channel: "chrome" }),
    );
  });

  it("closes the persistent context on shutdown signals so cookies can flush to disk", async () => {
    const originalExit = process.exit;
    const onceSpy = vi.spyOn(process, "once");
    const exitSpy = vi.fn();
    process.exit = exitSpy as unknown as typeof process.exit;

    try {
      const context = { close: vi.fn().mockResolvedValue(undefined) };
      const handlers = new Map<string, () => void>();
      onceSpy.mockImplementation(((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return process;
      }) as typeof process.once);

      const { installShutdownHandlers } = await import("./provider-bridge-runner.mjs");
      installShutdownHandlers(context);

      handlers.get("SIGINT")?.();
      await new Promise((resolve) => setImmediate(resolve));

      expect(context.close).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      process.exit = originalExit;
      onceSpy.mockRestore();
    }
  });

  it("serves runner health payload for GET /health", async () => {
    const {
      createHealthResponsePayload,
      handleRunnerHealthRequest,
    } = await import("./provider-bridge-runner.mjs");

    const writeHead = vi.fn();
    const end = vi.fn();

    handleRunnerHealthRequest(
      { method: "GET", url: "/health" },
      { writeHead, end },
    );

    expect(writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json; charset=utf-8",
      }),
    );
    expect(end).toHaveBeenCalledWith(
      JSON.stringify(createHealthResponsePayload()),
    );
  });

  it("keeps the health server payload available on the root path too", async () => {
    const {
      createHealthResponsePayload,
      handleRunnerHealthRequest,
    } = await import("./provider-bridge-runner.mjs");

    const end = vi.fn();
    handleRunnerHealthRequest(
      { method: "GET", url: "/" },
      { writeHead: vi.fn(), end },
    );

    expect(end).toHaveBeenCalledWith(
      JSON.stringify(createHealthResponsePayload()),
    );
  });
});
