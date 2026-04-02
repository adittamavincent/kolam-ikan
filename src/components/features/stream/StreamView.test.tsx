// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StreamView } from "./StreamView";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

vi.mock("@/components/features/log/LogPane", () => ({
  LogPane: () => <div>LogPane</div>,
}));

vi.mock("@/components/features/canvas/CanvasPane", () => ({
  CanvasPane: () => <div>CanvasPane</div>,
}));

vi.mock("@/components/features/documents/DocumentImportModal", () => ({
  DocumentImportModal: () => null,
}));

vi.mock("@/components/features/log/WhatsAppImportModal", () => ({
  WhatsAppImportModal: () => null,
}));

vi.mock("@/lib/hooks/useRealtimeEntries", () => ({
  useRealtimeEntries: vi.fn(),
}));
vi.mock("@/lib/hooks/useBridgeJobs", () => ({
  useLatestBridgeJob: vi.fn(() => ({ data: null })),
}));
vi.mock("@/lib/hooks/useResetBridgeSession", () => ({
  useResetBridgeSession: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("@/lib/hooks/useLayout", () => ({
  useLayout: () => ({
    logWidth: 50,
  }),
}));

vi.mock("@/components/features/bridge/QuickBridgeControl", () => ({
  QuickBridgeControl: () => <div>QuickBridgeControl</div>,
}));

vi.mock("@/components/features/bridge/BridgeModal", () => ({
  BridgeModal: ({
    isOpen,
  }: {
    isOpen: boolean;
  }) => (isOpen ? <div>BridgeModal</div> : null),
}));

describe("StreamView", () => {
  beforeEach(() => {
    useUiPreferencesStore.setState({
      bridgeDefaults: {
        providerId: "gemini",
        quickPreset: "recommended",
      },
      bridgeSessionsByStream: {},
    });
  });

  it("shows reset when manual quick bridge is awaiting paste", () => {
    useUiPreferencesStore.setState({
      bridgeDefaults: {
        providerId: "gemini",
        quickPreset: "recommended",
      },
      bridgeSessionsByStream: {
        "stream-1": {
          providerId: "gemini",
          lastMode: "BOTH",
          lastContextRecipe: {
            entrySelection: "all",
            includeCanvas: true,
            includeGlobalStream: true,
          },
          lastInstruction: "",
          sessionMemory: "",
          lastUsedAt: null,
          isExternalSessionActive: false,
          externalSessionLoadedAt: null,
          externalSessionUrl: null,
          automationSessionKey: null,
          automationStatus: "idle",
          lastJobId: null,
          lastAppliedJobId: null,
          lastJobStatus: null,
          lastJobError: "",
          lastJobCompletedAt: null,
          sentEntryIds: [],
          quickUiPhase: "manual-continue",
          detailedUiPhase: "send",
        },
      },
    });

    render(<StreamView streamId="stream-1" />);

    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("renders quick inline control and detailed bridge button", () => {
    render(<StreamView streamId="stream-1" />);

    expect(screen.getByText("QuickBridgeControl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detailed" })).toBeInTheDocument();
  });

  it("shows the bridge toolbar controls", () => {
    render(<StreamView streamId="stream-1" />);

    expect(screen.getByRole("button", { name: "Preferred web LLM" })).toBeInTheDocument();
    expect(screen.getByText("QuickBridgeControl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detailed" })).toBeInTheDocument();
  });

  it("opens the detailed bridge flow", () => {
    render(<StreamView streamId="stream-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Detailed" }));
    expect(screen.getByText("BridgeModal")).toBeInTheDocument();
  });
});
