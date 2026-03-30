// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StreamView } from "./StreamView";

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
  it("renders quick inline control and detailed bridge button", () => {
    render(<StreamView streamId="stream-1" />);

    expect(screen.getByText("QuickBridgeControl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detailed" })).toBeInTheDocument();
  });

  it("shows a single combined bridge status pill", () => {
    render(<StreamView streamId="stream-1" />);

    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.queryByText("Idle")).not.toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  it("opens the detailed bridge flow", () => {
    render(<StreamView streamId="stream-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Detailed" }));
    expect(screen.getByText("BridgeModal")).toBeInTheDocument();
  });
});
