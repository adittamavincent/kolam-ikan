"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowUpRight,
  Camera,
  Clock3,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  MoreHorizontal,
  PencilLine,
  Tag as TagIcon,
} from "lucide-react";

interface GraphNode {
  id: string;
  row: number;
  date: Date;
  shortHash: string;
  nodeType: "entry" | "canvas_snapshot";
  commitId: string | null;
  sourceEntryId: string | null;
  snapshotName: string | null;
  snapshotBranchName: string | null;
  isHead: boolean;
  tag?: string;
  entryKind: string;
  mergeSourceCommitId: string | null;
  mergeSourceBranchName: string | null;
  parentCommitId: string | null;
  lane: number;
  color: string;
}

interface BranchRef {
  id: string;
  name: string;
  color: string;
  headCommitId: string;
}

interface CommitGraphProps {
  currentStreamId: string;
  currentBranch: string;
  tags: Record<string, string>;
  latestEntryId: string | null;
  onEntryClick?: (streamId: string, entryId: string) => void;
  onBranchCheckout?: (branchName: string) => void;
  onBranchMergeIntoCurrent?: (branchName: string) => void;
  onBranchRename?: (branchId: string, branchName: string) => void;
}

const ROW_H = 82;
const LANE_GAP = 18;
const GRAPH_PAD_X = 24;
const DOT_R = 6;

const BRANCH_COLORS = [
  "#568af2",
  "#26b88f",
  "#f59e0b",
  "#db7093",
  "#8b7cf7",
  "#06b6d4",
  "#84cc16",
  "#ef5c5c",
];

function shortHash(id: string): string {
  return id.replace(/-/g, "").slice(0, 7);
}

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 14) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatAbsoluteDate(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const hexValue =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(hexValue)) return hex;

  const intValue = Number.parseInt(hexValue, 16);
  const r = (intValue >> 16) & 255;
  const g = (intValue >> 8) & 255;
  const b = intValue & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface GraphEdge {
  key: string;
  kind: "parent" | "merge";
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
  color: string;
}

function laneX(lane: number): number {
  return GRAPH_PAD_X + lane * LANE_GAP;
}

function compareBranchNames(a: string, b: string): number {
  if (a === "main") return -1;
  if (b === "main") return 1;
  return a.localeCompare(b);
}

function buildEdgePath(edge: GraphEdge): string {
  const x1 = laneX(edge.fromLane);
  const x2 = laneX(edge.toLane);
  const y1 = edge.fromRow * ROW_H + ROW_H / 2;
  const y2 = edge.toRow * ROW_H + ROW_H / 2;

  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  if (edge.kind === "merge") {
    const mergeBendY = Math.min(y2 - 12, y1 + ROW_H * 0.8);
    const curveMidY = y1 + (mergeBendY - y1) * 0.6;
    return `M ${x1} ${y1} C ${x1} ${curveMidY}, ${x2} ${curveMidY}, ${x2} ${mergeBendY} L ${x2} ${y2}`;
  }

  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function CommitGraph({
  currentStreamId,
  currentBranch,
  tags,
  latestEntryId,
  onEntryClick,
  onBranchCheckout,
  onBranchMergeIntoCurrent,
  onBranchRename,
}: CommitGraphProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [branchMenu, setBranchMenu] = useState<{
    branch: BranchRef;
    x: number;
    y: number;
  } | null>(null);
  const [branchMenuPosition, setBranchMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const branchMenuRef = useRef<HTMLDivElement | null>(null);

  const { data: branches } = useQuery({
    queryKey: ["graph-branches", currentStreamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, created_at, head_commit_id")
        .eq("stream_id", currentStreamId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!currentStreamId,
  });

  const orderedBranches = useMemo(() => {
    if (!branches) return [];

    return [...branches]
      .sort((a, b) => {
        if (a.name === "main") return -1;
        if (b.name === "main") return 1;
        return (
          new Date(a.created_at ?? 0).getTime() -
          new Date(b.created_at ?? 0).getTime()
        );
      })
      .map((branch, index) => ({
        ...branch,
        color: BRANCH_COLORS[index % BRANCH_COLORS.length],
      }));
  }, [branches]);

  const { data: rawEntries } = useQuery({
    queryKey: ["graph-entries", currentStreamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entries")
        .select(
          "id, created_at, parent_commit_id, entry_kind, merge_source_commit_id, merge_source_branch_name",
        )
        .eq("stream_id", currentStreamId)
        .eq("is_draft", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Array<{
        id: string;
        created_at: string | null;
        parent_commit_id: string | null;
        entry_kind: string | null;
        merge_source_commit_id: string | null;
        merge_source_branch_name: string | null;
      }>;
    },
    enabled: !!currentStreamId,
    refetchOnMount: "always",
  });

  const { data: rawCanvasVersions } = useQuery({
    queryKey: ["graph-canvas-versions", currentStreamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_versions")
        .select("id, created_at, name, branch_name, source_entry_id")
        .eq("stream_id", currentStreamId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Array<{
        id: string;
        created_at: string | null;
        name: string | null;
        branch_name: string | null;
        source_entry_id: string | null;
      }>;
    },
    enabled: !!currentStreamId,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!currentStreamId) return;

    const entriesChannel = supabase
      .channel(`stream-graph:${currentStreamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries" },
        (payload) => {
          const next =
            (payload.new as { stream_id?: string } | null) ??
            (payload.old as { stream_id?: string } | null);

          if (next?.stream_id === currentStreamId) {
            queryClient.invalidateQueries({
              queryKey: ["graph-entries", currentStreamId],
            });
          }
        },
      )
      .subscribe();

    const branchChannel = supabase
      .channel(`stream-graph-branches:${currentStreamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "branches" },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["graph-branches", currentStreamId],
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "canvas_versions" },
        (payload) => {
          const next =
            (payload.new as { stream_id?: string } | null) ??
            (payload.old as { stream_id?: string } | null);

          if (next?.stream_id === currentStreamId) {
            queryClient.invalidateQueries({
              queryKey: ["graph-canvas-versions", currentStreamId],
            });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries" },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["graph-entries", currentStreamId],
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(entriesChannel);
      supabase.removeChannel(branchChannel);
    };
  }, [currentStreamId, queryClient, supabase]);

  const branchRefsByCommitId = useMemo(() => {
    const map = new Map<string, BranchRef[]>();
    for (const branch of orderedBranches) {
      if (!branch.head_commit_id) continue;
      const existing = map.get(branch.head_commit_id) ?? [];
      existing.push({
        id: branch.id,
        name: branch.name,
        color: branch.color,
        headCommitId: branch.head_commit_id,
      });
      map.set(branch.head_commit_id, existing);
    }

    for (const refs of map.values()) {
      refs.sort((a, b) => compareBranchNames(a.name, b.name));
    }

    if (!orderedBranches.some((branch) => branch.name === "main") && latestEntryId) {
      const existing = map.get(latestEntryId) ?? [];
      if (!existing.some((ref) => ref.name === "main")) {
        existing.unshift({
          id: "__main__",
          name: "main",
          color: BRANCH_COLORS[0],
          headCommitId: latestEntryId,
        });
        map.set(latestEntryId, existing);
      }
    }

    return map;
  }, [latestEntryId, orderedBranches]);

  const { nodes, edges, laneCount } = useMemo(() => {
    if (!rawEntries) {
      return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], laneCount: 1 };
    }

    const graphRows = [
      ...rawEntries.map((entry) => ({
        nodeType: "entry" as const,
        graphId: `entry:${entry.id}`,
        rawId: entry.id,
        createdAt: entry.created_at,
      })),
      ...(rawCanvasVersions ?? []).map((snapshot) => ({
        nodeType: "canvas_snapshot" as const,
        graphId: `canvas:${snapshot.id}`,
        rawId: snapshot.id,
        createdAt: snapshot.created_at,
      })),
    ].sort((a, b) => {
      const dateA = new Date(a.createdAt ?? 0).getTime();
      const dateB = new Date(b.createdAt ?? 0).getTime();
      if (dateA !== dateB) return dateB - dateA;
      return b.rawId.localeCompare(a.rawId);
    });

    const entryById = new Map(rawEntries.map((entry) => [entry.id, entry]));
    const snapshotById = new Map(
      (rawCanvasVersions ?? []).map((snapshot) => [snapshot.id, snapshot]),
    );
    const rowById = new Map(graphRows.map((row, index) => [row.graphId, index]));
    const colorByCommitId = new Map<string, string>();

    const effectiveBranches = [...orderedBranches];
    if (!effectiveBranches.some((branch) => branch.name === "main") && latestEntryId) {
      effectiveBranches.unshift({
        id: "__main__",
        name: "main",
        created_at: null,
        head_commit_id: latestEntryId,
        color: BRANCH_COLORS[0],
      });
    }

    // Build a stable color hint by tracing each branch ancestry, independent of lane layout.
    effectiveBranches.forEach((branch) => {
      let cursor = branch.head_commit_id ?? null;

      while (cursor) {
        if (!colorByCommitId.has(cursor)) {
          colorByCommitId.set(cursor, branch.color);
        }
        cursor = entryById.get(cursor)?.parent_commit_id ?? null;
      }
    });

    const activeCommitByLane: Array<string | null> = [];
    const nextNodes: GraphNode[] = [];
    const nextEdges: GraphEdge[] = [];
    let maxLaneCount = 1;

    graphRows.forEach((graphRow, row) => {
      const entry =
        graphRow.nodeType === "entry"
          ? entryById.get(graphRow.rawId) ?? null
          : null;
      const snapshot =
        graphRow.nodeType === "canvas_snapshot"
          ? snapshotById.get(graphRow.rawId) ?? null
          : null;

      const desiredCommitId =
        graphRow.nodeType === "entry"
          ? `entry:${graphRow.rawId}`
          : snapshot?.source_entry_id
            ? `entry:${snapshot.source_entry_id}`
            : null;

      let lane =
        desiredCommitId
          ? activeCommitByLane.findIndex((commitId) => commitId === desiredCommitId)
          : -1;
      if (lane === -1) {
        lane = activeCommitByLane.findIndex((commitId) => commitId === null);
      }
      if (lane === -1) {
        lane = activeCommitByLane.length;
        activeCommitByLane.push(desiredCommitId);
      } else {
        activeCommitByLane[lane] = desiredCommitId;
      }

      const refs = entry ? branchRefsByCommitId.get(entry.id) ?? [] : [];
      const color =
        refs[0]?.color ??
        (entry ? colorByCommitId.get(entry.id) : undefined) ??
        (graphRow.nodeType === "canvas_snapshot" ? "#a855f7" : undefined) ??
        BRANCH_COLORS[lane % BRANCH_COLORS.length];

      nextNodes.push({
        id: graphRow.graphId,
        row,
        date: new Date(graphRow.createdAt ?? 0),
        shortHash: shortHash(graphRow.rawId),
        nodeType: graphRow.nodeType,
        commitId: entry?.id ?? null,
        sourceEntryId: snapshot?.source_entry_id ?? null,
        snapshotName: snapshot?.name ?? null,
        snapshotBranchName: snapshot?.branch_name ?? null,
        isHead: entry?.id === latestEntryId,
        tag: entry ? tags[entry.id] : undefined,
        entryKind:
          graphRow.nodeType === "entry" ? entry?.entry_kind ?? "commit" : "canvas_snapshot",
        mergeSourceCommitId: entry?.merge_source_commit_id ?? null,
        mergeSourceBranchName: entry?.merge_source_branch_name ?? null,
        parentCommitId: entry?.parent_commit_id ?? null,
        lane,
        color,
      });

      const primaryParentId =
        graphRow.nodeType === "entry"
          ? (entry?.parent_commit_id ?? null)
          : (snapshot?.source_entry_id ?? null);
      if (primaryParentId) {
        const parentGraphId = `entry:${primaryParentId}`;
        const parentRow = rowById.get(parentGraphId);
        if (parentRow === undefined) {
          activeCommitByLane[lane] = null;
        } else {
        const existingParentLane = activeCommitByLane.findIndex(
          (commitId, laneIndex) => laneIndex !== lane && commitId === parentGraphId,
        );
        const parentLane = existingParentLane >= 0 ? existingParentLane : lane;

        nextEdges.push({
          key: `parent-${graphRow.graphId}`,
          kind: "parent",
          fromLane: lane,
          toLane: parentLane,
          fromRow: row,
          toRow: parentRow,
          color,
        });

        if (existingParentLane >= 0) {
          activeCommitByLane[lane] = null;
        } else {
          activeCommitByLane[lane] = parentGraphId;
        }
        }
      } else {
        activeCommitByLane[lane] = null;
      }

      if (entry?.merge_source_commit_id) {
        const mergeSourceGraphId = `entry:${entry.merge_source_commit_id}`;
        const mergeSourceRow = rowById.get(mergeSourceGraphId);
        if (mergeSourceRow === undefined) {
          // Merge source outside loaded set; skip edge for this viewport.
        } else {
        const existingMergeLane = activeCommitByLane.findIndex(
          (commitId) => commitId === mergeSourceGraphId,
        );

        let mergeSourceLane = existingMergeLane;
        if (mergeSourceLane === -1) {
          mergeSourceLane = activeCommitByLane.findIndex(
            (commitId, laneIndex) => commitId === null && laneIndex > lane,
          );
        }
        if (mergeSourceLane === -1) {
          mergeSourceLane = activeCommitByLane.findIndex((commitId) => commitId === null);
        }
        if (mergeSourceLane === -1) {
          mergeSourceLane = activeCommitByLane.length;
          activeCommitByLane.push(mergeSourceGraphId);
        } else if (activeCommitByLane[mergeSourceLane] === null) {
          activeCommitByLane[mergeSourceLane] = mergeSourceGraphId;
        }

        const mergeSourceRefs = branchRefsByCommitId.get(entry.merge_source_commit_id) ?? [];
        const mergeSourceColor =
          mergeSourceRefs[0]?.color ??
          colorByCommitId.get(entry.merge_source_commit_id) ??
          BRANCH_COLORS[mergeSourceLane % BRANCH_COLORS.length];

        nextEdges.push({
          key: `merge-${graphRow.graphId}-${entry.merge_source_commit_id}`,
          kind: "merge",
          fromLane: lane,
          toLane: mergeSourceLane,
          fromRow: row,
          toRow: mergeSourceRow,
          color: mergeSourceColor,
        });
        }
      }

      while (
        activeCommitByLane.length > 0 &&
        activeCommitByLane[activeCommitByLane.length - 1] === null
      ) {
        activeCommitByLane.pop();
      }

      maxLaneCount = Math.max(maxLaneCount, activeCommitByLane.length, lane + 1);
    });

    return {
      nodes: nextNodes,
      edges: nextEdges,
      laneCount: maxLaneCount,
    };
  }, [
    branchRefsByCommitId,
    latestEntryId,
    orderedBranches,
    rawCanvasVersions,
    rawEntries,
    tags,
  ]);

  const graphWidth = Math.max(72, GRAPH_PAD_X * 2 + (laneCount - 1) * LANE_GAP);
  const graphHeight = Math.max(nodes.length * ROW_H, ROW_H);

  const onlyMainBranchMode =
    orderedBranches.length === 1 && orderedBranches[0]?.name === "main";
  const useVirtualMainRef = onlyMainBranchMode && nodes.length > 0;

  const virtualRefsByNodeId = useMemo(() => {
    const map = new Map<string, BranchRef[]>();
    if (!useVirtualMainRef) return map;

    const mainBranch = orderedBranches[0] ?? null;
    const latestNode = nodes[0] ?? null;
    if (!latestNode) return map;

    map.set(latestNode.id, [
      {
        id: mainBranch?.id ?? "__main__",
        name: "main",
        color: mainBranch?.color ?? BRANCH_COLORS[0],
        headCommitId:
          latestNode.commitId ?? latestNode.sourceEntryId ?? latestEntryId ?? "",
      },
    ]);

    return map;
  }, [latestEntryId, nodes, orderedBranches, useVirtualMainRef]);

  const getNodeRefs = useCallback(
    (node: GraphNode) => {
      const commitRefs = node.commitId
        ? branchRefsByCommitId.get(node.commitId) ?? []
        : [];
      const filteredCommitRefs = useVirtualMainRef
        ? commitRefs.filter((ref) => ref.name !== "main")
        : commitRefs;
      const virtualRefs = virtualRefsByNodeId.get(node.id) ?? [];

      if (virtualRefs.length === 0) return filteredCommitRefs;
      if (filteredCommitRefs.length === 0) return virtualRefs;

      const merged = [...filteredCommitRefs];
      for (const ref of virtualRefs) {
        if (!merged.some((item) => item.name === ref.name)) {
          merged.push(ref);
        }
      }
      return merged;
    },
    [branchRefsByCommitId, useVirtualMainRef, virtualRefsByNodeId],
  );

  const clampMenuPosition = useCallback(
    (x: number, y: number, menuWidth: number, menuHeight: number) => {
      if (typeof window === "undefined") return { left: x, top: y };

      const VIEWPORT_PADDING = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let nextLeft = x;
      let nextTop = y;

      if (nextLeft + menuWidth + VIEWPORT_PADDING > viewportWidth) {
        nextLeft = viewportWidth - menuWidth - VIEWPORT_PADDING;
      }

      if (nextTop + menuHeight + VIEWPORT_PADDING > viewportHeight) {
        nextTop = viewportHeight - menuHeight - VIEWPORT_PADDING;
      }

      return {
        left: Math.max(VIEWPORT_PADDING, nextLeft),
        top: Math.max(VIEWPORT_PADDING, nextTop),
      };
    },
    [],
  );

  const recalculateBranchMenuPosition = useCallback(() => {
    if (!branchMenu || typeof window === "undefined" || !branchMenuRef.current) {
      return;
    }

    const menuRect = branchMenuRef.current.getBoundingClientRect();
    const next = clampMenuPosition(
      branchMenu.x,
      branchMenu.y,
      menuRect.width,
      menuRect.height,
    );

    setBranchMenuPosition((prev) =>
      prev.left === next.left && prev.top === next.top ? prev : next,
    );
  }, [branchMenu, clampMenuPosition]);

  useLayoutEffect(() => {
    if (!branchMenu) return;
    recalculateBranchMenuPosition();
  }, [branchMenu, recalculateBranchMenuPosition]);

  useEffect(() => {
    if (!branchMenu || typeof window === "undefined") return;

    const handleViewportChange = () => {
      recalculateBranchMenuPosition();
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (!branchMenuRef.current) return;
      const targetNode = event.target as Node | null;
      if (targetNode && !branchMenuRef.current.contains(targetNode)) {
        setBranchMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBranchMenu(null);
      }
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [branchMenu, recalculateBranchMenuPosition]);

  const openBranchMenu = useCallback(
    (event: Pick<MouseEvent, "clientX" | "clientY">, branch: BranchRef) => {
      const estimated = clampMenuPosition(event.clientX, event.clientY, 220, 190);
      setBranchMenuPosition(estimated);
      setBranchMenu({ branch, x: event.clientX, y: event.clientY });
    },
    [clampMenuPosition],
  );

  const handleBranchMenuAction = useCallback(
    async (action: "open" | "checkout" | "merge" | "rename" | "copy-sha") => {
      if (!branchMenu) return;

      const {
        branch: { headCommitId, id, name },
      } = branchMenu;
      setBranchMenu(null);

      switch (action) {
        case "open":
          if (headCommitId) onEntryClick?.(currentStreamId, headCommitId);
          return;
        case "checkout":
          onBranchCheckout?.(name);
          return;
        case "merge":
          onBranchMergeIntoCurrent?.(name);
          return;
        case "rename":
          onBranchRename?.(id, name);
          return;
        case "copy-sha":
          if (headCommitId) {
            await navigator.clipboard.writeText(headCommitId);
          }
          return;
      }
    },
    [
      branchMenu,
      currentStreamId,
      onBranchCheckout,
      onBranchMergeIntoCurrent,
      onBranchRename,
      onEntryClick,
    ],
  );

  if (!nodes.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-text-muted">
        <GitCommitHorizontal className="h-4 w-4" />
        <div>No commits to display</div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-y-auto overflow-x-hidden bg-surface-default">
      {orderedBranches.length > 0 && (
        <div className="sticky top-0 z-20 border-b border-border-default/50 bg-surface-default/95 px-3 py-2 backdrop-blur-sm">
          <div className="flex gap-1.5 overflow-x-auto">
            {orderedBranches.map((branch) => {
              const virtualMainNode =
                useVirtualMainRef && branch.name === "main" ? nodes[0] : null;
              const headCommitId =
                virtualMainNode?.commitId ??
                virtualMainNode?.sourceEntryId ??
                branch.head_commit_id ??
                null;
              const headHash = virtualMainNode
                ? virtualMainNode.shortHash
                : headCommitId
                  ? shortHash(headCommitId)
                  : "------";

              return (
                <button
                  key={branch.id}
                  type="button"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openBranchMenu(event.nativeEvent, {
                      id: branch.id,
                      name: branch.name,
                      color: branch.color,
                      headCommitId: headCommitId ?? "",
                    });
                  }}
                  className={`grid min-w-[124px] grid-cols-[1fr_auto] items-center gap-x-1.5 gap-y-0.5 border px-2 py-1 text-left transition-colors ${
                    currentBranch === branch.name
                      ? "border-action-primary-bg/35 bg-action-primary-bg/10"
                      : "border-border-default/50 bg-surface-default hover:bg-surface-hover"
                  }`}
                  style={{ boxShadow: `inset 3px 0 0 ${branch.color}` }}
                  onClick={() => {
                    if (branch.name !== currentBranch) {
                      onBranchCheckout?.(branch.name);
                    }
                  }}
                  title={
                    branch.name === currentBranch
                      ? `${branch.name} is checked out`
                      : `Checkout ${branch.name}`
                  }
                >
                  <span className="col-start-1 row-start-1 inline-flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0"
                      style={{ backgroundColor: branch.color }}
                    />
                    <span className="truncate text-[11px] font-semibold text-text-default">
                      {branch.name}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Branch actions for ${branch.name}`}
                    className="col-start-2 row-start-1 inline-flex h-5 w-5 items-center justify-center border border-transparent text-text-muted transition-colors hover:border-border-default/50 hover:bg-surface-subtle hover:text-text-default"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openBranchMenu(
                        {
                          clientX: rect.right,
                          clientY: rect.bottom + 4,
                        },
                        {
                          id: branch.id,
                          name: branch.name,
                          color: branch.color,
                          headCommitId: headCommitId ?? "",
                        },
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openBranchMenu(
                        {
                          clientX: rect.right,
                          clientY: rect.bottom + 4,
                        },
                        {
                          id: branch.id,
                          name: branch.name,
                          color: branch.color,
                          headCommitId: headCommitId ?? "",
                        },
                      );
                    }}
                    title={`Open branch actions for ${branch.name}`}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </span>
                  <code className="col-span-2 col-start-1 row-start-2 w-fit bg-surface-subtle px-1 py-0.5 text-[9px] text-text-muted">
                    {headHash}
                  </code>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative w-full min-w-0">
        {branchMenu &&
          createPortal(
            <div
              ref={branchMenuRef}
              className="fixed z-40 w-56 overflow-hidden border border-border-default bg-surface-elevated p-1"
              style={{
                left: branchMenuPosition.left,
                top: branchMenuPosition.top,
              }}
            >
              <div className="border-b border-border-subtle px-2 py-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-text-default">
                  <GitBranch className="h-3.5 w-3.5" />
                  {branchMenu.branch.name}
                </div>
                <code className="mt-1 block text-[10px] text-text-muted">
                  {branchMenu.branch.headCommitId
                    ? shortHash(branchMenu.branch.headCommitId)
                    : "no head"}
                </code>
              </div>
              <button
                onClick={() => void handleBranchMenuAction("open")}
                disabled={!branchMenu.branch.headCommitId}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
                Open head commit
              </button>
              <button
                onClick={() => void handleBranchMenuAction("checkout")}
                disabled={branchMenu.branch.name === currentBranch}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GitBranch className="h-3.5 w-3.5 text-text-muted" />
                Checkout branch
              </button>
              <button
                onClick={() => void handleBranchMenuAction("merge")}
                disabled={branchMenu.branch.name === currentBranch}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GitMerge className="h-3.5 w-3.5 text-text-muted" />
                Merge into {currentBranch}
              </button>
              <button
                onClick={() => void handleBranchMenuAction("rename")}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
              >
                <PencilLine className="h-3.5 w-3.5 text-text-muted" />
                Rename branch
              </button>
              <button
                onClick={() => void handleBranchMenuAction("copy-sha")}
                disabled={!branchMenu.branch.headCommitId}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5 text-text-muted" />
                Copy head SHA
              </button>
            </div>,
            document.body,
          )}
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={graphWidth}
          height={graphHeight}
          aria-hidden="true"
        >
          {Array.from({ length: nodes.length }).map((_, index) => {
            const y = (index + 1) * ROW_H - 0.5;
            return (
              <line
                key={`row-${index}`}
                x1={0}
                y1={y}
                x2={graphWidth}
                y2={y}
                stroke="var(--border-subtle)"
                strokeOpacity={0.3}
              />
            );
          })}

          {edges.map((edge) => {
            const isRelated =
              hoveredId === null ||
              nodes[edge.fromRow]?.id === hoveredId ||
              nodes[edge.toRow]?.id === hoveredId;

            return (
              <path
                key={edge.key}
                d={buildEdgePath(edge)}
                fill="none"
                stroke={edge.color}
                strokeOpacity={isRelated ? 0.95 : 0.35}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            );
          })}

          {nodes.map((node) => {
            const y = node.row * ROW_H + ROW_H / 2;
            const isHovered = hoveredId === node.id;
            const refs = getNodeRefs(node);
            const nodeColor = refs[0]?.color ?? node.color;
            const x = laneX(node.lane);

            return (
              <g key={node.id} opacity={hoveredId && !isHovered ? 0.5 : 1}>
                {node.isHead && (
                  <circle
                    cx={x}
                    cy={y}
                    r={DOT_R + 7}
                    fill={toRgba(
                      typeof nodeColor === "string" ? nodeColor : "#568af2",
                      0.14,
                    )}
                  />
                )}

                {isHovered && (
                  <circle
                    cx={x}
                    cy={y}
                    r={DOT_R + 10}
                    fill={toRgba(
                      typeof nodeColor === "string" ? nodeColor : "#568af2",
                      0.1,
                    )}
                  />
                )}

                <circle
                  cx={x}
                  cy={y}
                  r={DOT_R + 1}
                  fill="var(--bg-surface-default)"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={DOT_R}
                  fill={node.isHead ? nodeColor : "var(--bg-surface-default)"}
                  stroke={nodeColor}
                  strokeWidth={2}
                />
                {!node.isHead && (
                  <circle
                    cx={x}
                    cy={y}
                    r={DOT_R - 2}
                    fill={toRgba(nodeColor, 0.45)}
                  />
                )}
              </g>
            );
          })}
        </svg>

        <div className="relative">
          {nodes.map((node) => {
            const refs = getNodeRefs(node);
            const isHovered = hoveredId === node.id;
            const accent = refs[0]?.color ?? "#568af2";

            return (
              <button
                key={node.id}
                type="button"
                className="grid w-full min-w-0 items-center gap-3 px-3 text-left transition-opacity"
                style={{
                  minHeight: ROW_H,
                  gridTemplateColumns: `${graphWidth}px minmax(0, 1fr)`,
                  opacity: hoveredId && !isHovered ? 0.78 : 1,
                }}
                onClick={() => {
                  if (node.commitId) {
                    onEntryClick?.(currentStreamId, node.commitId);
                    return;
                  }

                  if (node.sourceEntryId) {
                    onEntryClick?.(currentStreamId, node.sourceEntryId);
                  }
                }}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={
                  node.nodeType === "entry"
                    ? `Open commit ${node.shortHash}`
                    : "Open linked commit in commit list"
                }
              >
                <div />

                <div
                  className="relative border border-border-default/60 bg-surface-default px-4 py-3 transition-all duration-150 hover:bg-surface-hover"
                  style={{
                    boxShadow: isHovered
                      ? `0 0 0 1px ${toRgba(accent, 0.2)}`
                      : undefined,
                    backgroundColor: isHovered
                      ? toRgba(accent, 0.045)
                      : undefined,
                  }}
                >
                  <span
                    className="absolute inset-y-0 left-0 w-1"
                    style={{ backgroundColor: accent }}
                  />

                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="bg-surface-subtle px-1.5 py-0.5 text-[11px] font-semibold text-text-default">
                          {node.shortHash}
                        </code>

                        {node.isHead && (
                          <span className="inline-flex items-center gap-1 border border-action-primary-bg/30 bg-action-primary-bg/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-action-primary-bg">
                            HEAD
                          </span>
                        )}

                        {node.tag && (
                          <span className="inline-flex items-center gap-1 border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                            <TagIcon className="h-3 w-3" />
                            {node.tag}
                          </span>
                        )}

                        {node.nodeType === "canvas_snapshot" && (
                          <span className="inline-flex items-center gap-1 border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-500">
                            <Camera className="h-3 w-3" />
                            canvas
                          </span>
                        )}

                        {node.entryKind === "merge" && (
                          <span className="inline-flex items-center gap-1 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                            <GitMerge className="h-3 w-3" />
                            merge
                          </span>
                        )}

                        {refs.map((ref) => (
                          <span
                            key={ref.id}
                            className="inline-flex items-center gap-1 border border-border-default/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                            style={{
                              color: ref.color,
                              backgroundColor: toRgba(ref.color, 0.1),
                            }}
                          >
                            <GitBranch className="h-3 w-3" />
                            {ref.name}
                          </span>
                        ))}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
                        <span className="inline-flex items-center gap-1">
                          {node.nodeType === "canvas_snapshot" ? (
                            <Camera className="h-3.5 w-3.5" />
                          ) : (
                            <GitCommitHorizontal className="h-3.5 w-3.5" />
                          )}
                          {node.nodeType === "canvas_snapshot"
                            ? node.snapshotName || "Canvas snapshot"
                            : refs.length > 0
                              ? `${refs.length} branch ref${refs.length === 1 ? "" : "s"} point here`
                              : "Stream history commit"}
                        </span>
                        {node.nodeType === "canvas_snapshot" && node.snapshotBranchName && (
                          <span className="inline-flex items-center gap-1">
                            <GitBranch className="h-3.5 w-3.5" />
                            on {node.snapshotBranchName}
                          </span>
                        )}
                        {node.entryKind === "merge" && node.mergeSourceBranchName && (
                          <span className="inline-flex items-center gap-1">
                            <GitMerge className="h-3.5 w-3.5" />
                            merged from {node.mergeSourceBranchName}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatAbsoluteDate(node.date)}
                        </span>
                      </div>
                    </div>

                    <div className="min-w-0 text-left sm:shrink-0 sm:text-right">
                      <div className="text-[11px] font-semibold text-text-default">
                        {relativeTime(node.date)}
                      </div>
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-text-muted">
                        {node.nodeType === "canvas_snapshot"
                          ? "Open linked commit in commit list"
                          : "Open in commit list"}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
