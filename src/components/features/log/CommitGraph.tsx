"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowUpRight,
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  Tag as TagIcon,
} from "lucide-react";

interface GraphNode {
  id: string;
  row: number;
  date: Date;
  shortHash: string;
  isHead: boolean;
  tag?: string;
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
  tags: Record<string, string>;
  latestEntryId: string | null;
  onEntryClick?: (streamId: string, entryId: string) => void;
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

  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function CommitGraph({
  currentStreamId,
  tags,
  latestEntryId,
  onEntryClick,
}: CommitGraphProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
        .select("id, created_at, parent_commit_id")
        .eq("stream_id", currentStreamId)
        .eq("is_draft", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Array<{
        id: string;
        created_at: string | null;
        parent_commit_id: string | null;
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

    const entryById = new Map(rawEntries.map((entry) => [entry.id, entry]));
    const rowById = new Map(rawEntries.map((entry, index) => [entry.id, index]));
    const laneByCommitId = new Map<string, number>();
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

    effectiveBranches.forEach((branch, lane) => {
      let cursor = branch.head_commit_id ?? null;

      while (cursor) {
        if (laneByCommitId.has(cursor)) break;

        laneByCommitId.set(cursor, lane);
        colorByCommitId.set(cursor, branch.color);
        cursor = entryById.get(cursor)?.parent_commit_id ?? null;
      }
    });

    const nextNodes: GraphNode[] = [];
    const nextEdges: GraphEdge[] = [];
    let maxLaneCount = Math.max(effectiveBranches.length, 1);

    rawEntries.forEach((entry, row) => {
      const refs = branchRefsByCommitId.get(entry.id) ?? [];
      const lane = laneByCommitId.get(entry.id) ?? 0;
      const color =
        refs[0]?.color ??
        colorByCommitId.get(entry.id) ??
        BRANCH_COLORS[lane % BRANCH_COLORS.length];

      nextNodes.push({
        id: entry.id,
        row,
        date: new Date(entry.created_at ?? 0),
        shortHash: shortHash(entry.id),
        isHead: entry.id === latestEntryId,
        tag: tags[entry.id],
        parentCommitId: entry.parent_commit_id,
        lane,
        color,
      });

      if (entry.parent_commit_id) {
        const parentRow = rowById.get(entry.parent_commit_id);
        if (parentRow !== undefined) {
          const parentLane = laneByCommitId.get(entry.parent_commit_id) ?? 0;
          nextEdges.push({
            key: `parent-${entry.id}`,
            fromLane: lane,
            toLane: parentLane,
            fromRow: row,
            toRow: parentRow,
            color,
          });
          maxLaneCount = Math.max(maxLaneCount, lane + 1, parentLane + 1);
        }
      }
    });

    return {
      nodes: nextNodes,
      edges: nextEdges,
      laneCount: maxLaneCount,
    };
  }, [branchRefsByCommitId, latestEntryId, orderedBranches, rawEntries, tags]);

  const graphWidth = Math.max(72, GRAPH_PAD_X * 2 + (laneCount - 1) * LANE_GAP);
  const graphHeight = Math.max(nodes.length * ROW_H, ROW_H);

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
          <div className="flex gap-2 overflow-x-auto">
            {orderedBranches.map((branch) => {
              const headCommitId = branch.head_commit_id ?? null;
              const headHash = headCommitId ? shortHash(headCommitId) : "------";

              return (
                <button
                  key={branch.id}
                  type="button"
                  className="inline-flex min-w-fit items-center gap-2 border border-border-default/50 bg-surface-default px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover"
                  style={{ boxShadow: `inset 3px 0 0 ${branch.color}` }}
                  onClick={() => {
                    if (headCommitId) {
                      onEntryClick?.(currentStreamId, headCommitId);
                    }
                  }}
                  title={
                    headCommitId
                      ? `Open ${branch.name} head`
                      : `${branch.name} has no head commit`
                  }
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0"
                    style={{ backgroundColor: branch.color }}
                  />
                  <span className="text-[11px] font-semibold text-text-default">
                    {branch.name}
                  </span>
                  <code className="bg-surface-subtle px-1.5 py-0.5 text-[10px] text-text-muted">
                    {headHash}
                  </code>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative w-full min-w-0">
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
            const refs = branchRefsByCommitId.get(node.id) ?? [];
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
            const refs = branchRefsByCommitId.get(node.id) ?? [];
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
                onClick={() => onEntryClick?.(currentStreamId, node.id)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={`Open commit ${node.shortHash}`}
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
                          <GitCommitHorizontal className="h-3.5 w-3.5" />
                          {refs.length > 0
                            ? `${refs.length} branch ref${refs.length === 1 ? "" : "s"} point here`
                            : "Stream history commit"}
                        </span>
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
                        Open in commit list
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
