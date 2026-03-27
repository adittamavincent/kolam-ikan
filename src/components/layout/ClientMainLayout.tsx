"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Menu as MenuIcon,
  X,
  PanelLeft,
  PanelRight,
  Columns,
} from "lucide-react";
import { DomainSwitcher } from "@/components/layout/DomainSwitcher";
import { PersonaManager } from "@/components/features/persona/PersonaManager";
import { Navigator } from "@/components/layout/Navigator";
import { MainHeader } from "@/components/layout/MainHeader";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSidebar } from "@/lib/hooks/useSidebar";
import { useLayout } from "@/lib/hooks/useLayout";
import { createClient } from "@/lib/supabase/client";
import { useKeyboard } from "@/lib/hooks/useKeyboard";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";

interface ClientMainLayoutProps {
  children: React.ReactNode;
  userId: string;
}

type CanvasSearchResult = {
  content_preview: string;
  domain_icon: string;
  domain_id: string;
  domain_name: string;
  id: string;
  stream_id: string;
  stream_name: string;
  updated_at: string | null;
};

type CanvasSearchRpcClient = {
  rpc: (
    fn: "search_canvases",
    args: { p_limit: number; p_query: string },
  ) => Promise<{
    data: CanvasSearchResult[] | null;
    error: unknown;
  }>;
};

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 500;
const MAIN_CONTENT_MIN_WIDTH = 520;

function clampSidebarWidth(
  proposedWidth: number,
  sidebarLeft: number,
  layoutRight: number,
) {
  const maxByLayout = layoutRight - sidebarLeft - MAIN_CONTENT_MIN_WIDTH;
  const dynamicMax = Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, maxByLayout),
  );
  return Math.min(Math.max(proposedWidth, SIDEBAR_MIN_WIDTH), dynamicMax);
}

export function ClientMainLayout({ children, userId }: ClientMainLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { status, loading, error } = useAuth();

  // Sidebar state from Zustand store
  const {
    visible: sidebarVisible,
    show: showSidebar,
    hide: hideSidebar,
    setVisible: setSidebarVisible,
    width: sidebarWidth,
    setWidth: setSidebarWidth,
    isResizing,
    setIsResizing,
  } = useSidebar();

  const { setMode, logWidth, canvasWidth } = useLayout();
  const isLogMaximized = logWidth === 100 && canvasWidth === 0;
  const isBalanced = logWidth === 50 && canvasWidth === 50;
  const isCanvasMaximized = logWidth === 0 && canvasWidth === 100;
  const [searchOpen, setSearchOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<
    {
      type: "section" | "canvas";
      id: string;
      streamId: string;
      streamName: string;
      domainId: string | null;
      domainName: string | null;
      domainIcon: string | null;
      personaName?: string | null;
      contentPreview?: string | null;
      createdAt?: string | null;
      score: number;
      entryId?: string;
    }[]
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const supabase = createClient();

  // Show layout controls only on stream pages (domain/stream)
  const parts = pathname?.split("/").filter(Boolean) || [];
  const showLayoutControls = parts.length === 2;

  // Track whether we want the slide-out animation vs. a hard cut
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const pendingSidebarWidthRef = useRef(sidebarWidth);

  useEffect(() => {
    pendingSidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // Resize logic
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    let frameId: number | null = null;
    let latestClientX = 0;

    const applyWidth = () => {
      frameId = null;
      if (!sidebarRef.current) return;

      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const layoutRect = layoutRootRef.current?.getBoundingClientRect();
      const layoutRight = layoutRect?.right ?? window.innerWidth;
      const newWidth = latestClientX - sidebarRect.left;
      const clampedWidth = clampSidebarWidth(
        newWidth,
        sidebarRect.left,
        layoutRight,
      );

      pendingSidebarWidthRef.current = clampedWidth;
      sidebarRef.current.style.width = `${clampedWidth}px`;
    };

    const handleMouseMove = (e: MouseEvent) => {
      latestClientX = e.clientX;
      if (frameId === null) {
        frameId = requestAnimationFrame(applyWidth);
      }
    };

    const handleMouseUp = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        applyWidth();
      }

      setSidebarWidth(pendingSidebarWidthRef.current);
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none"; // Prevent text selection while dragging

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth, setIsResizing]);

  useEffect(() => {
    const syncSidebarWidthToViewport = () => {
      if (!sidebarRef.current) return;

      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const layoutRect = layoutRootRef.current?.getBoundingClientRect();
      const layoutRight = layoutRect?.right ?? window.innerWidth;
      const clamped = clampSidebarWidth(
        sidebarWidth,
        sidebarRect.left,
        layoutRight,
      );

      pendingSidebarWidthRef.current = clamped;
      if (sidebarVisible) {
        sidebarRef.current.style.width = `${clamped}px`;
      }
      if (clamped !== sidebarWidth) {
        setSidebarWidth(clamped);
      }
    };

    syncSidebarWidthToViewport();
    window.addEventListener("resize", syncSidebarWidthToViewport);
    return () =>
      window.removeEventListener("resize", syncSidebarWidthToViewport);
  }, [sidebarVisible, sidebarWidth, setSidebarWidth]);

  // Detect "home" route — the root path with no domain param
  const isHomeRoute = pathname === "/";

  // ---------- Route-based auto-show / auto-hide ----------
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;

    if (isHomeRoute) {
      if (prev !== "/") {
        hideSidebar();
      } else {
        setSidebarVisible(false);
      }
    } else {
      showSidebar();
    }
  }, [pathname, isHomeRoute, showSidebar, hideSidebar, setSidebarVisible]);

  useKeyboard([
    {
      key: "k",
      metaKey: true,
      shiftKey: true,
      handler: () => setSearchOpen(true),
      description: "Open Search",
    },
    {
      key: "k",
      ctrlKey: true,
      shiftKey: true,
      handler: () => setSearchOpen(true),
      description: "Open Search",
    },
    {
      key: "b",
      metaKey: true,
      shiftKey: true,
      handler: () => {
        if (!isHomeRoute) {
          setSidebarVisible(!sidebarVisible);
        }
      },
      description: "Toggle Sidebar",
    },
    {
      key: "b",
      ctrlKey: true,
      shiftKey: true,
      handler: () => {
        if (!isHomeRoute) {
          setSidebarVisible(!sidebarVisible);
        }
      },
      description: "Toggle Sidebar",
    },
  ]);

  // ----- Auth redirect -----
  useEffect(() => {
    if (!loading && status === "signed_out") {
      router.push("/login");
    }
  }, [loading, router, status]);

  const parsedSearch = useMemo(() => {
    const raw = searchTerm.trim();
    const personaMatch = raw.match(/@([\w-]+)/);
    const personaFilter = personaMatch?.[1] ?? null;
    const emojiMatch = raw.match(/^\p{Extended_Pictographic}/u);
    const domainEmoji = emojiMatch?.[0] ?? null;
    const cleaned = raw
      .replace(/@[\w-]+/g, "")
      .replace(/^\p{Extended_Pictographic}/u, "")
      .trim();
    return { cleaned, personaFilter, domainEmoji };
  }, [searchTerm]);

  useEffect(() => {
    if (!searchOpen) return;
    const { cleaned } = parsedSearch;
    if (cleaned.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data: sectionData } = await supabase
          .from("sections")
          .select(
            `id, search_text, created_at, entry:entries(id, stream_id, created_at, stream:streams(id, name, domain:domains(id, name, icon))), persona:personas(name)`,
          )
          .ilike("search_text", `%${cleaned}%`)
          .limit(25);

        const { data: canvasData, error: canvasSearchError } = await (
          supabase as typeof supabase & CanvasSearchRpcClient
        ).rpc("search_canvases", {
            p_limit: 15,
            p_query: cleaned,
          });

        if (canvasSearchError) throw canvasSearchError;

        const results: {
          type: "section" | "canvas";
          id: string;
          streamId: string;
          streamName: string;
          domainId: string | null;
          domainName: string | null;
          domainIcon: string | null;
          personaName?: string | null;
          contentPreview?: string | null;
          createdAt?: string | null;
          score: number;
          entryId?: string;
        }[] = [];

        const toTrigrams = (value: string) => {
          const normalized = value.toLowerCase();
          const padded=` ${normalized} `;
          const trigrams = new Set<string>();
          for (let i = 0; i < padded.length - 2; i += 1) {
            trigrams.add(padded.slice(i, i + 3));
          }
          return trigrams;
        };

        const queryTrigrams = toTrigrams(cleaned);
        const similarity = (value: string) => {
          const target = toTrigrams(value);
          const intersection = [...queryTrigrams].filter((tri) =>
            target.has(tri),
          ).length;
          const union = new Set([...queryTrigrams, ...target]).size || 1;
          return intersection / union;
        };

        sectionData?.forEach((section) => {
          const stream = section.entry?.stream;
          const domain = stream?.domain;
          const preview = section.search_text?.slice(0, 120) ?? "";
          results.push({
            type: "section",
            id: section.id,
            streamId: stream?.id ?? "",
            streamName: stream?.name ?? "Untitled Stream",
            domainId: domain?.id ?? null,
            domainName: domain?.name ?? null,
            domainIcon: domain?.icon ?? null,
            personaName: section.persona?.name ?? null,
            contentPreview: preview,
            createdAt: section.entry?.created_at ?? null,
            score: similarity(preview),
            entryId: section.entry?.id,
          });
        });

        (canvasData as CanvasSearchResult[] | null)?.forEach((canvas) => {
          const preview = canvas.content_preview?.slice(0, 140) ?? "";
          results.push({
            type: "canvas",
            id: canvas.id,
            streamId: canvas.stream_id ?? "",
            streamName: canvas.stream_name ?? "Untitled Stream",
            domainId: canvas.domain_id ?? null,
            domainName: canvas.domain_name ?? null,
            domainIcon: canvas.domain_icon ?? null,
            contentPreview: preview,
            createdAt: canvas.updated_at ?? null,
            score: similarity(preview),
          });
        });

        const filtered = results
          .filter((result) => {
            if (
              parsedSearch.domainEmoji &&
              result.domainIcon !== parsedSearch.domainEmoji
            ) {
              return false;
            }
            if (parsedSearch.personaFilter && result.type === "section") {
              return (
                result.personaName
                  ?.toLowerCase()
                  .includes(parsedSearch.personaFilter.toLowerCase()) ?? false
              );
            }
            if (parsedSearch.personaFilter && result.type === "canvas") {
              return false;
            }
            return true;
          })
          .sort((a, b) => b.score - a.score);

        setSearchResults(filtered);
      } finally {
        setSearchLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [parsedSearch, searchOpen, supabase]);

  const renderHighlightedText = (text: string, term: string) => {
    if (!term) return text;
    const lower = text.toLowerCase();
    const lowerTerm = term.toLowerCase();
    const index = lower.indexOf(lowerTerm);
    if (index === -1) return text;
    return (
      <>
        {text.slice(0, index)}
        <span className="bg-action-primary-bg/20 text-text-default">
          {text.slice(index, index + term.length)}
        </span>
        {text.slice(index + term.length)}
      </>
    );
  };

  return (
    <div
      ref={layoutRootRef}
      className="flex h-dvh overflow-hidden overscroll-none bg-surface-subtle"
    >
      {/* ---- Mobile Menu Button ---- */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="fixed left-4 top-4 z-50 bg-surface-default p-2 md:hidden text-text-default"
      >
        {mobileMenuOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <MenuIcon className="h-6 w-6" />
        )}
      </button>

      {/* ---- Mobile Overlay ---- */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ====== RIBBON (DomainSwitcher) — always visible ====== */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex transform transition-transform md:relative md:translate-x-0 ${
          mobileMenuOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0"
        }`}
      >
        <DomainSwitcher
          userId={userId}
          onOpenGlobalSearch={() => setSearchOpen(true)}
          onOpenPersona={() => setPersonaOpen(true)}
        />
      </div>

      {/* ====== SIDEBAR (Navigator) — animated expand/collapse ====== */}
      <div
        ref={sidebarRef}
        className={`hidden md:flex overflow-hidden relative z-30 group h-full ${isResizing ? "transition-none" : "transition-[width] duration-300 ease-in-out"}`}
        style={{ width: sidebarVisible ? sidebarWidth : 0 }}
      >
        <div
          className={`flex-1 overflow-hidden h-full transition-all duration-300 ease-in-out ${
            sidebarVisible
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-2 pointer-events-none"
          }`}
        >
          <Navigator userId={userId} />
        </div>

        {/* Resize Handle */}
        <div
          className={`absolute top-0 right-0 h-full w-1 cursor-col-resize transition-colors z-50 ${
            sidebarVisible
              ? "hover:bg-action-primary-bg/50 active:bg-action-primary-bg"
              : "pointer-events-none"
          } ${isResizing ? "bg-action-primary-bg w-1" : "bg-transparent"}`}
          onMouseDown={handleMouseDown}
        />
      </div>

      {/* Mobile sidebar — toggled by mobile menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-y-0 left-16 z-40 md:hidden">
          <Navigator userId={userId} />
        </div>
      )}

      {/* ====== MAIN CONTENT ====== */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="border-b border-border-default bg-status-error-bg px-4 py-2 text-xs text-status-error-text">
            {error}
          </div>
        )}
        <MainHeader />
        <main className="flex flex-1 overflow-hidden">{children}</main>

        {showLayoutControls && (
          <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-0.5 border border-border-default bg-surface-default/90 p-1.5 shadow-lg backdrop-blur-md z-30 transition-all">
            <button
              onClick={() => setMode("log-only")}
              className={`relative z-0 p-2 transition-all focus:z-40 ${
                isLogMaximized
                  ? "bg-action-primary-bg text-white shadow-md"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-default"
              }`}
              title="Maximize Log (⌘J)"
            >
              <PanelLeft className="h-4 w-4" />
            </button>

            <button
              onClick={() => setMode("balanced")}
              className={`relative z-0 p-2 transition-all focus:z-40 ${
                isBalanced
                  ? "bg-action-primary-bg text-white shadow-md"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-default"
              }`}
              title="Reset Layout (⌘K)"
            >
              <Columns className="h-4 w-4" />
            </button>

            <button
              onClick={() => setMode("canvas-only")}
              className={`relative z-0 p-2 transition-all focus:z-40 ${
                isCanvasMaximized
                  ? "bg-action-primary-bg text-white shadow-md"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-default"
              }`}
              title="Maximize Canvas (⌘L)"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <Transition appear show={searchOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-50"
          onClose={() => setSearchOpen(false)}
        >
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </TransitionChild>
          <div className="fixed inset-0 flex items-start justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <DialogPanel className="w-full max-w-2xl border border-border-default bg-surface-default p-5 shadow-2xl">
                <DialogTitle className="text-sm font-semibold text-text-default">
                  Search
                </DialogTitle>
                <div className="mt-3">
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search logs and canvases... (@persona, emoji for domain)"
                    className="w-full border border-border-default bg-surface-subtle px-3 py-2 text-sm text-text-default focus:border-border-default focus: focus: focus:"
                    autoFocus
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-muted">
                  {parsedSearch.personaFilter && (
                    <span className=" border border-border-default px-2 py-0.5">
                      Persona: @{parsedSearch.personaFilter}
                    </span>
                  )}
                  {parsedSearch.domainEmoji && (
                    <span className=" border border-border-default px-2 py-0.5">
                      Domain: {parsedSearch.domainEmoji}
                    </span>
                  )}
                </div>
                <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
                  {searchLoading && (
                    <div className="text-xs text-text-muted">Searching...</div>
                  )}
                  {!searchLoading && searchResults.length === 0 && (
                    <div className="text-xs text-text-muted">
                      No results yet
                    </div>
                  )}
                  {searchResults.map((result) => (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => {
                        if (!result.domainId) return;
                        const payload = {
                          term: parsedSearch.cleaned,
                          target: result.type === "canvas" ? "canvas" : "log",
                          entryId: result.entryId ?? null,
                          streamId: result.streamId,
                        };
                        sessionStorage.setItem(
                          "kolam_search_highlight",
                          JSON.stringify(payload),
                        );
                        setSearchOpen(false);
                        router.push(`/${result.domainId}/${result.streamId}`);
                      }}
                      className="w-full border border-border-default bg-surface-subtle p-3 text-left text-xs text-text-default transition hover:bg-surface-hover"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                        <span className="flex items-center gap-2">
                          <span>{result.domainIcon}</span>
                          <span className="truncate">{result.streamName}</span>
                        </span>
                        <span>
                          {result.type === "canvas"
                            ? "Canvas"
                            : result.personaName}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-text-default">
                        {renderHighlightedText(
                          result.contentPreview ?? "",
                          parsedSearch.cleaned,
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
      <PersonaManager
        isOpen={personaOpen}
        onClose={() => setPersonaOpen(false)}
      />
    </div>
  );
}
