'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { Menu as MenuIcon, X, ChevronDown, LogOut, Settings, PanelLeft, PanelRight, Columns } from 'lucide-react';
import { StreamHeaderTitle } from '@/components/features/stream/StreamHeaderTitle';
import { DomainSwitcher } from '@/components/layout/DomainSwitcher';
import { Navigator } from '@/components/layout/Navigator';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSidebar } from '@/lib/hooks/useSidebar';
import { useLayout } from '@/lib/hooks/useLayout';
import { Dialog, DialogPanel, DialogTitle, Menu, MenuButton, MenuItem, MenuItems, Transition, TransitionChild } from '@headlessui/react';

interface ClientMainLayoutProps {
  children: React.ReactNode;
  userId: string;
}

export function ClientMainLayout({ children, userId }: ClientMainLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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

  const { setMode, logWidth, canvasWidth } = useLayout();
  const isLogMaximized = logWidth === 100 && canvasWidth === 0;
  const isBalanced = logWidth === 50 && canvasWidth === 50;
  const isCanvasMaximized = logWidth === 0 && canvasWidth === 100;
  
  // Show layout controls only on stream pages (domain/stream)
  const parts = pathname?.split('/').filter(Boolean) || [];
  const showLayoutControls = parts.length === 2;
  const streamId = showLayoutControls ? parts[1] : undefined;

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

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'Account';
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null;
  const nameParts = displayName.split(' ');
  const initials = nameParts
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join('') || 'U';

  return (
    <div className="flex h-screen overflow-hidden bg-surface-subtle">
      {/* ---- Mobile Menu Button ---- */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-surface-default p-2 shadow-lg md:hidden text-text-default"
      >
        {mobileMenuOpen ? <X className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
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
        <div className="relative flex items-center justify-between border-b border-border-subtle bg-surface-default/95 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <StreamHeaderTitle streamId={streamId} />
          </div>
          
          {showLayoutControls && (
            <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-md bg-surface-subtle p-0.5">
              <button
                onClick={() => setMode('log-only')}
                className={`rounded p-1 transition-colors ${
                  isLogMaximized
                    ? 'bg-surface-default text-text-default shadow-sm'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-default'
                }`}
                title="Maximize Log (⌘J)"
              >
                <PanelLeft className="h-4 w-4" />
              </button>

              <button
                onClick={() => setMode('balanced')}
                className={`rounded p-1 transition-colors ${
                  isBalanced
                    ? 'bg-surface-default text-text-default shadow-sm'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-default'
                }`}
                title="Reset Layout (⌘K)"
              >
                <Columns className="h-4 w-4" />
              </button>

              <button
                onClick={() => setMode('canvas-only')}
                className={`rounded p-1 transition-colors ${
                  isCanvasMaximized
                    ? 'bg-surface-default text-text-default shadow-sm'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-default'
                }`}
                title="Maximize Canvas (⌘L)"
              >
                <PanelRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <Menu as="div" className="relative">
            <MenuButton className="flex items-center gap-2 rounded-full border border-border-subtle bg-surface-default px-2 py-1.5 text-left text-xs text-text-default shadow-sm transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={displayName}
                  width={28}
                  height={28}
                  unoptimized
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-action-primary-bg/10 text-[11px] font-semibold text-action-primary-bg">
                  {initials}
                </div>
              )}
              <div className="hidden min-w-0 flex-col items-start sm:flex">
                <span className="truncate text-xs font-semibold text-text-default">{displayName}</span>
                <span className="truncate text-[10px] text-text-muted">{user?.email ?? userId}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-text-muted" />
            </MenuButton>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <MenuItems className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border-default bg-surface-default p-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                <div className="px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Signed in as</p>
                  <p className="truncate text-xs font-medium text-text-default">{displayName}</p>
                  <p className="truncate text-[10px] text-text-muted">{user?.email ?? userId}</p>
                </div>
                <div className="my-1 h-px bg-border-subtle" />
                <MenuItem>
                  {({ focus }) => (
                    <button
                      onClick={() => setProfileOpen(true)}
                      className={`${focus ? 'bg-surface-subtle' : ''} flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-default`}
                    >
                      <Settings className="h-4 w-4 text-text-muted" />
                      Profile settings
                    </button>
                  )}
                </MenuItem>
                <MenuItem>
                  {({ focus }) => (
                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={loading || signingOut || status !== 'signed_in'}
                      className={`${focus ? 'bg-surface-subtle' : ''} flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-default disabled:opacity-50`}
                    >
                      <LogOut className="h-4 w-4 text-text-muted" />
                      {signingOut ? 'Signing out...' : 'Sign out'}
                    </button>
                  )}
                </MenuItem>
              </MenuItems>
            </Transition>
          </Menu>
        </div>
        {error && (
          <div className="border-b border-status-error-border bg-status-error-bg px-4 py-2 text-xs text-status-error-text">
            {error}
          </div>
        )}
        <main className="flex flex-1 overflow-hidden">{children}</main>
      </div>

      <Transition appear show={profileOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setProfileOpen(false)}>
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
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-sm rounded-2xl border border-border-default bg-surface-default p-5 shadow-xl">
                <DialogTitle className="text-sm font-semibold text-text-default">Profile settings</DialogTitle>
                <div className="mt-3 space-y-2 text-xs text-text-subtle">
                  <div className="flex items-center justify-between">
                    <span>Name</span>
                    <span className="text-text-default">{displayName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Email</span>
                    <span className="text-text-default">{user?.email ?? userId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>User ID</span>
                    <span className="truncate text-text-default">{userId}</span>
                  </div>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setProfileOpen(false)}
                    className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-semibold text-text-default transition hover:bg-surface-subtle"
                  >
                    Close
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
