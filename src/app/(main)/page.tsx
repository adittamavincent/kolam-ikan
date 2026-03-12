"use client";

import { useAuth } from "@/lib/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Domain } from "@/lib/types";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Globe,
  FolderOpen,
  FileText,
  Layers,
  ArrowRight,
  Plus,
  Clock,
  Sparkles,
  TrendingUp,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { DynamicIcon } from "@/components/shared/DynamicIcon";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RecentStream {
  id: string;
  name: string;
  description: string | null;
  updated_at: string | null;
  created_at: string | null;
  cabinet_id: string;
  cabinet: {
    id: string;
    name: string;
    domain_id: string;
    domain: { id: string; name: string; icon: string } | null;
  } | null;
}

interface RecentEntry {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  stream: {
    id: string;
    name: string;
    cabinet: {
      domain: { id: string; name: string; icon: string } | null;
    } | null;
  } | null;
  sections: {
    id: string;
    persona_name_snapshot: string | null;
    search_text: string | null;
  }[];
}

interface DomainWithCounts extends Domain {
  cabinetCount: number;
  streamCount: number;
  entryCount: number;
}

/* ------------------------------------------------------------------ */
/*  Skeleton helpers                                                   */
/* ------------------------------------------------------------------ */

function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-border-subtle bg-surface-default p-5">
      <div className="mb-3 h-10 w-10 rounded-xl bg-surface-elevated" />
      <div className="mb-2 h-7 w-16 rounded bg-surface-elevated" />
      <div className="h-4 w-24 rounded bg-surface-elevated" />
    </div>
  );
}

function DomainCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-border-subtle bg-surface-default p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-surface-elevated" />
        <div>
          <div className="mb-2 h-5 w-28 rounded bg-surface-elevated" />
          <div className="h-3 w-40 rounded bg-surface-elevated" />
        </div>
      </div>
      <div className="flex gap-4">
        <div className="h-4 w-16 rounded bg-surface-elevated" />
        <div className="h-4 w-16 rounded bg-surface-elevated" />
        <div className="h-4 w-16 rounded bg-surface-elevated" />
      </div>
    </div>
  );
}

function ActivityItemSkeleton() {
  return (
    <div className="animate-pulse flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-default p-4">
      <div className="h-9 w-9 rounded-lg bg-surface-elevated" />
      <div className="flex-1">
        <div className="mb-2 h-4 w-3/4 rounded bg-surface-elevated" />
        <div className="h-3 w-1/2 rounded bg-surface-elevated" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> =
    {
      blue: {
        bg: "bg-blue-500/5",
        text: "text-blue-600 dark:text-blue-400",
        iconBg: "bg-blue-500/10",
      },
      purple: {
        bg: "bg-purple-500/5",
        text: "text-purple-600 dark:text-purple-400",
        iconBg: "bg-purple-500/10",
      },
      emerald: {
        bg: "bg-emerald-500/5",
        text: "text-emerald-600 dark:text-emerald-400",
        iconBg: "bg-emerald-500/10",
      },
      amber: {
        bg: "bg-amber-500/5",
        text: "text-amber-600 dark:text-amber-400",
        iconBg: "bg-amber-500/10",
      },
    };
  const c = colorMap[color] ?? colorMap.blue;

  return (
    <div className="group rounded-2xl border border-border-subtle bg-surface-default p-5">
      <div className={`mb-3 inline-flex rounded-xl ${c.iconBg} p-2.5`}>
        <Icon className={`h-5 w-5 ${c.text}`} />
      </div>
      <p className="text-2xl font-bold text-text-default">{value}</p>
      <p className="mt-0.5 text-sm text-text-subtle">{label}</p>
    </div>
  );
}

function DomainCard({
  domain,
  onClick,
}: {
  domain: DomainWithCounts;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col rounded-2xl border border-border-subtle bg-surface-default p-5 text-left transition-all hover:border-action-primary-bg/50"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-action-primary-bg/10 text-2xl group-hover:bg-action-primary-bg/20 transition-colors">
          <DynamicIcon name={domain.icon ?? domain.name} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-text-default group-hover:text-action-primary-bg transition-colors">
            {domain.name}
          </h3>
          {domain.description && (
            <p className="truncate text-xs text-text-subtle">
              {domain.description}
            </p>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-action-primary-bg" />
      </div>
      <div className="flex gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <FolderOpen className="h-3.5 w-3.5" />
          {domain.cabinetCount}{" "}
          {domain.cabinetCount === 1 ? "cabinet" : "cabinets"}
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" />
          {domain.streamCount} {domain.streamCount === 1 ? "stream" : "streams"}
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" />
          {domain.entryCount} {domain.entryCount === 1 ? "entry" : "entries"}
        </span>
      </div>
    </button>
  );
}

function RecentActivityItem({
  icon,
  title,
  subtitle,
  time,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  time: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-xl border border-border-subtle bg-surface-default p-4 text-left transition-all hover:border-border-default relative"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-lg transition-colors group-hover:bg-action-primary-bg/10">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text-default">
            {title}
          </p>
        </div>
        <p className="truncate text-xs text-text-subtle">{subtitle}</p>
      </div>
      <span className="shrink-0 text-xs text-text-muted">{time}</span>
    </button>
  );
}

function QuickAction({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-4 rounded-2xl border border-border-subtle bg-surface-default p-4 text-left transition-all hover:border-action-primary-bg/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action-primary-bg/10 transition-colors group-hover:bg-action-primary-bg/20">
        <Icon className="h-5 w-5 text-action-primary-bg" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-default">{label}</p>
        <p className="text-xs text-text-subtle">{description}</p>
      </div>
    </button>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-status-error-border bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
      <AlertCircle className="h-5 w-5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-lg bg-surface-default px-3 py-1.5 text-xs font-medium text-status-error-text transition hover:bg-surface-subtle"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const userId = user?.id;

  // ---- Fetch domains with counts ----
  const {
    data: domainsWithCounts,
    isLoading: domainsLoading,
    error: domainsError,
    refetch: refetchDomains,
  } = useQuery({
    queryKey: ["home-domains", userId],
    queryFn: async ({ signal }) => {
      // Parallel fetch: domains and stats
      const [domainsResult, statsResult] = await Promise.all([
        supabase
          .from("domains")
          .select("*")
          .eq("user_id", userId!)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true })
          .abortSignal(signal),

        supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .rpc("get_domain_stats" as any, { p_user_id: userId! })
          .abortSignal(signal),
      ]);

      if (domainsResult.error) throw domainsResult.error;
      if (statsResult.error) throw statsResult.error;

      const domains = domainsResult.data as Domain[];
      const stats = statsResult.data as {
        domain_id: string;
        cabinet_count: number;
        stream_count: number;
        entry_count: number;
      }[];

      // Map stats to domains
      const statsMap = new Map(stats.map((s) => [s.domain_id, s]));

      const enriched: DomainWithCounts[] = domains.map((domain) => {
        const s = statsMap.get(domain.id);
        return {
          ...domain,
          cabinetCount: s?.cabinet_count ?? 0,
          streamCount: s?.stream_count ?? 0,
          entryCount: s?.entry_count ?? 0,
        };
      });

      return enriched;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  // ---- Fetch recent streams ----
  const {
    data: recentStreams,
    isLoading: streamsLoading,
    error: streamsError,
    refetch: refetchStreams,
  } = useQuery({
    queryKey: ["home-recent-streams", userId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("streams")
        .select(
          `
          id, name, description, updated_at, created_at, cabinet_id,
          cabinet:cabinets (
            id, name, domain_id,
            domain:domains (id, name, icon)
          )
        `,
        )
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(5)
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as unknown as RecentStream[];
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  // ---- Fetch recent entries ----
  const {
    data: recentEntries,
    isLoading: entriesLoading,
    error: entriesError,
    refetch: refetchEntries,
  } = useQuery({
    queryKey: ["home-recent-entries", userId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("entries")
        .select(
          `
          id, created_at, updated_at,
          stream:streams (
            id, name,
            cabinet:cabinets (
              domain:domains (id, name, icon)
            )
          ),
          sections (id, persona_name_snapshot, search_text)
        `,
        )
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(5)
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as unknown as RecentEntry[];
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  // ---- Derived stats ----
  const totalDomains = domainsWithCounts?.length ?? 0;
  const totalCabinets =
    domainsWithCounts?.reduce((s, d) => s + d.cabinetCount, 0) ?? 0;
  const totalStreams =
    domainsWithCounts?.reduce((s, d) => s + d.streamCount, 0) ?? 0;
  const totalEntries =
    domainsWithCounts?.reduce((s, d) => s + d.entryCount, 0) ?? 0;

  const isLoading = authLoading || domainsLoading;

  // ---- Greeting ----
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const displayName =
    user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "there";

  // ---- Helpers ----
  function timeAgo(dateStr: string | null) {
    if (!dateStr) return "";
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return "";
    }
  }

  function getEntryPreview(entry: RecentEntry) {
    const firstSection = entry.sections?.[0];
    if (firstSection?.search_text) {
      return (
        firstSection.search_text.slice(0, 80) +
        (firstSection.search_text.length > 80 ? "..." : "")
      );
    }
    if (firstSection?.persona_name_snapshot) {
      return `Section by ${firstSection.persona_name_snapshot}`;
    }
    return "Empty entry";
  }

  return (
    <div className="flex flex-1 overflow-y-auto bg-surface-subtle">
      <div className="mx-auto w-full max-w-5xl px-6 py-8 md:px-10 md:py-10">
        {/* ---- Welcome Section ---- */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-action-primary-bg mb-1">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Dashboard
            </span>
          </div>
          <h1 className="text-2xl font-bold text-text-default md:text-3xl">
            {greeting},{" "}
            <span className="text-action-primary-bg">{displayName}</span>
          </h1>
          <p className="mt-1 text-sm text-text-subtle">
            Here&apos;s an overview of your workspace. Pick up where you left
            off.
          </p>
        </div>

        {/* ---- Error Banners ---- */}
        {domainsError && (
          <div className="mb-6">
            <ErrorBanner
              message="Failed to load domains. Please try again."
              onRetry={() => refetchDomains()}
            />
          </div>
        )}

        {/* ---- Stat Cards ---- */}
        <section className="mb-8">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {isLoading ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </>
            ) : (
              <>
                <StatCard
                  icon={Globe}
                  value={totalDomains}
                  label="Domains"
                  color="blue"
                />
                <StatCard
                  icon={FolderOpen}
                  value={totalCabinets}
                  label="Cabinets"
                  color="purple"
                />
                <StatCard
                  icon={Layers}
                  value={totalStreams}
                  label="Streams"
                  color="emerald"
                />
                <StatCard
                  icon={FileText}
                  value={totalEntries}
                  label="Entries"
                  color="amber"
                />
              </>
            )}
          </div>
        </section>

        {/* ---- Quick Actions ---- */}
        {!isLoading && totalDomains > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-default">
              <TrendingUp className="h-4 w-4 text-text-muted" />
              Quick Actions
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              <QuickAction
                icon={Globe}
                label="Browse Domains"
                description="Explore your knowledge domains"
                onClick={() => {
                  const first = domainsWithCounts?.[0];
                  if (first) router.push(`/${first.id}`);
                }}
              />
              <QuickAction
                icon={Plus}
                label="New Entry"
                description="Start writing in a stream"
                onClick={() => {
                  const first = domainsWithCounts?.[0];
                  if (first) router.push(`/${first.id}`);
                }}
              />
              <QuickAction
                icon={Sparkles}
                label="Recent Activity"
                description="Continue where you left off"
                onClick={() => {
                  const first = recentStreams?.[0];
                  if (first?.cabinet?.domain_id) {
                    router.push(`/${first.cabinet.domain_id}/${first.id}`);
                  } else if (domainsWithCounts?.[0]) {
                    router.push(`/${domainsWithCounts[0].id}`);
                  }
                }}
              />
            </div>
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-5">
          {/* ---- Domains Overview (left 3 cols) ---- */}
          <section className="lg:col-span-3">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-default">
              <Globe className="h-4 w-4 text-text-muted" />
              Your Domains
            </h2>
            {isLoading ? (
              <div className="grid gap-3">
                <DomainCardSkeleton />
                <DomainCardSkeleton />
                <DomainCardSkeleton />
              </div>
            ) : totalDomains === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border-default bg-surface-default p-10 text-center">
                <Globe className="mx-auto h-10 w-10 text-text-muted" />
                <h3 className="mt-3 text-sm font-semibold text-text-default">
                  No domains yet
                </h3>
                <p className="mt-1 text-xs text-text-subtle">
                  Create your first domain to start organizing your knowledge.
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {domainsWithCounts!.map((domain) => (
                  <DomainCard
                    key={domain.id}
                    domain={domain}
                    onClick={() => router.push(`/${domain.id}`)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ---- Recent Activity (right 2 cols) ---- */}
          <section className="lg:col-span-2">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-default">
              <Clock className="h-4 w-4 text-text-muted" />
              Recent Activity
            </h2>

            {(streamsError || entriesError) && (
              <div className="mb-3">
                <ErrorBanner
                  message="Failed to load recent activity."
                  onRetry={() => {
                    refetchStreams();
                    refetchEntries();
                  }}
                />
              </div>
            )}

            {streamsLoading || entriesLoading ? (
              <div className="space-y-2">
                <ActivityItemSkeleton />
                <ActivityItemSkeleton />
                <ActivityItemSkeleton />
                <ActivityItemSkeleton />
              </div>
            ) : recentStreams?.length === 0 && recentEntries?.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border-default bg-surface-default p-8 text-center">
                <Clock className="mx-auto h-8 w-8 text-text-muted" />
                <h3 className="mt-3 text-sm font-semibold text-text-default">
                  No activity yet
                </h3>
                <p className="mt-1 text-xs text-text-subtle">
                  Your recent streams and entries will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Recent streams */}
                {recentStreams?.slice(0, 3).map((stream) => {
                  const domainIcon = stream.cabinet?.domain?.icon ?? "📁";
                  const domainName = stream.cabinet?.domain?.name ?? "Unknown";
                  const domainId = stream.cabinet?.domain_id;
                  return (
                    <RecentActivityItem
                      key={`stream-${stream.id}`}
                      icon={<DynamicIcon name={domainIcon} />}
                      title={stream.name}
                      subtitle={`${domainName} — ${stream.cabinet?.name ?? ""}`}
                      time={timeAgo(stream.updated_at)}
                      onClick={() => {
                        if (domainId) router.push(`/${domainId}/${stream.id}`);
                      }}
                    />
                  );
                })}

                {/* Divider */}
                {(recentStreams?.length ?? 0) > 0 &&
                  (recentEntries?.length ?? 0) > 0 && (
                    <div className="flex items-center gap-2 py-1">
                      <div className="h-px flex-1 bg-border-subtle" />
                      <span className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                        Entries
                      </span>
                      <div className="h-px flex-1 bg-border-subtle" />
                    </div>
                  )}

                {/* Recent entries */}
                {recentEntries?.slice(0, 4).map((entry) => {
                  const domainIcon =
                    entry.stream?.cabinet?.domain?.icon ?? "📄";
                  const streamName = entry.stream?.name ?? "Unknown stream";
                  const domainId = entry.stream?.cabinet?.domain?.id;
                  const streamId = entry.stream?.id;
                  return (
                    <RecentActivityItem
                      key={`entry-${entry.id}`}
                      icon={<DynamicIcon name={domainIcon} />}
                      title={getEntryPreview(entry)}
                      subtitle={streamName}
                      time={timeAgo(entry.updated_at ?? entry.created_at)}
                      onClick={() => {
                        if (domainId && streamId)
                          router.push(`/${domainId}/${streamId}`);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* ---- Footer tip ---- */}
        <div className="mt-10 rounded-xl bg-action-primary-bg/10 px-5 py-4 text-center">
          <p className="text-xs text-text-default">
            <span className="font-semibold text-action-primary-bg">Tip:</span>{" "}
            Use the sidebar to quickly switch between domains, or click any card
            above to jump in.
          </p>
        </div>
      </div>
    </div>
  );
}
