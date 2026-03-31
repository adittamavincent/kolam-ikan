// @vitest-environment jsdom
import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dispatchKolamLogState,
  useLogBranchContext,
} from "./useLogBranchContext";

function Probe({ streamId }: { streamId: string }) {
  const { currentBranch, currentBranchHeadId } = useLogBranchContext(streamId);

  return (
    <div>
      <span data-testid="branch">{currentBranch}</span>
      <span data-testid="head">{currentBranchHeadId ?? ""}</span>
    </div>
  );
}

function SnapshotProbe({
  streamId,
  onSnapshot,
}: {
  streamId: string;
  onSnapshot: (snapshot: ReturnType<typeof useLogBranchContext>) => void;
}) {
  const snapshot = useLogBranchContext(streamId);

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

describe("useLogBranchContext", () => {
  beforeEach(() => {
    window.__kolamLogStateByStream = {};
  });

  it("hydrates from the latest cached log state even if the event happened before mount", async () => {
    dispatchKolamLogState({
      streamId: "stream-1",
      currentBranch: "feature-x",
      currentBranchHeadId: "entry-123",
    });

    render(<Probe streamId="stream-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("branch")).toHaveTextContent("feature-x");
      expect(screen.getByTestId("head")).toHaveTextContent("entry-123");
    });
  });

  it("preserves cached branch context when later status-only events are published", async () => {
    dispatchKolamLogState({
      streamId: "stream-1",
      currentBranch: "main",
      currentBranchHeadId: "entry-parent",
    });
    dispatchKolamLogState({
      streamId: "stream-1",
      status: "idle",
      isDirty: false,
    });

    render(<Probe streamId="stream-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("branch")).toHaveTextContent("main");
      expect(screen.getByTestId("head")).toHaveTextContent("entry-parent");
    });
  });

  it("reuses the same snapshot object when derived branch state is unchanged", async () => {
    const snapshots: Array<ReturnType<typeof useLogBranchContext>> = [];

    dispatchKolamLogState({
      streamId: "stream-1",
      currentBranch: "main",
      currentBranchHeadId: "entry-parent",
    });

    render(
      <SnapshotProbe
        streamId="stream-1"
        onSnapshot={(snapshot) => {
          snapshots.push(snapshot);
        }}
      />,
    );

    await waitFor(() => {
      expect(snapshots).toHaveLength(1);
    });

    dispatchKolamLogState({
      streamId: "stream-1",
      status: "idle",
      isDirty: false,
    });

    await waitFor(() => {
      expect(snapshots).toHaveLength(1);
    });
  });
});
