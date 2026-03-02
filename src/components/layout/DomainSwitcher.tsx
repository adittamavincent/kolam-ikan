'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Domain } from '@/lib/types';
import { useRef, useState } from 'react';
import { Home, Plus, RefreshCw, AlertCircle, LogOut, Settings } from 'lucide-react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import Image from 'next/image';
import { Fragment } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems, Transition, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { useSidebar } from '@/lib/hooks/useSidebar';
import { useAuth } from '@/lib/hooks/useAuth';
import { CreateDomainModal } from './CreateDomainModal';
import { useKeyboard } from '@/lib/hooks/useKeyboard';

interface DomainSwitcherProps {
  userId: string;
}

export function DomainSwitcher({ userId }: DomainSwitcherProps) {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const supabase = createClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [hoveredDomainTooltip, setHoveredDomainTooltip] = useState<{ name: string; top: number } | null>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const { user, status, loading, signOut } = useAuth();
  const { hide: hideSidebar } = useSidebar();

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/login');
    } finally {
      setSigningOut(false);
    }
  };

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'Account';
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null;
  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('') || 'U';

  // Keyboard shortcut to open create modal
  useKeyboard([
    {
      key: 'd',
      metaKey: true,
      handler: () => setIsCreateModalOpen(true),
      description: 'Create Domain',
    },
    {
      key: 'd',
      ctrlKey: true,
      handler: () => setIsCreateModalOpen(true),
      description: 'Create Domain',
    },
  ]);

  const { data: domains, isLoading, error } = useQuery({
    queryKey: ['domains', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('domains')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as Domain[];
    },
  });

  const currentDomainId = params?.domain as string;

  const showDomainTooltip = (event: React.MouseEvent<HTMLButtonElement>, name: string) => {
    const root = switcherRef.current;
    if (!root) return;
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setHoveredDomainTooltip({
      name,
      top: buttonRect.top - rootRect.top + buttonRect.height / 2,
    });
  };

  return (
    <div ref={switcherRef} className="relative flex h-full w-16 flex-col items-center bg-surface-default py-4 border-r border-border-subtle shadow-sm z-50">
      {/* Home / Root */}
      <button
        onClick={() => {
          hideSidebar();
          router.push('/');
        }}
        className={`group relative mb-4 flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${pathname === '/'
            ? 'bg-action-primary-bg text-white shadow-md scale-105'
            : 'bg-surface-subtle text-text-muted hover:bg-surface-hover hover:text-text-default hover:scale-105'
          }`}
      >
        <Home className="h-5 w-5" />
        <div className="absolute left-14 hidden rounded-md bg-surface-dark px-2 py-1 text-[10px] font-medium text-white group-hover:block whitespace-nowrap shadow-lg">
          Home
        </div>
      </button>

      <div className="mb-4 h-px w-8 bg-border-subtle" />

      {/* Domain List */}
      <div className="flex-1 w-full flex flex-col items-center space-y-3 overflow-y-auto px-2 scrollbar-hide py-1">
        {isLoading && (
          <div className="flex h-10 w-10 items-center justify-center">
            <RefreshCw className="h-4 w-4 animate-spin text-text-muted" />
          </div>
        )}

        {error && (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-status-error-bg/20 text-status-error-text">
            <AlertCircle className="h-5 w-5" />
          </div>
        )}

        {domains?.map((domain) => (
          <button
            key={domain.id}
            onClick={() => {
              setHoveredDomainTooltip(null);
              router.push(`/${domain.id}`);
            }}
            onMouseEnter={(event) => showDomainTooltip(event, domain.name)}
            onMouseLeave={() => setHoveredDomainTooltip(null)}
            title={domain.name}
            aria-label={domain.name}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${currentDomainId === domain.id
                ? 'bg-action-primary-bg text-white shadow-md scale-105'
                : 'bg-surface-subtle text-text-muted hover:bg-surface-hover hover:text-text-default hover:scale-105'
              }`}
          >
            {domain.icon ? (
              <DynamicIcon name={domain.icon} className="h-5 w-5" />
            ) : (
              <DynamicIcon name={domain.name} className="h-5 w-5" />
            )}
            {/* Active Indicator */}
            {currentDomainId === domain.id && (
              <div className="absolute -left-2 h-6 w-1 rounded-r-full bg-action-primary-bg" />
            )}
          </button>
        ))}

        {/* Add Domain */}
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-surface-subtle text-text-muted transition-all duration-200 hover:bg-action-primary-bg/10 hover:text-action-primary-bg hover:scale-105"
        >
          <Plus className="h-5 w-5" />
          <div className="absolute left-14 hidden rounded-md bg-surface-dark px-2 py-1 text-[10px] font-medium text-white group-hover:block whitespace-nowrap shadow-lg">
            Add Domain
          </div>
        </button>
      </div>

      {hoveredDomainTooltip && (
        <div
          className="pointer-events-none absolute left-14 z-60 -translate-y-1/2 whitespace-nowrap rounded-md bg-surface-dark px-2 py-1 text-[10px] font-medium text-white shadow-lg"
          style={{ top: hoveredDomainTooltip.top }}
        >
          {hoveredDomainTooltip.name}
        </div>
      )}

      {/* User Menu / Profile at bottom */}
      <div className="mt-auto flex flex-col items-center gap-4 pt-4 border-t border-border-subtle w-full">
        <Menu as="div" className="relative">
          <MenuButton className="flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface-default text-text-default transition hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-action-primary-bg overflow-hidden shadow-sm">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={40}
                height={40}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-action-primary-bg/10 text-xs font-semibold text-action-primary-bg">
                {initials}
              </div>
            )}
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
            <MenuItems className="absolute bottom-full left-full z-50 mb-2 ml-2 w-56 rounded-xl border border-border-default bg-surface-default p-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
              <div className="px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Signed in as</p>
                <p className="truncate text-xs font-medium text-text-default">{displayName}</p>
                <p className="truncate text-[10px] text-text-muted">{user?.email ?? userId}</p>
              </div>
              <div className="my-1 h-px bg-border-subtle" />
              <MenuItem>
                {({ focus }: { focus: boolean }) => (
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
                {({ focus }: { focus: boolean }) => (
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

      <CreateDomainModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        userId={userId}
      />

      <Transition appear show={profileOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setProfileOpen(false)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
          </TransitionChild>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-surface-default p-6 text-left align-middle shadow-xl transition-all border border-border-default">
                  <DialogTitle as="h3" className="text-lg font-semibold leading-6 text-text-default">
                    Profile Settings
                  </DialogTitle>
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-4">
                      {avatarUrl ? (
                        <Image
                          src={avatarUrl}
                          alt={displayName}
                          width={64}
                          height={64}
                          unoptimized
                          className="rounded-full object-cover border-2 border-border-subtle"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-action-primary-bg/10 text-xl font-bold text-action-primary-bg border-2 border-action-primary-bg/20">
                          {initials}
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-text-default">{displayName}</p>
                        <p className="text-sm text-text-muted">{user?.email}</p>
                      </div>
                    </div>

                    <div className="rounded-lg bg-surface-subtle p-4 border border-border-subtle">
                      <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Account Details</p>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-text-muted">User ID</span>
                          <span className="font-mono text-text-default">{userId.slice(0, 8)}...</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-text-muted">Auth Status</span>
                          <span className="capitalize text-status-success-text">{status.replace('_', ' ')}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end">
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-lg border border-transparent bg-action-primary-bg px-4 py-2 text-sm font-medium text-white hover:bg-action-primary-bg/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg focus-visible:ring-offset-2 transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
