// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MainHeader } from "./MainHeader";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pond/stream-1",
}));

vi.mock("@/lib/hooks/useSidebar", () => ({
  useSidebar: () => ({
    visible: true,
    show: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useStream", () => ({
  useStream: () => ({
    stream: {
      name: "Stream One",
      stream_kind: "LOCAL",
      cabinet: {
        name: "Pond",
      },
    },
  }),
}));

describe("MainHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a cloud-only syncing indicator when the stream is dirty", () => {
    render(<MainHeader />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("kolam_log_state", {
          detail: {
            streamId: "stream-1",
            isDirty: true,
          },
        }),
      );
    });

    expect(screen.getByLabelText("Cloud syncing")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});
