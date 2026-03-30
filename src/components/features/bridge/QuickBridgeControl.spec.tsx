// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickBridgeControl } from "./QuickBridgeControl";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

const { mockUseQuery, mockCreateBridgeJob, mockLatestBridgeJobData, mockQuickApply } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockCreateBridgeJob: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  mockLatestBridgeJobData: { current: null as null | Record<string, unknown> },
  mockQuickApply: vi.fn(),
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
  useLatestBridgeJob: () => ({ data: mockLatestBridgeJobData.current }),
  useCreateBridgeJob: () => mockCreateBridgeJob,
}));

vi.mock("./XMLGenerator", () => ({
  XMLGenerator: ({
    selectedEntries,
    onXMLGenerated,
    onPayloadReadyChange,
  }: {
    selectedEntries: string[];
    onXMLGenerated?: (value: string) => void;
    onPayloadReadyChange?: (ready: boolean) => void;
  }) => {
    React.useEffect(() => {
      onXMLGenerated?.("<payload />");
      onPayloadReadyChange?.(true);
    }, [onPayloadReadyChange, onXMLGenerated]);

    return <div data-testid="selected-entries">{selectedEntries.join(",")}</div>;
  },
}));

vi.mock("./ResponseParser", () => ({
  ResponseParser: React.forwardRef(function MockResponseParser(props, ref) {
    React.useImperativeHandle(
      ref,
      () => ({
        parse: async () => undefined,
        reset: () => undefined,
        quickApply: async () => {
          const result = await mockQuickApply();
          if (result) {
            props.onApplySuccess?.();
          }
          return result;
        },
      }),
      [props],
    );
    return null;
  }),
}));

describe("QuickBridgeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLatestBridgeJobData.current = null;
    mockQuickApply.mockResolvedValue(false);
    mockCreateBridgeJob.mutateAsync.mockResolvedValue({
      job: {
        id: "job-1",
        status: "queued",
      },
    });

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

  it("returns to Quick after the bridge session is reset", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<QuickBridgeControl streamId="stream-1" />);

    await user.click(screen.getByRole("button", { name: /quick/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /waiting/i })).toBeDisabled();
    });

    useUiPreferencesStore.getState().clearBridgeSession("stream-1");
    rerender(<QuickBridgeControl streamId="stream-1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /quick/i })).toBeEnabled();
    });
  });

  it("returns to Quick from apply phase after the bridge session is reset", async () => {
    mockLatestBridgeJobData.current = {
      id: "job-apply-1",
      status: "succeeded",
      raw_response: "<result />",
    };

    const { rerender } = render(<QuickBridgeControl streamId="stream-1" />);

    expect(screen.getByRole("button", { name: /apply/i })).toBeEnabled();

    mockLatestBridgeJobData.current = null;
    useUiPreferencesStore.getState().clearBridgeSession("stream-1");
    rerender(<QuickBridgeControl streamId="stream-1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /quick/i })).toBeEnabled();
    });
  });

  it("shows Continue after apply succeeds instead of returning to Waiting", async () => {
    const user = userEvent.setup();

    mockLatestBridgeJobData.current = {
      id: "job-apply-2",
      status: "succeeded",
      raw_response: "<result />",
    };
    mockQuickApply.mockResolvedValue(true);

    render(<QuickBridgeControl streamId="stream-1" />);

    await user.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
    });

    expect(screen.queryByRole("button", { name: /waiting/i })).not.toBeInTheDocument();
  });
});
