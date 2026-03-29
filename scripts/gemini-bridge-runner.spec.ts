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

describe("gemini bridge runner", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.BRIDGE_RUNNER_HEADLESS;
    delete process.env.BRIDGE_RUNNER_BROWSER_CHANNEL;
    delete process.env.BRIDGE_RUNNER_BROWSER_PATH;
    delete process.env.BRIDGE_RUNNER_BROWSER_WIDTH;
    delete process.env.BRIDGE_RUNNER_BROWSER_HEIGHT;
  });

  afterEach(() => {
    delete process.env.BRIDGE_RUNNER_HEADLESS;
    delete process.env.BRIDGE_RUNNER_BROWSER_CHANNEL;
    delete process.env.BRIDGE_RUNNER_BROWSER_PATH;
    delete process.env.BRIDGE_RUNNER_BROWSER_WIDTH;
    delete process.env.BRIDGE_RUNNER_BROWSER_HEIGHT;
  });

  it("removes stale Chrome singleton files from the profile directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-runner-"));
    const profileDir = path.join(tempDir, "profile");
    await fs.mkdir(profileDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(profileDir, "SingletonLock"), "lock"),
      fs.writeFile(path.join(profileDir, "SingletonSocket"), "socket"),
      fs.writeFile(path.join(profileDir, "SingletonCookie"), "cookie"),
      fs.writeFile(path.join(profileDir, "Preferences"), "{}"),
    ]);

    const { removeStaleChromeSingletons } = await import("./gemini-bridge-runner.mjs");
    await removeStaleChromeSingletons(profileDir);

    await expect(fs.stat(path.join(profileDir, "Preferences"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(profileDir, "SingletonLock"))).rejects.toBeTruthy();
    await expect(fs.stat(path.join(profileDir, "SingletonSocket"))).rejects.toBeTruthy();
    await expect(fs.stat(path.join(profileDir, "SingletonCookie"))).rejects.toBeTruthy();
  });

  it("backs up a broken headed profile and retries once with a clean directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-runner-"));
    const profileDir = path.join(tempDir, "profile");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "SingletonLock"), "lock");
    await fs.writeFile(path.join(profileDir, "Preferences"), '{"ok":true}');

    const launchError = new Error(
      "browserType.launchPersistentContext: Target page, context or browser has been closed",
    );
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockRejectedValueOnce(launchError).mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./gemini-bridge-runner.mjs");
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

  it("prefers a branded Chrome channel for headed login", async () => {
    process.env.BRIDGE_RUNNER_BROWSER_CHANNEL = "chrome";
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-runner-"));
    const profileDir = path.join(tempDir, "profile");
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./gemini-bridge-runner.mjs");
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

  it("uses a smaller default viewport and honors browser size overrides", async () => {
    process.env.BRIDGE_RUNNER_BROWSER_WIDTH = "1100";
    process.env.BRIDGE_RUNNER_BROWSER_HEIGHT = "720";
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-runner-"));
    const profileDir = path.join(tempDir, "profile");
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./gemini-bridge-runner.mjs");
    await launchRunnerContext(profileDir);

    expect(launchPersistentContext).toHaveBeenCalledWith(
      profileDir,
      expect.objectContaining({
        viewport: { width: 1100, height: 720 },
      }),
    );
  });

  it("falls back to the default browser engine when configured Chrome is unavailable", async () => {
    process.env.BRIDGE_RUNNER_BROWSER_CHANNEL = "chrome";
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-runner-"));
    const profileDir = path.join(tempDir, "profile");
    const missingChromeError = new Error("Chromium distribution 'chrome' is not found");
    const fakeContext = { close: vi.fn() };
    launchPersistentContext.mockRejectedValueOnce(missingChromeError).mockResolvedValueOnce(fakeContext);

    const { launchRunnerContext } = await import("./gemini-bridge-runner.mjs");
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

      const { installShutdownHandlers } = await import("./gemini-bridge-runner.mjs");
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
});
