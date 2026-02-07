'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { DomainSwitcher } from '@/components/layout/DomainSwitcher';
import { Navigator } from '@/components/layout/Navigator';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSidebar } from '@/lib/hooks/useSidebar';
import { isDevelopmentHost } from '@/lib/utils/authStorage';

const emptySubscribe = () => () => {};

/** Width of the Navigator panel in px — keep in sync with Navigator's w-64 (256px) */
const SIDEBAR_WIDTH = 256;
/** Animation duration in ms — keep in sync with CSS transition */
const ANIM_MS = 250;

interface ClientMainLayoutProps {
  children: React.ReactNode;
  userId: string;
}

export function ClientMainLayout({ children, userId }: ClientMainLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const isDevHost = useSyncExternalStore(emptySubscribe, isDevelopmentHost, () => false);
  const router = useRouter();
  const pathname = usePathname();
  const { user, status, loading, error, signOut } = useAuth();

  // Sidebar state from Zustand store
  const { visible: sidebarVisible, show: showSidebar, hide: hideSidebar, setVisible: setSidebarVisible } = useSidebar();

  // Track whether we want the slide-out animation vs. a hard cut
  const [sidebarRendered, setSidebarRendered] = useState(sidebarVisible);
  const [sidebarSliding, setSidebarSliding] = useState(sidebarVisible);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect "home" route — the root path with no domain param
  const isHomeRoute = pathname === '/';

  // ---------- Route-based auto-show / auto-hide ----------
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;

    if (isHomeRoute) {
      // Going TO home → hide sidebar
      if (prev !== '/') {
        // Animate the hide
        setSidebarSliding(false);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setSidebarRendered(false);
          hideSidebar();
        }, ANIM_MS);
      } else {
        // Already on home (initial load) — ensure hidden immediately
        setSidebarRendered(false);
        setSidebarSliding(false);
        setSidebarVisible(false);
      }
    } else {
      // Going TO a domain route → show sidebar
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setSidebarRendered(true);
      // Delay 1 frame so the element is in the DOM before triggering the CSS transition
      requestAnimationFrame(() => {
        setSidebarSliding(true);
      });
      showSidebar();
    }

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Sync external store changes (e.g. domain click triggers showSidebar)
  useEffect(() => {
    if (sidebarVisible && !sidebarRendered) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setSidebarRendered(true);
      requestAnimationFrame(() => setSidebarSliding(true));
    }
    if (!sidebarVisible && sidebarRendered) {
      setSidebarSliding(false);
      hideTimerRef.current = setTimeout(() => setSidebarRendered(false), ANIM_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarVisible]);

  // ----- Auth redirect -----
  useEffect(() => {
    if (!loading && status === 'signed_out') {
      router.push('/login');
      router.refresh();
    }
  }, [loading, router, status]);

  const handleSignOut = async () => {
    setSigningOut(true);
    const ok = await signOut();
    setSigningOut(false);

    if (ok) {
      window.location.assign('/login');
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ---- Mobile Menu Button ---- */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 shadow-lg md:hidden"
      >
        {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
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
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <DomainSwitcher userId={userId} />
      </div>

      {/* ====== SIDEBAR (Navigator) — animated expand/collapse ====== */}
      {sidebarRendered && (
        <div
          className="hidden md:block overflow-hidden transition-[width,opacity] ease-in-out"
          style={{
            width: sidebarSliding ? SIDEBAR_WIDTH : 0,
            opacity: sidebarSliding ? 1 : 0,
            transitionDuration: `${ANIM_MS}ms`,
          }}
        >
          <div
            className="h-full"
            style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
          >
            <Navigator userId={userId} />
          </div>
        </div>
      )}

      {/* Mobile sidebar — toggled by mobile menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-y-0 left-16 z-40 md:hidden">
          <Navigator userId={userId} />
        </div>
      )}

      {/* ====== MAIN CONTENT ====== */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            {loading ? 'Checking session...' : `Signed in as ${user?.email ?? userId}`}
            {isDevHost && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                Dev: log out before closing tab
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={loading || signingOut || status !== 'signed_in'}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <main className="flex flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
