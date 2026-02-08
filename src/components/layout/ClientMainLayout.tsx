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
  const { 
    visible: sidebarVisible, 
    show: showSidebar, 
    hide: hideSidebar, 
    setVisible: setSidebarVisible,
    width: sidebarWidth,
    setWidth: setSidebarWidth,
    isResizing,
    setIsResizing
  } = useSidebar();

  // Track whether we want the slide-out animation vs. a hard cut
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Resize logic
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate new width based on mouse position
      // Assuming sidebar is on the left, width is basically e.clientX - offset
      // Since DomainSwitcher is on the left (fixed or relative), we need to account for its width if it's in the flow
      // However, the resize handle is at the right edge of the sidebar.
      // So the width of the sidebar is roughly e.clientX - (DomainSwitcher width)
      
      // Let's get the sidebar's left position to be accurate
      if (sidebarRef.current) {
        const sidebarRect = sidebarRef.current.getBoundingClientRect();
        const newWidth = e.clientX - sidebarRect.left;
        
        // Clamp width
        const clampedWidth = Math.min(Math.max(newWidth, 200), 500);
        setSidebarWidth(clampedWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none'; // Prevent text selection while dragging

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, setSidebarWidth, setIsResizing]);

  // Detect "home" route — the root path with no domain param
  const isHomeRoute = pathname === '/';

  // ---------- Route-based auto-show / auto-hide ----------
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;

    if (isHomeRoute) {
      if (prev !== '/') {
        hideSidebar();
      } else {
        setSidebarVisible(false);
      }
    } else {
      showSidebar();
    }
  }, [pathname, isHomeRoute, showSidebar, hideSidebar, setSidebarVisible]);


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
    <div className="flex h-screen overflow-hidden bg-surface-subtle">
      {/* ---- Mobile Menu Button ---- */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-surface-default p-2 shadow-lg md:hidden text-text-default"
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
      {sidebarVisible && (
        <div
          ref={sidebarRef}
          className="hidden md:flex overflow-visible relative group"
          style={{
            width: sidebarWidth,
          }}
        >
          <div
            className="h-full overflow-hidden"
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          >
            <Navigator userId={userId} />
          </div>
          
          {/* Resize Handle */}
          <div
            className={`absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-action-primary-bg/50 active:bg-action-primary-bg transition-colors z-50
              ${isResizing ? 'bg-action-primary-bg w-1' : 'bg-transparent'}
            `}
            onMouseDown={handleMouseDown}
          />
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
        <div className="flex items-center justify-between border-b border-border-subtle bg-surface-subtle px-4 py-2 text-xs text-text-subtle">
          <div className="flex items-center gap-2">
            {loading ? 'Checking session...' : `Signed in as ${user?.email ?? userId}`}
            {isDevHost && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Dev: log out before closing tab
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={loading || signingOut || status !== 'signed_in'}
            className="rounded-md border border-border-default px-2 py-1 text-xs font-medium text-text-default hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
        {error && (
          <div className="border-b border-status-error-border bg-status-error-bg px-4 py-2 text-xs text-status-error-text">
            {error}
          </div>
        )}
        <main className="flex flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
