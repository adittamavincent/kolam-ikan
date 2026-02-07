'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { DomainSwitcher } from '@/components/layout/DomainSwitcher';
import { Navigator } from '@/components/layout/Navigator';
import { useAuth } from '@/lib/hooks/useAuth';
import { isDevelopmentHost } from '@/lib/utils/authStorage';

const emptySubscribe = () => () => {};

interface ClientMainLayoutProps {
  children: React.ReactNode;
  userId: string;
}

export function ClientMainLayout({ children, userId }: ClientMainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const isDevHost = useSyncExternalStore(emptySubscribe, isDevelopmentHost, () => false);
  const router = useRouter();
  const { user, status, loading, error, signOut } = useAuth();

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
      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 shadow-lg md:hidden"
      >
        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Domain Switcher & Navigator */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex transform transition-transform md:relative md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <DomainSwitcher userId={userId} />
        <Navigator userId={userId} />
      </div>

      {/* Main Content */}
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
