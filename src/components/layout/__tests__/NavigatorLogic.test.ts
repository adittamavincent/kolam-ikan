import { describe, it, expect } from "vitest";
import {
  applyOptimisticCabinetCreation,
  applyOptimisticStreamCreation,
  getNextSortOrder,
  getUniqueName,
  getVisibleActiveNodeId,
  resolveCreationTarget,
  isCreationAllowed,
} from "@/lib/utils/navigation";
import { Cabinet, Stream } from "@/lib/types";

// Mock data helpers
const createCabinet = (
  id: string,
  parentId: string | null = null,
): Cabinet => ({
  id,
  parent_id: parentId,
  name: `Cabinet ${id}`,
  domain_id: "domain-1",
  sort_order: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  archived_at: null,
});

const createStream = (id: string, cabinetId: string | null): Stream => ({
  id,
  cabinet_id: cabinetId,
  domain_id: "domain-1",
  name: `Stream ${id}`,
  stream_kind: "REGULAR",
  is_system_global: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  description: null,
  sort_order: 0,
  archived_at: null,
  parent_stream_id: null,
});

describe("getVisibleActiveNodeId", () => {
  // Setup hierarchy:
  // Root (C1)
  //   -> Sub (C2)
  //      -> Stream (S1)
  // Root (C3)
  //   -> Stream (S2)

  const c1 = createCabinet("c1");
  const c2 = createCabinet("c2", "c1");
  const c3 = createCabinet("c3");

  const s1 = createStream("s1", "c2");
  const s2 = createStream("s2", "c3");

  const cabinets = [c1, c2, c3];
  const streams = [s1, s2];

  it("should return null if no active stream", () => {
    const result = getVisibleActiveNodeId(
      undefined,
      streams,
      cabinets,
      new Set(),
    );
    expect(result).toBeNull();
  });

  it("should highlight stream if all parents are expanded", () => {
    // S1 is in C2, C2 is in C1.
    // Expand C1 and C2.
    const expanded = new Set(["c1", "c2"]);
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);

    expect(result).toEqual({ id: "s1", type: "stream" });
  });

  it("should highlight immediate parent if it is collapsed (but its parent is expanded)", () => {
    // S1 is in C2. C2 is collapsed. C1 is expanded.
    // Visible: C1 -> C2 (collapsed). S1 is hidden.
    // Highlight should be C2.
    const expanded = new Set(["c1"]);
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);

    expect(result).toEqual({ id: "c2", type: "cabinet" });
  });

  it("should highlight top-level parent if sub-cabinet is collapsed and top-level is collapsed", () => {
    // S1 is in C2. C2 is in C1.
    // C2 is collapsed. C1 is collapsed.
    // Visible: C1 (collapsed). C2 is hidden. S1 is hidden.
    // Highlight should be C1.
    const expanded = new Set<string>();
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);

    expect(result).toEqual({ id: "c1", type: "cabinet" });
  });

  it("should highlight top-level parent if sub-cabinet is expanded but top-level is collapsed", () => {
    // S1 is in C2. C2 is in C1.
    // C2 is expanded (internally), but C1 is collapsed.
    // Since C1 is collapsed, C2 is not visible.
    // Highlight should be C1.
    const expanded = new Set(["c2"]);
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);

    expect(result).toEqual({ id: "c1", type: "cabinet" });
  });

  it("should handle simple 1-level depth", () => {
    // S2 is in C3 (Root).
    // C3 is expanded -> Highlight S2.
    let expanded = new Set(["c3"]);
    let result = getVisibleActiveNodeId("s2", streams, cabinets, expanded);
    expect(result).toEqual({ id: "s2", type: "stream" });

    // C3 is collapsed -> Highlight C3.
    expanded = new Set();
    result = getVisibleActiveNodeId("s2", streams, cabinets, expanded);
    expect(result).toEqual({ id: "c3", type: "cabinet" });
  });
});

describe("resolveCreationTarget", () => {
  const s1 = createStream("s1", "c1");

  it("returns root for cabinet creation at root button", () => {
    const result = resolveCreationTarget({
      kind: "cabinet",
      buttonCabinetId: null,
      activeStreamId: "s1",
      streams: [s1],
    });

    expect(result).toEqual({ parentCabinetId: null });
  });

  it("returns nested parent for cabinet creation inside a cabinet", () => {
    const result = resolveCreationTarget({
      kind: "cabinet",
      buttonCabinetId: "c1",
      activeStreamId: undefined,
      streams: [s1],
    });

    expect(result).toEqual({ parentCabinetId: "c1" });
  });

  it("returns target cabinet for stream creation in a cabinet", () => {
    const result = resolveCreationTarget({
      kind: "stream",
      buttonCabinetId: "c1",
      activeStreamId: undefined,
      streams: [s1],
    });

    expect(result).toEqual({ parentCabinetId: "c1", targetCabinetId: "c1" });
  });

  it("allows root stream creation when no cabinet is specified (mixed entities)", () => {
    const result = resolveCreationTarget({
      kind: "stream",
      buttonCabinetId: null,
      activeStreamId: undefined,
      streams: [],
    });

    // Should return null targetCabinetId (meaning root), no error
    expect(result.error).toBeUndefined();
    expect(result.targetCabinetId).toBeNull();
  });

  it("falls back to active stream cabinet when no button context", () => {
    const result = resolveCreationTarget({
      kind: "stream",
      buttonCabinetId: undefined,
      activeStreamId: "s1",
      streams: [s1],
    });

    expect(result).toEqual({ parentCabinetId: "c1", targetCabinetId: "c1" });
  });

  it("defaults to root when stream creation has no target", () => {
    const result = resolveCreationTarget({
      kind: "stream",
      buttonCabinetId: undefined,
      activeStreamId: undefined,
      streams: [],
    });

    expect(result.error).toBeUndefined();
    expect(result.targetCabinetId).toBeNull();
  });
});

describe("isCreationAllowed", () => {
  it("allows root stream creation when no restriction is set", () => {
    const target = { parentCabinetId: null, targetCabinetId: null };
    expect(isCreationAllowed(target, undefined)).toBe(true);
    expect(isCreationAllowed(target, {})).toBe(true);
  });

  it("allows root stream creation when restriction is not cabinet-only", () => {
    const target = { parentCabinetId: null, targetCabinetId: null };
    expect(
      isCreationAllowed(target, { root_restriction: "something-else" }),
    ).toBe(true);
  });

  it("disallows root stream creation when restriction is cabinet-only", () => {
    const target = { parentCabinetId: null, targetCabinetId: null };
    expect(
      isCreationAllowed(target, { root_restriction: "cabinet-only" }),
    ).toBe(false);
  });

  it("allows nested stream creation even when restriction is cabinet-only", () => {
    const target = { parentCabinetId: "c1", targetCabinetId: "c1" };
    expect(
      isCreationAllowed(target, { root_restriction: "cabinet-only" }),
    ).toBe(true);
  });

  it("returns false if target has error", () => {
    const target = { parentCabinetId: null, error: "some error" };
    expect(isCreationAllowed(target, undefined)).toBe(false);
  });
});

describe("creation helpers", () => {
  it("generates a unique name with a numeric suffix", () => {
    const name = getUniqueName("New Cabinet", ["New Cabinet", "New Cabinet 2"]);
    expect(name).toBe("New Cabinet 3");
  });

  it("returns next sort order for existing items", () => {
    const next = getNextSortOrder([{ sort_order: 0 }, { sort_order: 3 }]);
    expect(next).toBe(4);
  });
});

describe("creation integration", () => {
  it("adds a new cabinet at root for empty directories", () => {
    const newCabinet = createCabinet("c-new");
    const result = applyOptimisticCabinetCreation([], newCabinet);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c-new");
  });

  it("adds a nested cabinet and keeps sort order", () => {
    const c1 = createCabinet("c1");
    const c2 = { ...createCabinet("c2", "c1"), sort_order: 5 };
    const c3 = { ...createCabinet("c3", "c1"), sort_order: 2 };
    const result = applyOptimisticCabinetCreation([c2, c3], c1);
    expect(result.map((cabinet) => cabinet.sort_order)).toEqual([0, 2, 5]);
  });

  it("adds a stream under the correct cabinet", () => {
    const stream = createStream("s-new", "c1");
    const result = applyOptimisticStreamCreation([], stream);
    expect(result).toHaveLength(1);
    expect(result[0].cabinet_id).toBe("c1");
  });
});
