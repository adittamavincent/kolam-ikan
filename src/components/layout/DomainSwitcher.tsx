"use client";

import { Domain } from "@/lib/types";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Home,
  Plus,
  RefreshCw,
  LogOut,
  Settings,
  Search,
  Users,
  Paperclip,
} from "lucide-react";
import { useRouter, useParams, usePathname } from "next/navigation";
import Image from "next/image";
import { Fragment } from "react";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { useSidebar } from "@/lib/hooks/useSidebar";
import { useAuth } from "@/lib/hooks/useAuth";
import { CreateDomainModal } from "./CreateDomainModal";
import { useKeyboard } from "@/lib/hooks/useKeyboard";
import { useDomains } from "@/lib/hooks/useDomains";
import { EditDomainModal } from "./EditDomainModal";
import AttachmentsManager from "./AttachmentsManager";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
// PersonaManager is controlled at layout level so the global entry stays in sync

interface DomainSwitcherProps {
  userId: string;
  onOpenGlobalSearch?: () => void;
  onOpenPersona?: () => void;
}

export function DomainSwitcher({
  userId,
  onOpenGlobalSearch,
  onOpenPersona,
}: DomainSwitcherProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const params = useParams();
  const pathname = usePathname();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState<Domain | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [hoveredDomainTooltip, setHoveredDomainTooltip] = useState<{
    name: string;
    top: number;
  } | null>(null);
  const [pendingDomainId, setPendingDomainId] = useState<string | null>(null);
  const [pendingHome, setPendingHome] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const { user, status, loading, signOut } = useAuth();
  const { hide: hideSidebar } = useSidebar();

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  };

  const displayName =
    user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Account";
  const avatarUrl =
    user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null;
  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p: string) => p[0]?.toUpperCase())
      .join("") || "U";
  const profileMenuIdBase = `profile-menu-${userId}`;

  // Keyboard shortcut to open create modal
  useKeyboard([
    {
      key: "d",
      metaKey: true,
      handler: () => setIsCreateModalOpen(true),
      description: "Create Domain",
    },
    {
      key: "d",
      ctrlKey: true,
      handler: () => setIsCreateModalOpen(true),
      description: "Create Domain",
    },
  ]);

  const { domains } = useDomains(userId);

  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  const currentDomainId = params?.domain as string;
  const activeDomainId = pendingDomainId ?? currentDomainId;

  useEffect(() => {
    setPendingDomainId(null);
    setPendingHome(false);
  }, [pathname]);

  const navigateToHome = () => {
    setHoveredDomainTooltip(null);
    setPendingDomainId(null);
    setPendingHome(true);
    hideSidebar();
    startNavigation(() => {
      router.push("/");
    });
  };

  const navigateToDomain = (domainId: string) => {
    setHoveredDomainTooltip(null);
    setPendingHome(false);
    setPendingDomainId(domainId);
    startNavigation(() => {
      router.push(`/${domainId}`);
    });
  };

  const showDomainTooltip = (
    event: React.MouseEvent<HTMLButtonElement>,
    name: string,
  ) => {
    const root = switcherRef.current;
    if (!root) return;
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setHoveredDomainTooltip({
      name: `${name}`,
      top: buttonRect.top - rootRect.top + buttonRect.height / 2,
    });
  };

  return (
    <div
      ref={switcherRef}
      className="relative flex h-full w-12 flex-col items-center bg-surface-default border-r border-border-default z-50"
    >
      {/* Home / Root */}
      <div className="flex h-12 w-full shrink-0 items-center justify-center border-b border-border-default">
        <button
          onClick={navigateToHome}
          className={`group relative flex h-8 w-8 items-center justify-center  transition-all duration-200 ${
            pathname === "/" || pendingHome
              ? "bg-action-primary-bg text-white"
              : "bg-surface-subtle text-text-muted hover:bg-surface-hover hover:text-text-default"
          }`}
        >
          {pendingHome && isNavigating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Home className="h-4 w-4" />
          )}
          <div className="absolute left-14 hidden bg-surface-dark px-2 py-1 text-[10px] font-medium text-white group-hover:block whitespace-nowrap">
            Home
          </div>
        </button>
      </div>

      <div className="flex w-full flex-col items-center gap-2 border-b border-border-default py-2 px-2">
        <button
          onClick={() => onOpenGlobalSearch?.()}
          className="group relative flex h-8 w-8 items-center justify-center bg-surface-subtle text-text-muted transition-all duration-200 hover:bg-surface-hover hover:text-text-default"
          title="Global Search (⌘⇧K)"
        >
          <Search className="h-4 w-4" />
          <div className="absolute left-14 hidden bg-surface-dark px-2 py-1 text-[10px] font-medium text-white group-hover:block whitespace-nowrap">
            Global Search
          </div>
        </button>

        <button
          onClick={() => onOpenPersona?.()}
          className="group relative flex h-8 w-8 items-center justify-center bg-surface-subtle text-text-muted transition-all duration-200 hover:bg-surface-hover hover:text-text-default"
          title="Manage Personas"
        >
          <Users className="h-4 w-4" />
          <div className="absolute left-14 hidden bg-surface-dark px-2 py-1 text-[10px] font-medium text-white group-hover:block whitespace-nowrap">
            Personas
          </div>
        </button>

        <button
          onClick={() => setAttachmentsOpen(true)}
          className="group relative flex h-8 w-8 items-center justify-center bg-surface-subtle text-text-muted transition-all duration-200 hover:bg-surface-hover hover:text-text-default"
          title="Attachments"
        >
          <Paperclip className="h-4 w-4" />
          <div className="absolute left-14 hidden bg-surface-dark px-2 py-1 text-[10px] font-medium text-white group-hover:block whitespace-nowrap">
            Attachments
          </div>
        </button>
      </div>

      {/* Domain List */}
      <div className="flex-1 w-full flex flex-col items-center space-y-2 overflow-y-auto px-2 scrollbar-hide py-2">
        {!domains && (
          <div className="flex h-8 w-8 items-center justify-center">
            <RefreshCw className="h-3 w-3 animate-spin text-text-muted" />
          </div>
        )}

        {domains?.map((domain) => (
          <button
            key={domain.id}
            onClick={() => navigateToDomain(domain.id)}
            onMouseEnter={(event) => showDomainTooltip(event, domain.name)}
            onDoubleClick={() => {
              setHoveredDomainTooltip(null);
              setEditingDomain(domain);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setHoveredDomainTooltip(null);
              setEditingDomain(domain);
            }}
            onMouseLeave={() => setHoveredDomainTooltip(null)}
            title={`${domain.name} (double-click to edit)`}
            aria-label={domain.name}
            className={`group relative flex h-8 w-8 items-center justify-center  transition-all duration-200 ${
              activeDomainId === domain.id
                ? "bg-action-primary-bg text-white"
                : "bg-surface-subtle text-text-muted hover:bg-surface-hover hover:text-text-default"
            }`}
          >
            {pendingDomainId === domain.id && isNavigating ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {domain.icon ? (
                  <DynamicIcon name={domain.icon} className="h-4 w-4" />
                ) : (
                  <DynamicIcon name={domain.name} className="h-4 w-4" />
                )}
              </>
            )}
            {/* Active Indicator */}
            {activeDomainId === domain.id && (
              <div className="absolute -left-2 h-5 w-1 bg-action-primary-bg" />
            )}
            {pendingDomainId === domain.id && isNavigating && (
              <span className="absolute -bottom-1 -right-1 h-2 w-2 bg-action-primary-bg shadow-[0_0_0_2px_var(--bg-surface-default)]" />
            )}
          </button>
        ))}

        {/* Add Domain */}
        <button
          onClick={() => setIsCreateModalOpen(true)}
          aria-label="Add Domain"
          title="Add Domain"
          className="group relative flex h-8 w-8 items-center justify-center bg-surface-subtle text-text-muted transition-all duration-200 hover:bg-primary-950 hover:text-action-primary-bg"
        >
          <Plus className="h-4 w-4" />
          <div className="absolute left-14 hidden bg-surface-dark px-2 py-1 text-[10px] font-medium text-white group-hover:block whitespace-nowrap">
            Add Domain
          </div>
        </button>
      </div>

      {hoveredDomainTooltip && (
        <div
          className="pointer-events-none absolute left-14 z-60 -translate-y-1/2 whitespace-nowrap bg-surface-dark px-2 py-1 text-[10px] font-medium text-white"
          style={{ top: hoveredDomainTooltip.top }}
        >
          {hoveredDomainTooltip.name}
        </div>
      )}

      {/* User Menu / Profile at bottom */}
      <div className="mt-auto flex h-12 w-full shrink-0 items-center justify-center border-t border-border-default bg-surface-default">
        <Menu as="div" className="relative">
          <MenuButton
            id={`${profileMenuIdBase}-button`}
            className="flex h-8 w-8 items-center justify-center border border-border-default bg-surface-default text-text-default transition hover:bg-surface-subtle focus: focus: focus: overflow-hidden"
          >
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
              <div className="flex h-full w-full items-center justify-center bg-primary-950 text-xs font-semibold text-action-primary-bg">
                {initials}
              </div>
            )}
          </MenuButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0"
          >
            <MenuItems
              id={`${profileMenuIdBase}-items`}
              className="absolute bottom-full left-full z-50 mb-2 ml-2 w-56 border border-border-default bg-surface-default p-1 focus:"
            >
              <div className="px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Signed in as
                </p>
                <p className="truncate text-xs font-medium text-text-default">
                  {displayName}
                </p>
                <p className="truncate text-[10px] text-text-muted">
                  {user?.email ?? userId}
                </p>
              </div>
              <div className="my-1 h-px bg-border-subtle" />
              <MenuItem>
                {({ focus }: { focus: boolean }) => (
                  <button
                    onClick={() => setProfileOpen(true)}
                    className={`${focus ? "bg-surface-subtle" : ""} flex w-full items-center gap-2  px-3 py-2 text-xs text-text-default`}
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
                    disabled={loading || signingOut || status !== "signed_in"}
                    className={`${focus ? "bg-surface-subtle" : ""} flex w-full items-center gap-2  px-3 py-2 text-xs text-text-default disabled:opacity-50`}
                  >
                    <LogOut className="h-4 w-4 text-text-muted" />
                    {signingOut ? "Signing out..." : "Sign out"}
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

      <AttachmentsManager
        isOpen={attachmentsOpen}
        onClose={() => setAttachmentsOpen(false)}
        userId={userId}
      />

      <EditDomainModal
        key={editingDomain?.id ?? "domain-editor"}
        isOpen={Boolean(editingDomain)}
        onClose={() => setEditingDomain(null)}
        userId={userId}
        domain={editingDomain}
        onDeleteSuccess={(deletedDomainId) => {
          if (deletedDomainId === currentDomainId) {
            hideSidebar();
            router.push("/");
          }
        }}
      />

      <ModalShell
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        panelClassName="w-full p-6"
      >
        <ModalHeader
          title="Profile Settings"
          icon={<Settings className="h-5 w-5" />}
          onClose={() => setProfileOpen(false)}
          className="px-0 pb-4 pt-0"
          titleClassName="text-lg font-semibold leading-6 text-text-default"
        />
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={64}
                height={64}
                unoptimized
                className=" object-cover border-2 border-border-default"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center bg-primary-950 text-xl font-bold text-action-primary-bg border-2 border-border-subtle">
                {initials}
              </div>
            )}
            <div>
              <p className="font-semibold text-text-default">{displayName}</p>
              <p className="text-sm text-text-muted">{user?.email}</p>
            </div>
          </div>

          <div className=" bg-surface-subtle p-4 border border-border-default">
            <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">
              Account Details
            </p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">User ID</span>
                <span className="font-mono text-text-default">
                  {userId.slice(0, 8)}...
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Auth Status</span>
                <span className="capitalize text-status-success-text">
                  {status.replace("_", " ")}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="inline-flex justify-center border border-transparent bg-action-primary-bg px-4 py-2 text-sm font-medium text-white hover:bg-action-primary-hover focus: focus-visible: focus-visible: focus-visible: transition-colors"
            onClick={() => setProfileOpen(false)}
          >
            Close
          </button>
        </div>
      </ModalShell>

      {/* PersonaManager is rendered at the layout level to keep global entries in sync */}
    </div>
  );
}
