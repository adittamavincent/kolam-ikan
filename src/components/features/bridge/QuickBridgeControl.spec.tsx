// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickBridgeControl } from "./QuickBridgeControl";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

const { mockUseQuery, mockCreateBridgeJob } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockCreateBridgeJob: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: mockUseQuery,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/hooks/useBridgeJobs", () => ({
  useLatestBridgeJob: () => ({ data: null }),
  useCreateBridgeJob: () => mockCreateBridgeJob,
}));

vi.mock("./XMLGenerator", () => ({
  XMLGenerator: ({
    selectedEntries,
  }: {
    selectedEntries: string[];
  }) => <div data-testid="selected-entries">{selectedEntries.join(",")}</div>,
}));

vi.mock("./ResponseParser", () => ({
  ResponseParser: React.forwardRef(function MockResponseParser(_props, ref) {
    React.useImperativeHandle(
      ref,
      () => ({
        parse: async () => undefined,
        reset: () => undefined,
        quickApply: async () => false,
      }),
      [],
    );
    return null;
  }),
}));

describe("QuickBridgeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useUiPreferencesStore.setState({
      bridgeDefaults: {
        providerId: "gemini",
        quickPreset: "recommended",
      },
      bridgeSessionsByStream: {},
    });

    useUiPreferencesStore.getState().upsertBridgeSession("stream-1", {
      providerId: "gemini",
      lastMode: "BOTH",
      lastContextRecipe: {
        entrySelection: "last-5",
        includeCanvas: true,
        includeGlobalStream: true,
      },
    });

    mockUseQuery.mockImplementation(
      ({ queryKey }: { queryKey: [string, ...unknown[]] }) => {
        switch (queryKey[0]) {
          case "bridge-stream-meta":
            return {
              data: {
                id: "stream-1",
                domain_id: "domain-1",
                stream_kind: "REGULAR",
              },
            };
          case "streams":
            return {
              data: [
                {
                  id: "global-1",
                  name: "Global",
                  stream_kind: "GLOBAL",
                },
              ],
            };
          case "bridge-quick-entries":
            return {
              data: [
                { id: "entry-6", created_at: "2026-03-29T10:06:00.000Z" },
                { id: "entry-5", created_at: "2026-03-29T10:05:00.000Z" },
                { id: "entry-4", created_at: "2026-03-29T10:04:00.000Z" },
                { id: "entry-3", created_at: "2026-03-29T10:03:00.000Z" },
                { id: "entry-2", created_at: "2026-03-29T10:02:00.000Z" },
                { id: "entry-1", created_at: "2026-03-29T10:01:00.000Z" },
              ],
            };
          case "bridge-quick-canvas":
            return {
              data: {
                content_json: [{ id: "block-1" }],
              },
            };
          default:
            return { data: undefined };
        }
      },
    );
  });

  it("includes all current stream entries even when the saved session recipe is last-5", () => {
    render(<QuickBridgeControl streamId="stream-1" />);

    expect(screen.getByTestId("selected-entries")).toHaveTextContent(
      "entry-6,entry-5,entry-4,entry-3,entry-2,entry-1",
    );
  });
});
