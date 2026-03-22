import { PartialBlock } from "@blocknote/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasDraft } from "./useCanvasDraft";

const paragraph = (text: string): PartialBlock[] => [
  {
    type: "paragraph",
    content: [{ type: "text", text, styles: {} }],
  },
];

function resetCanvasDraftStore() {
  useCanvasDraft.setState({
    dirtyStreams: new Set(),
    liveContentByStream: {},
    starterBaselineByStream: {},
    dbSyncStatusByStream: {},
    localSaveStatusByStream: {},
  });
}

describe("useCanvasDraft", () => {
  beforeEach(() => {
    resetCanvasDraftStore();
  });

  it("updates the starter baseline when the DB canvas changes for the same canvas id", () => {
    const { setStarterBaseline } = useCanvasDraft.getState();
    const initial = paragraph("Before");
    const updated = paragraph("After");

    setStarterBaseline("stream-1", "canvas-1", initial);
    setStarterBaseline("stream-1", "canvas-1", updated);

    expect(
      useCanvasDraft.getState().starterBaselineByStream["stream-1"]?.content,
    ).toEqual(updated);
  });

  it("clears dirty and baseline state when live content is removed", () => {
    useCanvasDraft.setState({
      dirtyStreams: new Set(["stream-1"]),
      liveContentByStream: {
        "stream-1": paragraph("Draft"),
      },
      starterBaselineByStream: {
        "stream-1": {
          canvasId: "canvas-1",
          content: paragraph("Base"),
        },
      },
    });

    useCanvasDraft.getState().clearLiveContent("stream-1");

    expect(useCanvasDraft.getState().dirtyStreams.has("stream-1")).toBe(false);
    expect(
      useCanvasDraft.getState().starterBaselineByStream["stream-1"],
    ).toBeUndefined();
    expect(useCanvasDraft.getState().liveContentByStream["stream-1"]).toBeUndefined();
  });
});
