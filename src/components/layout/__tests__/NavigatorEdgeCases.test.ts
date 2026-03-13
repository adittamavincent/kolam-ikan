import { describe, it, expect } from "vitest";
import {
  getVisibleActiveNodeId,
  getUniqueName,
  getNextSortOrder,
  resolveCreationTarget,
  isCreationAllowed,
  applyOptimisticCabinetCreation,
  applyOptimisticStreamCreation,
} from "@/lib/utils/navigation";
import { Cabinet, Stream } from "@/lib/types";

// --- Test Personas ---
// Ibu Sari builds deep hierarchies (4+ levels)
// Raka creates name collisions and tests edge cases

const createCabinet = (
  id: string,
  parentId: string | null = null,
  sortOrder = 0,
  name?: string,
): Cabinet => ({
  id,
  parent_id: parentId,
  name: name || `Cabinet ${id}`,
  domain_id: "domain-1",
  sort_order: sortOrder,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
});

const createStream = (
  id: string,
  cabinetId: string | null,
  sortOrder = 0,
  name?: string,
): Stream => ({
  id,
  cabinet_id: cabinetId,
  domain_id: "domain-1",
  name: name || `Stream ${id}`,
  stream_kind: "REGULAR",
  is_system_global: false,
  sort_order: sortOrder,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  description: null,
});

// ===== DEEP NESTING TESTS (Ibu Sari's lesson hierarchy) =====
describe("getVisibleActiveNodeId - deep nesting (4+ levels)", () => {
  // Ibu Sari's structure:
  // Semester 1 (C1)
  //  └─ Bab 1 - Ekologi (C2)
  //      └─ Materi Ajar (C3)
  //          └─ Sub Bab (C4)
  //              └─ Rantai Makanan (S1)

  const c1 = createCabinet("c1", null, 0, "Semester 1");
  const c2 = createCabinet("c2", "c1", 0, "Bab 1 - Ekologi");
  const c3 = createCabinet("c3", "c2", 0, "Materi Ajar");
  const c4 = createCabinet("c4", "c3", 0, "Sub Bab");
  const s1 = createStream("s1", "c4", 0, "Rantai Makanan");

  const cabinets = [c1, c2, c3, c4];
  const streams = [s1];

  it("highlights stream when all 4 parent levels are expanded", () => {
    const expanded = new Set(["c1", "c2", "c3", "c4"]);
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);
    expect(result).toEqual({ id: "s1", type: "stream" });
  });

  it("bubbles up to level 4 cabinet when only it is collapsed", () => {
    const expanded = new Set(["c1", "c2", "c3"]);
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);
    expect(result).toEqual({ id: "c4", type: "cabinet" });
  });

  it("bubbles up to level 3 when levels 3 and 4 are collapsed", () => {
    const expanded = new Set(["c1", "c2"]);
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);
    expect(result).toEqual({ id: "c3", type: "cabinet" });
  });

  it("bubbles all the way to root when everything is collapsed", () => {
    const expanded = new Set<string>();
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);
    expect(result).toEqual({ id: "c1", type: "cabinet" });
  });

  it("bubbles to root even if deep children are expanded but root is collapsed", () => {
    // c1 is collapsed but c2, c3, c4 are expanded — doesn't matter
    const expanded = new Set(["c2", "c3", "c4"]);
    const result = getVisibleActiveNodeId("s1", streams, cabinets, expanded);
    expect(result).toEqual({ id: "c1", type: "cabinet" });
  });
});

// ===== ROOT STREAM TESTS =====
describe("getVisibleActiveNodeId - root-level streams", () => {
  const s_root = createStream("s-root", null, 0, "Root Stream");
  const streams = [s_root];
  const cabinets: Cabinet[] = [];

  it("highlights root stream with no cabinets at all", () => {
    const result = getVisibleActiveNodeId(
      "s-root",
      streams,
      cabinets,
      new Set(),
    );
    expect(result).toEqual({ id: "s-root", type: "stream" });
  });
});

// ===== NAME COLLISION TESTS (Raka creates duplicates) =====
describe("getUniqueName - collision scenarios", () => {
  it("returns base name when no collisions", () => {
    expect(getUniqueName("Notes", [])).toBe("Notes");
  });

  it("appends 2 for first collision", () => {
    expect(getUniqueName("Notes", ["Notes"])).toBe("Notes 2");
  });

  it("finds next available number in sequence", () => {
    expect(getUniqueName("Notes", ["Notes", "Notes 2", "Notes 3"])).toBe(
      "Notes 4",
    );
  });

  it("skips gaps and uses next available", () => {
    // Notes 2 is taken, Notes 3 is free, Notes 4 is taken
    expect(getUniqueName("Notes", ["Notes", "Notes 2"])).toBe("Notes 3");
  });

  it("handles names with special characters", () => {
    expect(getUniqueName("Bab (1)", ["Bab (1)"])).toBe("Bab (1) 2");
  });

  it("handles many collisions (Raka spam-creates)", () => {
    const existing = ["Notes"];
    for (let i = 2; i <= 20; i++) {
      existing.push(`Notes ${i}`);
    }
    expect(getUniqueName("Notes", existing)).toBe("Notes 21");
  });
});

// ===== SORT ORDER TESTS =====
describe("getNextSortOrder - edge cases", () => {
  it("returns 0 for undefined items", () => {
    expect(getNextSortOrder(undefined)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(getNextSortOrder([])).toBe(0);
  });

  it("returns max + 1", () => {
    expect(
      getNextSortOrder([
        { sort_order: 5 },
        { sort_order: 2 },
        { sort_order: 8 },
      ]),
    ).toBe(9);
  });

  it("handles items with sort_order of 0", () => {
    expect(getNextSortOrder([{ sort_order: 0 }])).toBe(1);
  });
});

// ===== OPTIMISTIC CREATION TESTS =====
describe("applyOptimisticCabinetCreation - sort integrity", () => {
  it("maintains sort order after insertion", () => {
    const c1 = createCabinet("c1", null, 0);
    const c2 = createCabinet("c2", null, 5);
    const newCab = createCabinet("c-new", null, 3);

    const result = applyOptimisticCabinetCreation([c1, c2], newCab);
    expect(result.map((c) => c.id)).toEqual(["c1", "c-new", "c2"]);
  });

  it("handles insertion into empty list", () => {
    const newCab = createCabinet("c-first", null, 0);
    const result = applyOptimisticCabinetCreation(undefined, newCab);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c-first");
  });
});

describe("applyOptimisticStreamCreation - sort integrity", () => {
  it("maintains sort order after stream insertion", () => {
    const s1 = createStream("s1", "c1", 0);
    const s2 = createStream("s2", "c1", 5);
    const newStream = createStream("s-new", "c1", 3);

    const result = applyOptimisticStreamCreation([s1, s2], newStream);
    expect(result.map((s) => s.id)).toEqual(["s1", "s-new", "s2"]);
  });
});

// ===== CREATION TARGET + PERMISSION TESTS =====
describe("resolveCreationTarget - edge cases", () => {
  it("handles stream creation when activeStreamId points to a root stream", () => {
    const rootStream = createStream("s-root", null);
    const result = resolveCreationTarget({
      kind: "stream",
      buttonCabinetId: undefined,
      activeStreamId: "s-root",
      streams: [rootStream],
    });
    // Should infer null cabinet from root stream
    expect(result.targetCabinetId).toBeNull();
  });

  it("handles cabinet creation with null buttonCabinetId (explicit root)", () => {
    const result = resolveCreationTarget({
      kind: "cabinet",
      buttonCabinetId: null,
      activeStreamId: undefined,
      streams: [],
    });
    expect(result.parentCabinetId).toBeNull();
  });
});

describe("isCreationAllowed - comprehensive", () => {
  it("blocks root stream when cabinet-only restriction is set", () => {
    const target = { parentCabinetId: null, targetCabinetId: null };
    expect(
      isCreationAllowed(target, { root_restriction: "cabinet-only" }),
    ).toBe(false);
  });

  it("allows nested stream even with cabinet-only restriction", () => {
    const target = { parentCabinetId: "c1", targetCabinetId: "c1" };
    expect(
      isCreationAllowed(target, { root_restriction: "cabinet-only" }),
    ).toBe(true);
  });

  it("allows everything when settings is undefined", () => {
    const target = { parentCabinetId: null, targetCabinetId: null };
    expect(isCreationAllowed(target, undefined)).toBe(true);
  });

  it("blocks when target has error regardless of settings", () => {
    const target = { parentCabinetId: null, error: "Something went wrong" };
    expect(isCreationAllowed(target, undefined)).toBe(false);
  });
});
