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
  mockContextBagProps,
  mockXMLGeneratorProps,
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
  mockContextBagProps: {
    current: null as null | Record<string, unknown>,
  },
  mockXMLGeneratorProps: {
    current: null as null | Record<string, unknown>,
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
  ContextBag: (props: Record<string, unknown>) => {
    mockContextBagProps.current = props;
    return null;
  },
}));

vi.mock("./XMLGenerator", () => ({
  XMLGenerator: (props: Record<string, unknown>) => {
    mockXMLGeneratorProps.current = props;
    return null;
  },
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
      onApplySuccess,
      onStatusChange,
    }: {
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
      onStatusChange?.({
        isApplying: false,
        canApply: true,
        canParse: true,
        hasParsed: true,
      });
    }, [onStatusChange]);

    React.useImperativeHandle(ref, () => ({
      apply: () => {
        onApplySuccess?.();
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
    mockXMLGeneratorProps.current = null;
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
          case "bridge-entry-defaults":
            return {
              data: ["entry-1", "entry-2", "entry-3"],
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

  it("auto-selects all stream entries in the context bag by default", async () => {
    render(<BridgeModal isOpen onClose={vi.fn()} streamId="stream-1" />);

    await waitFor(() => {
      expect(mockContextBagProps.current).toMatchObject({
        selectedEntries: ["entry-1", "entry-2", "entry-3"],
      });
    });
  });

  it("shows a paste response button before the apply phase", async () => {
    mockLatestBridgeJobData.current = null;

    render(<BridgeModal isOpen onClose={vi.fn()} streamId="stream-1" />);

    expect(screen.getByRole("button", { name: "Paste" })).toBeInTheDocument();
  });

  it("passes followup payload settings to XMLGenerator for active external sessions", async () => {
    useUiPreferencesStore.getState().upsertBridgeSession("stream-1", {
      isExternalSessionActive: true,
      externalSessionLoadedAt: "2026-04-01T15:51:23.274Z",
    });
    mockLatestBridgeJobData.current = null;

    render(<BridgeModal isOpen onClose={vi.fn()} streamId="stream-1" />);

    await waitFor(() => {
      expect(mockXMLGeneratorProps.current).toMatchObject({
        payloadVariant: "followup",
        sessionLoadedAt: "2026-04-01T15:51:23.274Z",
      });
    });
  });
});
