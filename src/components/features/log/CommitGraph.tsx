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
import { isSupabaseSchemaMismatchError } from "@/lib/supabase/schema-compat";
import {
  CommittedEntryStashItem,
  EntryCreatorStashItem,
  readCommittedEntryStash,
  readEntryCreatorStash,
  subscribeToStashChanges,
} from "@/lib/utils/stash";
import {
  ArrowUpRight,
  Archive,
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
  stashStoredAt: Date | null;
  shortHash: string;
  nodeType: "entry" | "canvas_snapshot" | "draft" | "stash";
  stashSource: "draft" | "entry" | null;
  commitId: string | null;
  sourceEntryId: string | null;
  snapshotName: string | null;
  snapshotBranchName: string | null;
  workspaceBranchName: string | null;
  workspaceSectionCount: number;
  workspaceHeadCommitId: string | null;
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
  committedStashEntryIds?: string[];
  onEntryClick?: (streamId: string, entryId: string) => void;
  onBranchCheckout?: (branchName: string) => void;
  onBranchMergeIntoCurrent?: (branchName: string) => void;
  onBranchRename?: (branchId: string, branchName: string) => void;
}

const ROW_H = 82;
const LANE_GAP = 18;

type GraphBranchRow = {
  id: string;
  name: string;
  created_at: string | null;
  head_commit_id: string | null;
};

type GraphEntryRow = {
  id: string;
  created_at: string | null;
  parent_commit_id: string | null;
  entry_kind: string | null;
  merge_source_commit_id: string | null;
  merge_source_branch_name: string | null;
};

type GraphCanvasRow = {
  id: string;
  created_at: string | null;
  name: string | null;
  branch_name: string | null;
  source_entry_id: string | null;
};

function isBranchHeadSchemaError(error: unknown): boolean {
  return isSupabaseSchemaMismatchError(error, ["head_commit_id"]);
}

function isGraphEntrySchemaError(error: unknown): boolean {
  return isSupabaseSchemaMismatchError(error, [
    "parent_commit_id",
    "merge_source_commit_id",
    "merge_source_branch_name",
  ]);
}

function isGraphCanvasSchemaError(error: unknown): boolean {
  return isSupabaseSchemaMismatchError(error, [
    "branch_name",
    "source_entry_id",
  ]);
}
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

function solidColor(hex: string): string {
  const normalized = hex.replace("#", "");
  const hexValue =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(hexValue)) return hex;
  return `#${hexValue.toLowerCase()}`;
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

function readDraftSectionCount(streamId: string): number {
  if (typeof window === "undefined") return 0;

  try {
    const raw = window.localStorage.getItem(`kolam_draft_v2_${streamId}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { sections?: Record<string, unknown> } | null;
    if (!parsed?.sections || typeof parsed.sections !== "object") return 0;
    return Object.keys(parsed.sections).length;
  } catch {
    return 0;
  }
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

type GraphRow =
  | {
      nodeType: "entry";
      graphId: string;
      rawId: string;
      createdAt: string | null;
      workspaceBranchName?: undefined;
      workspaceSectionCount?: undefined;
      workspaceHeadCommitId?: undefined;
    }
  | {
      nodeType: "canvas_snapshot";
      graphId: string;
      rawId: string;
      createdAt: string | null;
      workspaceBranchName?: undefined;
      workspaceSectionCount?: undefined;
      workspaceHeadCommitId?: undefined;
    }
  | {
      nodeType: "draft" | "stash";
      graphId: string;
      rawId: string;
      createdAt: string;
      stashStoredAt?: string;
      stashSource?: "draft" | "entry";
      sourceEntryId?: string | null;
      workspaceBranchName: string;
      workspaceSectionCount: number;
      workspaceHeadCommitId: string | null;
      parentCommitId?: string | null;
      mergeSourceCommitId?: string | null;
      mergeSourceBranchName?: string | null;
      entryKind?: string | null;
    };

export function CommitGraph({
  currentStreamId,
  currentBranch,
  tags,
  latestEntryId,
  committedStashEntryIds = [],
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
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<{
    draftSectionCount: number;
    draftStashItems: EntryCreatorStashItem[];
    committedStashItems: CommittedEntryStashItem[];
  }>({
    draftSectionCount: 0,
    draftStashItems: [],
    committedStashItems: [],
  });
  const branchMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!currentStreamId || typeof window === "undefined") return;

    const readWorkspaceSnapshot = () => {
      setWorkspaceSnapshot({
        draftSectionCount: readDraftSectionCount(currentStreamId),
        draftStashItems: readEntryCreatorStash(currentStreamId),
        committedStashItems: readCommittedEntryStash(currentStreamId),
      });
    };

    readWorkspaceSnapshot();
    return subscribeToStashChanges(currentStreamId, readWorkspaceSnapshot);
  }, [currentStreamId]);

  const { data: branches } = useQuery({
    queryKey: ["graph-branches", currentStreamId],
    queryFn: async () => {
      const buildBranchQuery = (selectClause: string) =>
        supabase
          .from("branches")
          .select(selectClause)
          .eq("stream_id", currentStreamId)
          .order("created_at", { ascending: true });

      const { data, error } = await buildBranchQuery(
        "id, name, created_at, head_commit_id",
      );

      if (error && isBranchHeadSchemaError(error)) {
        const fallback = await buildBranchQuery("id, name, created_at");
        if (fallback.error) throw fallback.error;
        return (
          ((fallback.data ?? []) as unknown as Array<
            Omit<GraphBranchRow, "head_commit_id">
          >)
        ).map((branch): GraphBranchRow => ({
          ...branch,
          head_commit_id: null,
        }));
      }

      if (error) throw error;
      return (data ?? []) as unknown as GraphBranchRow[];
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
      const buildEntriesQuery = (selectClause: string) =>
        supabase
          .from("entries")
          .select(selectClause)
          .eq("stream_id", currentStreamId)
          .eq("is_draft", false)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

      const { data, error } = await buildEntriesQuery(
        "id, created_at, parent_commit_id, entry_kind, merge_source_commit_id, merge_source_branch_name",
      );

      if (error && isGraphEntrySchemaError(error)) {
        const fallback = await buildEntriesQuery("id, created_at, entry_kind");
        if (fallback.error) throw fallback.error;
        return (
          ((fallback.data ?? []) as unknown as Array<{
            id: string;
            created_at: string | null;
            entry_kind: string | null;
          }>)
        ).map((entry): GraphEntryRow => ({
          ...entry,
          parent_commit_id: null,
          merge_source_commit_id: null,
          merge_source_branch_name: null,
        }));
      }

      if (error) throw error;
      return (data ?? []) as unknown as GraphEntryRow[];
    },
    enabled: !!currentStreamId,
    refetchOnMount: "always",
  });

  const { data: rawCanvasVersions } = useQuery({
    queryKey: ["graph-canvas-versions", currentStreamId],
    queryFn: async () => {
      const buildCanvasQuery = (selectClause: string) =>
        supabase
          .from("canvas_versions")
          .select(selectClause)
          .eq("stream_id", currentStreamId)
          .order("created_at", { ascending: false });

      const { data, error } = await buildCanvasQuery(
        "id, created_at, name, branch_name, source_entry_id",
      );

      if (error && isGraphCanvasSchemaError(error)) {
        const fallback = await buildCanvasQuery("id, created_at, name");
        if (fallback.error) throw fallback.error;
        return (
          ((fallback.data ?? []) as unknown as Array<{
            id: string;
            created_at: string | null;
            name: string | null;
          }>)
        ).map((snapshot): GraphCanvasRow => ({
          ...snapshot,
          branch_name: null,
          source_entry_id: null,
        }));
      }

      if (error) throw error;
      return (data ?? []) as unknown as GraphCanvasRow[];
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

  const currentBranchHeadCommitId = useMemo(() => {
    if (currentBranch === "main") {
      const mainBranch = orderedBranches.find((branch) => branch.name === "main");
      return mainBranch?.head_commit_id ?? latestEntryId ?? null;
    }

    return (
      orderedBranches.find((branch) => branch.name === currentBranch)?.head_commit_id ??
      null
    );
  }, [currentBranch, latestEntryId, orderedBranches]);

  const { nodes, edges, laneCount } = useMemo(() => {
    if (!rawEntries) {
      return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], laneCount: 1 };
    }

    const committedStashEntryIdSet = new Set(committedStashEntryIds);
    const visibleEntries = rawEntries.filter(
      (entry) => !committedStashEntryIdSet.has(entry.id),
    );

    const branchHeadByName = new Map(
      orderedBranches.map((branch) => [branch.name, branch.head_commit_id ?? null]),
    );
    if (!branchHeadByName.has("main")) {
      branchHeadByName.set("main", latestEntryId ?? null);
    }

    const graphRows: GraphRow[] = [
      ...(workspaceSnapshot.draftSectionCount > 0
        ? [{
            nodeType: "draft" as const,
            graphId: `draft:${currentBranch}`,
            rawId: currentBranch,
            createdAt: new Date().toISOString(),
            workspaceBranchName: currentBranch,
            workspaceSectionCount: workspaceSnapshot.draftSectionCount,
            workspaceHeadCommitId: currentBranchHeadCommitId,
          }]
        : []),
      ...workspaceSnapshot.draftStashItems.map((stash) => ({
        nodeType: "stash" as const,
        graphId: `stash:${stash.id}`,
        rawId: stash.id,
        createdAt: stash.createdAt,
        stashStoredAt: stash.createdAt,
        stashSource: "draft" as const,
        sourceEntryId: null,
        workspaceBranchName: stash.branchName,
        workspaceSectionCount: stash.sections.length,
        workspaceHeadCommitId:
          stash.headCommitId ?? branchHeadByName.get(stash.branchName) ?? null,
        parentCommitId: null,
        mergeSourceCommitId: null,
        mergeSourceBranchName: null,
        entryKind: "stash",
      })),
      ...workspaceSnapshot.committedStashItems.map((stash) => ({
        nodeType: "stash" as const,
        graphId: `stash:${stash.id}`,
        rawId: stash.id,
        createdAt: stash.originalCreatedAt ?? stash.createdAt,
        stashStoredAt: stash.createdAt,
        stashSource: "entry" as const,
        sourceEntryId: stash.entryId,
        workspaceBranchName: stash.branchName,
        workspaceSectionCount: stash.sectionCount,
        workspaceHeadCommitId: stash.headCommitId,
        parentCommitId: stash.parentCommitId,
        mergeSourceCommitId: stash.mergeSourceCommitId,
        mergeSourceBranchName: stash.mergeSourceBranchName,
        entryKind: stash.entryKind ?? "commit",
      })),
      ...visibleEntries.map((entry) => ({
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

    const stashGraphIdByEntryId = new Map<string, string>(
      workspaceSnapshot.committedStashItems.map((stash) => [
        stash.entryId,
        `stash:${stash.id}`,
      ]),
    );
    const resolveGraphCommitId = (commitId: string) =>
      stashGraphIdByEntryId.get(commitId) ?? `entry:${commitId}`;

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

      let desiredCommitId: string | null = null;
      if (graphRow.nodeType === "entry") {
        desiredCommitId = resolveGraphCommitId(graphRow.rawId);
      } else if (graphRow.nodeType === "draft") {
        desiredCommitId = graphRow.workspaceHeadCommitId
          ? resolveGraphCommitId(graphRow.workspaceHeadCommitId)
          : null;
      } else if (graphRow.nodeType === "stash") {
        desiredCommitId =
          graphRow.stashSource === "draft"
            ? graphRow.workspaceHeadCommitId
              ? resolveGraphCommitId(graphRow.workspaceHeadCommitId)
              : null
            : graphRow.parentCommitId
              ? resolveGraphCommitId(graphRow.parentCommitId)
              : null;
      } else {
        desiredCommitId = snapshot?.source_entry_id
          ? resolveGraphCommitId(snapshot.source_entry_id)
          : null;
      }

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

      const refCommitId =
        entry?.id ??
        (graphRow.nodeType === "stash" ? graphRow.sourceEntryId ?? null : null);
      const refs = refCommitId ? branchRefsByCommitId.get(refCommitId) ?? [] : [];
      const workspaceBranchColor =
        graphRow.workspaceBranchName
          ? orderedBranches.find((branch) => branch.name === graphRow.workspaceBranchName)?.color
          : undefined;
      const color =
        refs[0]?.color ??
        (refCommitId ? colorByCommitId.get(refCommitId) : undefined) ??
        workspaceBranchColor ??
        (graphRow.nodeType === "canvas_snapshot" ? "#a855f7" : undefined) ??
        BRANCH_COLORS[lane % BRANCH_COLORS.length];

      nextNodes.push({
        id: graphRow.graphId,
        row,
        date: new Date(graphRow.createdAt ?? 0),
        stashStoredAt:
          graphRow.nodeType === "stash" && graphRow.stashStoredAt
            ? new Date(graphRow.stashStoredAt)
            : null,
        shortHash: shortHash(
          graphRow.nodeType === "stash" && graphRow.sourceEntryId
            ? graphRow.sourceEntryId
            : graphRow.rawId,
        ),
        nodeType: graphRow.nodeType,
        stashSource: graphRow.nodeType === "stash" ? graphRow.stashSource ?? "draft" : null,
        commitId: entry?.id ?? null,
        sourceEntryId:
          graphRow.nodeType === "stash"
            ? graphRow.sourceEntryId ?? null
            : snapshot?.source_entry_id ?? null,
        snapshotName: snapshot?.name ?? null,
        snapshotBranchName: snapshot?.branch_name ?? null,
        workspaceBranchName: graphRow.workspaceBranchName ?? null,
        workspaceSectionCount: graphRow.workspaceSectionCount ?? 0,
        workspaceHeadCommitId: graphRow.workspaceHeadCommitId ?? null,
        isHead:
          entry?.id === latestEntryId ||
          (graphRow.nodeType === "stash" &&
            graphRow.stashSource === "entry" &&
            graphRow.sourceEntryId === latestEntryId),
        tag: refCommitId ? tags[refCommitId] : undefined,
        entryKind:
          graphRow.nodeType === "entry"
            ? entry?.entry_kind ?? "commit"
            : graphRow.nodeType === "canvas_snapshot"
              ? "canvas_snapshot"
              : graphRow.entryKind ?? graphRow.nodeType,
        mergeSourceCommitId:
          graphRow.nodeType === "stash"
            ? graphRow.mergeSourceCommitId ?? null
            : entry?.merge_source_commit_id ?? null,
        mergeSourceBranchName:
          graphRow.nodeType === "stash"
            ? graphRow.mergeSourceBranchName ?? null
            : entry?.merge_source_branch_name ?? null,
        parentCommitId:
          graphRow.nodeType === "stash"
            ? graphRow.parentCommitId ?? null
            : entry?.parent_commit_id ?? null,
        lane,
        color,
      });

      const primaryParentId =
        graphRow.nodeType === "entry"
          ? (entry?.parent_commit_id ?? null)
          : graphRow.nodeType === "draft"
            ? (graphRow.workspaceHeadCommitId ?? null)
          : graphRow.nodeType === "stash" && graphRow.stashSource === "draft"
            ? (graphRow.workspaceHeadCommitId ?? null)
          : graphRow.nodeType === "stash"
            ? (graphRow.parentCommitId ?? null)
          : (snapshot?.source_entry_id ?? null);
      if (primaryParentId) {
        const parentGraphId = resolveGraphCommitId(primaryParentId);
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

      const mergeSourceCommitId =
        graphRow.nodeType === "stash"
          ? graphRow.mergeSourceCommitId ?? null
          : entry?.merge_source_commit_id ?? null;

      if (mergeSourceCommitId) {
        const mergeSourceGraphId = resolveGraphCommitId(mergeSourceCommitId);
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

        const mergeSourceRefs = branchRefsByCommitId.get(mergeSourceCommitId) ?? [];
        const mergeSourceColor =
          mergeSourceRefs[0]?.color ??
          colorByCommitId.get(mergeSourceCommitId) ??
          BRANCH_COLORS[mergeSourceLane % BRANCH_COLORS.length];

        nextEdges.push({
          key: `merge-${graphRow.graphId}-${mergeSourceCommitId}`,
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
    currentBranch,
    currentBranchHeadCommitId,
    latestEntryId,
    orderedBranches,
    rawCanvasVersions,
    committedStashEntryIds,
    rawEntries,
    tags,
    workspaceSnapshot.draftSectionCount,
    workspaceSnapshot.draftStashItems,
    workspaceSnapshot.committedStashItems,
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
      const refCommitId =
        node.commitId ?? node.sourceEntryId ?? node.workspaceHeadCommitId;
      const commitRefs = refCommitId
        ? branchRefsByCommitId.get(refCommitId) ?? []
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
        <div className="sticky top-0 z-20 border-b border-border-default bg-surface-default px-3 py-2 backdrop-blur-sm">
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
                  className={`grid min-w-31 grid-cols-[1fr_auto] items-center gap-x-1.5 gap-y-0.5 border px-2 py-1 text-left transition-colors ${
                    currentBranch === branch.name
                      ? "border-primary-800 bg-primary-950"
                      : "border-border-default bg-surface-default hover:bg-surface-hover"
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
                    className="col-start-2 row-start-1 inline-flex h-5 w-5 items-center justify-center border border-border-subtle text-text-muted transition-colors hover:border-border-default hover:bg-surface-subtle hover:text-text-default"
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
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
                Open head commit
              </button>
              <button
                onClick={() => void handleBranchMenuAction("checkout")}
                disabled={branchMenu.branch.name === currentBranch}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <GitBranch className="h-3.5 w-3.5 text-text-muted" />
                Checkout branch
              </button>
              <button
                onClick={() => void handleBranchMenuAction("merge")}
                disabled={branchMenu.branch.name === currentBranch}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
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
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
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
              <g key={node.id}>
                {node.isHead && (
                  <circle
                    cx={x}
                    cy={y}
                    r={DOT_R + 7}
                    fill="var(--bg-surface-hover)"
                  />
                )}

                {isHovered && (
                  <circle
                    cx={x}
                    cy={y}
                    r={DOT_R + 10}
                    fill="var(--bg-surface-elevated)"
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
                    fill={solidColor(nodeColor)}
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
            const isWorkspaceNode =
              node.nodeType === "draft" || node.nodeType === "stash";
            const branchLabel = node.workspaceBranchName;

            return (
              <button
                key={node.id}
                type="button"
                className="grid w-full min-w-0 items-center gap-3 px-3 text-left transition-opacity"
                style={{
                  minHeight: ROW_H,
                  gridTemplateColumns: `${graphWidth}px minmax(0, 1fr)`,
                }}
                onClick={() => {
                  if (node.nodeType === "stash") {
                    return;
                  }

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
                    : node.nodeType === "draft"
                      ? "Working tree draft"
                    : node.nodeType === "stash"
                      ? node.stashSource === "entry"
                        ? "Stashed commit"
                        : "Stashed draft"
                      : "Open linked commit in commit list"
                }
              >
                <div />

                <div
                  className="relative border border-border-default bg-surface-default px-4 py-3 transition-all duration-150 hover:bg-surface-hover"
                  style={{
                    boxShadow: isHovered
                      ? `0 0 0 1px ${solidColor(accent)}`
                      : undefined,
                    backgroundColor: isHovered
                      ? "var(--bg-surface-hover)"
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
                          <span className="inline-flex items-center gap-1 border border-primary-800 bg-primary-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-action-primary-bg">
                            HEAD
                          </span>
                        )}

                        {node.tag && (
                          <span className="inline-flex items-center gap-1 border border-amber-800 bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                            <TagIcon className="h-3 w-3" />
                            {node.tag}
                          </span>
                        )}

                        {node.nodeType === "canvas_snapshot" && (
                          <span className="inline-flex items-center gap-1 border border-violet-800 bg-violet-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-500">
                            <Camera className="h-3 w-3" />
                            canvas
                          </span>
                        )}

                        {node.nodeType === "draft" && (
                          <span className="inline-flex items-center gap-1 border border-cyan-800 bg-cyan-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
                            <PencilLine className="h-3 w-3" />
                            working tree
                          </span>
                        )}

                        {node.nodeType === "stash" && (
                          <span className="inline-flex items-center gap-1 border border-amber-800 bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                            <Archive className="h-3 w-3" />
                            {node.stashSource === "entry" ? "commit stash" : "draft stash"}
                          </span>
                        )}

                        {node.entryKind === "merge" && (
                          <span className="inline-flex items-center gap-1 border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                            <GitMerge className="h-3 w-3" />
                            merge
                          </span>
                        )}

                        {refs.map((ref) => (
                          <span
                            key={ref.id}
                            className="inline-flex items-center gap-1 border border-border-default px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                            style={{
                              color: ref.color,
                              backgroundColor: "var(--bg-surface-subtle)",
                            }}
                          >
                            <GitBranch className="h-3 w-3" />
                            {ref.name}
                          </span>
                        ))}
                        {branchLabel &&
                          !refs.some((ref) => ref.name === branchLabel) && (
                            <span
                              className="inline-flex items-center gap-1 border border-border-default px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                              style={{
                                color: accent,
                                backgroundColor: "var(--bg-surface-subtle)",
                              }}
                            >
                              <GitBranch className="h-3 w-3" />
                              {branchLabel}
                            </span>
                          )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
                        <span className="inline-flex items-center gap-1">
                          {node.nodeType === "canvas_snapshot" ? (
                            <Camera className="h-3.5 w-3.5" />
                          ) : node.nodeType === "stash" ? (
                            <Archive className="h-3.5 w-3.5" />
                          ) : node.nodeType === "draft" ? (
                            <PencilLine className="h-3.5 w-3.5" />
                          ) : (
                            <GitCommitHorizontal className="h-3.5 w-3.5" />
                          )}
                          {node.nodeType === "canvas_snapshot"
                            ? node.snapshotName || "Canvas snapshot"
                            : node.nodeType === "draft"
                              ? `${node.workspaceSectionCount} draft section${node.workspaceSectionCount === 1 ? "" : "s"} ready to commit`
                            : node.nodeType === "stash"
                              ? node.stashSource === "entry"
                                ? `${node.workspaceSectionCount} stashed section${node.workspaceSectionCount === 1 ? "" : "s"} hidden from the log list`
                                : `${node.workspaceSectionCount} stashed section${node.workspaceSectionCount === 1 ? "" : "s"}`
                              : refs.length > 0
                                ? `${refs.length} branch ref${refs.length === 1 ? "" : "s"} point here`
                                : "Stream history commit"}
                        </span>
                        {isWorkspaceNode && branchLabel && (
                          <span className="inline-flex items-center gap-1">
                            <GitBranch className="h-3.5 w-3.5" />
                            on {branchLabel}
                          </span>
                        )}
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
                          {node.nodeType === "stash" && node.stashStoredAt
                            ? `stashed ${formatAbsoluteDate(node.stashStoredAt)}`
                            : formatAbsoluteDate(node.date)}
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
                          : node.nodeType === "draft"
                            ? "Current draft workspace"
                          : node.nodeType === "stash"
                            ? node.stashSource === "entry"
                              ? "Hidden from the log list"
                              : "Stored stash snapshot"
                            : "Open in commit list"}
                        {!isWorkspaceNode && <ArrowUpRight className="h-3.5 w-3.5" />}
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
