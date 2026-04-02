import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /api/bridge/status", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it("returns online when the health endpoint responds with a valid payload", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        runnerId: "runner-1",
        providers: ["gemini", "chatgpt"],
      }),
    }) as typeof fetch;

    const { GET } = await import("./route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      online: true,
      runnerId: "runner-1",
      providers: ["gemini", "chatgpt"],
    });
  });

  it("returns offline when the health endpoint is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) as typeof fetch;

    const { GET } = await import("./route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual({ online: false });
  });

  it("returns offline when the health payload is invalid", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "nope" }),
    }) as typeof fetch;

    const { GET } = await import("./route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual({ online: false });
  });
});
