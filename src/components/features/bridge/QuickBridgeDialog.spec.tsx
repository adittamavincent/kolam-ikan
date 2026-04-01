// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickBridgeDialog } from "./QuickBridgeDialog";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

const {
  mockUseQuery,
  mockLatestBridgeJobData,
  mockApply,
  mockQuickApply,
  mockRunnerStatus,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockLatestBridgeJobData: { current: null as null | Record<string, unknown> },
  mockApply: vi.fn(),
  mockQuickApply: vi.fn(),
  mockRunnerStatus: {
    online: true,
    isChecking: false,
    checkNow: vi.fn(),
    status: {
      online: true,
      runnerId: "local-bridge-runner" as string | undefined,
      providers: ["gemini"] as string[] | undefined,
    },
    mode: "online",
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
  useLatestBridgeJob: () => ({ data: mockLatestBridgeJobData.current }),
  useCreateBridgeJob: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/lib/hooks/useResetBridgeSession", () => ({
  useResetBridgeSession: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/lib/hooks/useBridgeRunnerStatus", () => ({
  useBridgeRunnerStatus: () => mockRunnerStatus,
}));

vi.mock("./XMLGenerator", () => ({
  XMLGenerator: () => null,
}));

vi.mock("./BridgeResponsePreviewModal", () => ({
  BridgeResponsePreviewModal: () => null,
}));

vi.mock("@/components/shared/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("@/components/shared/ModalShell", () => ({
  ModalShell: ({
    children,
    footerActions = [],
  }: {
    children: React.ReactNode;
    footerActions?: Array<{
      label: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }>;
  }) => (
    <div>
      <div>{children}</div>
      <div>
        {footerActions.map((action, index) => (
          <button
            key={index}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  ),
  ModalHeader: ({ title }: { title: React.ReactNode }) => <div>{title}</div>,
}));

vi.mock("./ResponseParser", () => ({
  ResponseParser: React.forwardRef(function MockResponseParser(
    {
      onStatusChange,
    }: {
      onStatusChange?: (status: {
        isApplying: boolean;
        canApply: boolean;
        canParse: boolean;
        hasParsed: boolean;
      }) => void;
    },
    ref,
  ) {
    React.useEffect(() => {
      onStatusChange?.({
        isApplying: false,
        canApply: true,
        canParse: true,
        hasParsed: true,
      });
    }, [onStatusChange]);

    React.useImperativeHandle(ref, () => ({
      parse: () => undefined,
      apply: async () => await mockApply(),
      quickApply: async () => await mockQuickApply(),
      reset: () => undefined,
    }));

    return <div>ResponseParser</div>;
  }),
}));

describe("QuickBridgeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApply.mockResolvedValue(true);
    mockQuickApply.mockResolvedValue(false);
    mockLatestBridgeJobData.current = {
      id: "job-1",
      status: "succeeded",
      raw_response: "<response><log>delta</log><canvas>+ note</canvas></response>",
    };

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
      automationStatus: "succeeded",
    });

    mockUseQuery.mockImplementation(
      ({ queryKey }: { queryKey: [string, ...unknown[]] }) => {
        switch (queryKey[0]) {
          case "bridge-stream-meta":
            return {
              data: {
                id: "stream-1",
                name: "Stream 1",
                domain_id: "domain-1",
                stream_kind: "REGULAR",
              },
            };
          case "streams":
            return { data: [] };
          case "bridge-quick-entries":
            return { data: [] };
          case "bridge-quick-canvas":
            return { data: { content_json: [] } };
          default:
            return { data: undefined };
        }
      },
    );
  });

  it("applies the reviewed parser state instead of reparsing with quickApply", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <QuickBridgeDialog
        isOpen
        onClose={onClose}
        onOpenDetailed={vi.fn()}
        streamId="stream-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Apply Response" }));

    await waitFor(() => {
      expect(mockApply).toHaveBeenCalledTimes(1);
    });

    expect(mockQuickApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      useUiPreferencesStore.getState().bridgeSessionsByStream["stream-1"]?.lastAppliedJobId,
    ).toBe("job-1");
  });
});
