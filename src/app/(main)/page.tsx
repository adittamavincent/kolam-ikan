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
  Clock,
  AlertCircle,
  RefreshCw,
  Copy,
  Users,
} from "lucide-react";
import { useDomains } from "@/lib/hooks/useDomains";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { DynamicIcon } from "@/components/shared/DynamicIcon";

// --- Types ---

interface RecentStream {
  id: string;
  name: string;
  updated_at: string | null;
  created_at: string | null;
  cabinet_id: string | null;
  domain: { id: string; name: string; icon: string } | null;
  cabinet: {
    id: string;
    name: string;
  } | null;
}

interface RecentEntry {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  stream: {
    id: string;
    name: string;
    domain: { id: string; name: string; icon: string } | null;
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

// --- Skeleton helpers ---

function StatCardSkeleton() {
  return (
    <div className="border border-slate-300 bg-white p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <div className="h-3 w-16 bg-slate-100" />
        <div className="h-4 w-4 bg-slate-100" />
      </div>
      <div className="h-6 w-12 bg-slate-100 mt-2" />
    </div>
  );
}

function DomainCardSkeleton() {
  return (
    <div className="border border-slate-300 bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-10 w-10 bg-slate-100" />
        <div className="flex-1">
          <div className="mb-1.5 h-3 w-24 bg-slate-100" />
          <div className="h-2 w-32 bg-slate-100" />
        </div>
      </div>
      <div className="flex gap-4 mt-auto pt-2 border-t border-slate-300 w-full">
        <div className="h-2.5 w-12 bg-slate-100" />
        <div className="h-2.5 w-12 bg-slate-100" />
        <div className="h-2.5 w-12 bg-slate-100" />
      </div>
    </div>
  );
}

function ActivityItemSkeleton() {
  return (
    <div className="flex items-start gap-3 border border-slate-300 bg-white p-3">
      <div className="h-6 w-6 shrink-0 bg-slate-100" />
      <div className="flex-1">
        <div className="mb-1 h-3 w-3/4 bg-slate-100" />
        <div className="h-2 w-1/2 bg-slate-100" />
      </div>
      <div className="shrink-0 h-2 w-8 bg-slate-100 mt-0.5" />
    </div>
  );
}

// --- Sub-components ---

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
  const colorMap: Record<string, string> = {
    blue: "text-sky-700",
    purple: "text-blue-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
  };
  const accentClass = colorMap[color] ?? colorMap.blue;

  return (
    <div className="group border border-slate-300 bg-white p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <p className="uppercase tracking-wider text-slate-600 font-medium">
          {label}
        </p>
        <Icon className={`h-4 w-4 ${accentClass}`} />
      </div>
      <p className="font-bold text-slate-800">{value}</p>
    </div>
  );
}

function DomainCard({
  domain,
  onClick,
  userId,
  refetchDomains,
}: {
  domain: DomainWithCounts;
  onClick: () => void;
  userId?: string | null;
  refetchDomains: () => void;
}) {
  const { duplicateDomain, domains } = useDomains(userId ?? "");

  const handleDuplicate = async () => {
    const suggested = `${domain.name} — copy`;
    const requestedName = window.prompt("Duplicate domain as", suggested);
    const newName = requestedName?.trim();
    if (!newName) return;

    const duplicate = domains?.some(
      (existingDomain) =>
        existingDomain.id !== domain.id &&
        existingDomain.name.toLowerCase() === newName.toLowerCase(),
    );

    if (duplicate) {
      alert("A domain with this name already exists");
      return;
    }

    try {
      await duplicateDomain.mutateAsync({
        id: domain.id,
        newName,
      });
      refetchDomains(); // Trigger stats update after duplication
    } catch (error) {
      console.error("Failed to duplicate domain:", error);
      alert("Failed to duplicate domain. Please try again.");
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className="group flex w-full flex-col border border-slate-300 bg-white p-4 text-left transition-all active:scale-[0.98] active:translate-y-px"
    >
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-blue-950 text-white group-hover:bg-blue-900 transition-colors">
          <DynamicIcon name={domain.icon ?? domain.name} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-800 group-hover:text-blue-500 transition-colors">
            {domain.name}
          </h3>
          {domain.description && (
            <p className="truncate text-slate-600">{domain.description}</p>
          )}
        </div>
        <div className="ml-2 flex items-start">
          <button
            onClick={handleDuplicate}
            className="text-blue-500 hover:underline"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex gap-4 text-slate-500 mt-auto pt-2 border-t border-slate-300 w-full">
        <span className="flex items-center gap-1">
          <span className="font-medium">{domain.cabinetCount}</span> cab
        </span>
        <span className="flex items-center gap-1">
          <span className="font-medium">{domain.streamCount}</span> str
        </span>
        <span className="flex items-center gap-1">
          <span className="font-medium">{domain.entryCount}</span> ent
        </span>
      </div>
    </div>
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
      className="group flex w-full items-start gap-3 border border-slate-300 bg-white p-3 text-left transition-all hover:bg-slate-50 active:scale-[0.99] active:translate-y-px relative"
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center bg-slate-50 transition-colors group-hover:bg-blue-100 group-hover:text-blue-700">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-slate-800">{title}</p>
        </div>
        <p className="truncate text-slate-600">{subtitle}</p>
      </div>
      <span className="shrink-0 text-slate-500 mt-0.5">{time}</span>
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
    <div className="flex items-center gap-3 border border-slate-300 bg-rose-100 px-4 py-3 text-rose-700">
      <AlertCircle className="h-5 w-5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1 bg-white px-3 py-1.5 font-medium text-rose-700 transition hover:bg-slate-50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

// --- Main page ---

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const { personas, isLoading: personasLoading } = usePersonas();

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
          id, name, updated_at, created_at, cabinet_id,
          domain:domains (id, name, icon),
          cabinet:cabinets (id, name)
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
            domain:domains (id, name, icon)
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

  const isLoading = authLoading || domainsLoading || personasLoading;

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
    <div className="flex flex-1 overflow-y-auto bg-slate-50">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        {/* ---- Welcome Section ---- */}
        <div className="mb-6 flex justify-between items-end">
          <div>
            <h1 className="font-bold text-slate-800">
              {greeting}, <span className="text-blue-500">{displayName}</span>
            </h1>
            <p className="mt-1 text-slate-600">Pick up where you left off.</p>
          </div>
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {isLoading ? (
              <>
                <StatCardSkeleton />
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
                <StatCard
                  icon={Users}
                  value={personas?.length ?? 0}
                  label="Personas"
                  color="emerald"
                />
              </>
            )}
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* ---- Domains Overview (left 3 cols) ---- */}
          <section className="lg:col-span-3">
            <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
              <Globe className="h-4 w-4 text-slate-500" />
              Your Domains
            </h2>
            {isLoading ? (
              <div className="grid gap-3">
                <DomainCardSkeleton />
                <DomainCardSkeleton />
                <DomainCardSkeleton />
              </div>
            ) : totalDomains === 0 ? (
              <div className="border-2 border-dashed border-slate-300 bg-white p-8 text-center">
                <Globe className="mx-auto h-8 w-8 text-slate-500" />
                <h3 className="mt-3 font-semibold text-slate-800">
                  No domains yet
                </h3>
                <p className="mt-1 text-slate-600">
                  Create your first domain to start organizing your knowledge.
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {domainsWithCounts!.map((domain) => (
                  <DomainCard
                    key={domain.id}
                    domain={domain}
                    userId={userId}
                    onClick={() => router.push(`/${domain.id}`)}
                    refetchDomains={refetchDomains}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ---- Recent Activity (right 2 cols) ---- */}
          <section className="lg:col-span-2">
            <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
              <Clock className="h-4 w-4 text-slate-500" />
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
              <div className="border-2 border-dashed border-slate-300 bg-white p-8 text-center">
                <Clock className="mx-auto h-8 w-8 text-slate-500" />
                <h3 className="mt-3 font-semibold text-slate-800">
                  No activity yet
                </h3>
                <p className="mt-1 text-slate-600">
                  Your recent streams and entries will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Recent streams */}
                {recentStreams?.slice(0, 3).map((stream) => {
                  const domainIcon = stream.domain?.icon ?? "📁";
                  const domainName = stream.domain?.name ?? "Unknown";
                  const domainId = stream.domain?.id;
                  return (
                    <RecentActivityItem
                      key={`stream-${stream.id}`}
                      icon={<DynamicIcon name={domainIcon} />}
                      title={stream.name}
                      subtitle={
                        stream.cabinet?.name
                          ? `${domainName} — ${stream.cabinet.name}`
                          : domainName
                      }
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
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="font-medium uppercase tracking-wider text-slate-600">
                        Entries
                      </span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                  )}

                {/* Recent entries */}
                {recentEntries?.slice(0, 4).map((entry) => {
                  const domainIcon = entry.stream?.domain?.icon ?? "📄";
                  const streamName = entry.stream?.name ?? "Unknown stream";
                  const domainId = entry.stream?.domain?.id;
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
        <div className="mt-10 border border-slate-300 bg-white px-5 py-4 text-center">
          <p className="text-slate-800">
            <span className="font-semibold text-blue-500">Tip:</span> Use the
            sidebar to quickly switch between domains, or click any card above
            to jump in.
          </p>
        </div>
      </div>
    </div>
  );
}
