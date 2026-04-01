// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeModal } from "./BridgeModal";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

const {
  mockUseQuery,
  mockLatestBridgeJobData,
  mockRunnerStatus,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockLatestBridgeJobData: { current: null as null | Record<string, unknown> },
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

vi.mock("./InteractionSwitcher", () => ({
  InteractionSwitcher: () => null,
}));

vi.mock("./ContextBag", () => ({
  ContextBag: () => null,
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
    props: {
      onApplySuccess?: () => void;
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
      props.onStatusChange?.({
        isApplying: false,
        canApply: true,
        canParse: true,
        hasParsed: true,
      });
    }, [props.onStatusChange]);

    React.useImperativeHandle(ref, () => ({
      apply: () => {
        props.onApplySuccess?.();
      },
      parse: async () => undefined,
      reset: () => undefined,
      quickApply: async () => true,
    }));

    return null;
  }),
}));

describe("BridgeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLatestBridgeJobData.current = {
      id: "job-1",
      status: "succeeded",
      raw_response: "<response><log>done</log></response>",
      error_message: "",
      completed_at: "2026-04-01T09:00:00.000Z",
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
      automationStatus: "running",
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
              isLoading: false,
            };
          case "streams":
            return {
              data: [],
              isLoading: false,
            };
          default:
            return { data: undefined, isLoading: false };
        }
      },
    );
  });

  it("marks the latest automated response as applied before closing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <BridgeModal
        isOpen
        onClose={onClose}
        streamId="stream-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(
        useUiPreferencesStore.getState().bridgeSessionsByStream["stream-1"],
      ).toMatchObject({
        lastAppliedJobId: "job-1",
        automationStatus: "succeeded",
        lastJobId: "job-1",
      });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
