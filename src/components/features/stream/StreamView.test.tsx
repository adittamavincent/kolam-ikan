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

vi.mock("@/lib/hooks/useLayout", () => ({
  useLayout: () => ({
    logWidth: 50,
  }),
}));

vi.mock("@/components/features/bridge/QuickBridgeDialog", () => ({
  QuickBridgeDialog: ({
    isOpen,
  }: {
    isOpen: boolean;
  }) => (isOpen ? <div>QuickBridgeDialog</div> : null),
}));

vi.mock("@/components/features/bridge/BridgeModal", () => ({
  BridgeModal: ({
    isOpen,
  }: {
    isOpen: boolean;
  }) => (isOpen ? <div>BridgeModal</div> : null),
}));

describe("StreamView", () => {
  it("renders sibling quick and detailed bridge buttons", () => {
    render(<StreamView streamId="stream-1" />);

    expect(screen.getByRole("button", { name: "Quick" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detailed" })).toBeInTheDocument();
  });

  it("opens quick and detailed bridge flows independently", () => {
    render(<StreamView streamId="stream-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Quick" }));
    expect(screen.getByText("QuickBridgeDialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Detailed" }));
    expect(screen.getByText("BridgeModal")).toBeInTheDocument();
  });
});
