'use client';

import { useState, useRef, Fragment, useEffect, useMemo, useCallback } from 'react';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { BlockNoteEditor as BlockNoteEditorType } from '@blocknote/core';
import { Loader2, Send, Check, Plus, X, ChevronDown } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { useKeyboard } from '@/lib/hooks/useKeyboard';
import { NavigationGuard } from './NavigationGuard';
import { useDraftSystem } from '@/lib/hooks/useDraftSystem';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';

interface EntryCreatorProps {
    streamId: string;
}

export function EntryCreator({ streamId }: EntryCreatorProps) {
    const { personas } = usePersonas();
    const personaUsageStorageKey = `entry-creator:persona-usage:${streamId}`;

    const getInitialPersonaUsage = () => {
        if (typeof window === 'undefined') return {} as Record<string, number>;
        try {
            const stored = window.localStorage.getItem(personaUsageStorageKey);
            if (!stored) return {} as Record<string, number>;
            return JSON.parse(stored) as Record<string, number>;
        } catch {
            return {} as Record<string, number>;
        }
    };

    // State for sections (instances)
    interface SectionState {
        instanceId: string;
        personaId: string;
    }
    const [sections, setSections] = useState<SectionState[]>([]);
    const [personaUsageCounts, setPersonaUsageCounts] = useState<Record<string, number>>(getInitialPersonaUsage);

    // Refs for editors to clear them
    const editorRefs = useRef<Record<string, BlockNoteEditorType>>({});

    // Draft System Hook
    const {
        status,
        saveDraft,
        commitDraft,
        initialDrafts,
        getDraftContent,
        isLoading,
        setActiveInstances,
        flushPendingSaves,
        recoveryAvailable,
        discardRecovery,
        clearDraft,
    } = useDraftSystem({
        streamId
    });
    const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(true);
    const [discardedRecovery, setDiscardedRecovery] = useState(false);

    useEffect(() => {
        try {
            localStorage.setItem(personaUsageStorageKey, JSON.stringify(personaUsageCounts));
        } catch {
            // Ignore write failures (quota/private mode).
        }
    }, [personaUsageCounts, personaUsageStorageKey]);

    const quickPersonas = useMemo(() => {
        if (!personas?.length) return [];
        return [...personas]
            .sort((a, b) => {
                const countA = personaUsageCounts[a.id] ?? 0;
                const countB = personaUsageCounts[b.id] ?? 0;
                if (countA !== countB) return countB - countA;
                return a.name.localeCompare(b.name);
            })
            .slice(0, 3);
    }, [personas, personaUsageCounts]);

    const trackPersonaUsage = (personaId: string) => {
        setPersonaUsageCounts((prev) => ({
            ...prev,
            [personaId]: (prev[personaId] ?? 0) + 1,
        }));
    };

    // Initialize selection with existing drafts only
    useEffect(() => {
        if (sections.length === 0 && !isLoading && !discardedRecovery) {
            // If we have initial drafts, use them
            if (initialDrafts && Object.keys(initialDrafts).length > 0) {
                const loadedSections = Object.entries(initialDrafts).map(([instanceId, draft]) => ({
                    instanceId,
                    personaId: draft.personaId
                }));
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setSections(loadedSections);
            }
            // Don't auto-initialize with a default persona
            // Let the user explicitly select a persona or add a section
        }
    }, [initialDrafts, isLoading, sections.length, discardedRecovery]);

    const handleKeepRecovery = () => {
        setDiscardedRecovery(false);
        setShowRecoveryPrompt(false);
    };

    const handleDiscardRecovery = () => {
        setDiscardedRecovery(true);
        discardRecovery();
        setSections([]);
        editorRefs.current = {};
        setShowRecoveryPrompt(false);
    };

    // Sync active instances with draft system whenever sections change
    useEffect(() => {
        setActiveInstances();
    }, [sections, setActiveInstances]);

    // Keyboard shortcuts
    useKeyboard([
        {
            key: 'n',
            metaKey: true,
            description: 'New Entry',
            handler: (e) => {
                e.preventDefault();
                // Focus the first editor
                const firstInstanceId = sections[0]?.instanceId;
                if (firstInstanceId && editorRefs.current[firstInstanceId]) {
                    editorRefs.current[firstInstanceId].focus();
                }
            },
        },
        {
            key: 'Enter',
            metaKey: true,
            description: 'Commit Entry',
            handler: (e) => {
                e.preventDefault();
                handleCommit();
            }
        }
    ]);

    const handleCommit = async () => {
        try {
            await commitDraft();

            // Reset to empty state (no auto-default persona)
            setSections([]);
            editorRefs.current = {};
        } catch (e) {
            console.error("Failed to commit", e);
        }
    };

    const addPersona = (pId: string) => {
        const instanceId = crypto.randomUUID();
        const persona = personas?.find((p) => p.id === pId);

        trackPersonaUsage(pId);
        setSections((prev) => [
            ...prev,
            { instanceId, personaId: pId }
        ]);

        // Persist section creation immediately so empty sections survive reload.
        saveDraft(instanceId, pId, [], persona?.name);
    };

    const removeSection = useCallback((instanceId: string) => {
        // Find the section and remaining list BEFORE updating state so we can
        // pass them to saveDraft synchronously (outside the updater).
        const section = sections.find(s => s.instanceId === instanceId);
        const remaining = sections.filter(s => s.instanceId !== instanceId);

        // Pure state update — no side effects inside the updater.
        setSections(remaining);

        if (section) {
            const persona = personas?.find(p => p.id === section.personaId);
            // Always call saveDraft(forceDelete=true) synchronously regardless of
            // whether this is the last section. This clears contentRefs.current[instanceId]
            // and localStorage immediately — BEFORE React re-renders or effects run.
            // Without this, if the user reloads instantly after clicking X, the
            // beforeunload handler reads stale contentRefs and sends a beacon that
            // resurrects the section in the DB. For the last-section case, clearDraft()
            // then awaits this section delete and deletes the full entry from DB.
            saveDraft(instanceId, section.personaId, [], persona?.name, true);
        }

        if (remaining.length === 0) {
            // Clear immediately when the last section is removed so clearing flags
            // are written before a fast page unload can interrupt async cleanup.
            void clearDraft();
        }
    }, [sections, personas, saveDraft, clearDraft]);

    const changePersona = (instanceId: string, newPersonaId: string) => {
        const section = sections.find(s => s.instanceId === instanceId);
        if (!section || section.personaId === newPersonaId) return;

        const newPersona = personas?.find(p => p.id === newPersonaId);

        // Update state
        setSections(prev => prev.map(s => s.instanceId === instanceId ? { ...s, personaId: newPersonaId } : s));

        // Get current content and save with new persona
        // This will update the same section with the new persona
        const content = getDraftContent(instanceId);

        // Force immediate save to ensure refs are updated
        saveDraft(instanceId, newPersonaId, content, newPersona?.name);
        trackPersonaUsage(newPersonaId);
    };

    if (isLoading) {
        return (
            <div className="relative rounded-xl border border-border-default bg-surface-default p-4 min-h-25 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
        );
    }

    return (
        <div className="relative rounded-xl border border-border-default bg-surface-default group">
            {/* Navigation Guard - warn if saving or error */}
            {(status === 'saving' || status === 'error') && <NavigationGuard onFlush={flushPendingSaves} />}

            <div className="flex flex-col">
                {recoveryAvailable && showRecoveryPrompt && (
                    <div className="rounded-t-xl border-b border-border-subtle/50 bg-surface-subtle px-4 py-2 text-[11px] text-text-default">
                        <div className="flex items-center justify-between gap-2">
                            <span>Recovered unsaved work from a previous session.</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleKeepRecovery}
                                    className="rounded bg-action-primary-bg px-2 py-1 text-[10px] text-action-primary-text hover:bg-action-primary-hover"
                                >
                                    Keep
                                </button>
                                <button
                                    onClick={handleDiscardRecovery}
                                    className="rounded bg-surface-default px-2 py-1 text-[10px] text-text-default hover:bg-surface-hover"
                                >
                                    Discard
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Header / Persona Selector */}
                <div className={`flex items-center justify-between px-4 pt-3 ${sections.length > 0 ? 'pb-1 border-b border-border-subtle/50' : 'pb-3'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-text-subtle uppercase tracking-wider">New Entry as</span>

                        {quickPersonas.map((persona) => (
                            <button
                                key={`quick-persona-${persona.id}`}
                                onClick={() => addPersona(persona.id)}
                                className="flex items-center gap-1.5 rounded-lg border border-border-subtle/70 bg-surface-subtle/40 px-2 py-1 text-[11px] font-medium text-text-default transition-colors hover:bg-surface-subtle"
                                title={`Quick add ${persona.name}`}
                            >
                                <div
                                    className="flex h-4 w-4 items-center justify-center rounded"
                                    style={{ backgroundColor: `${persona.color}20`, color: persona.color }}
                                >
                                    <DynamicIcon name={persona.icon} className="h-2.5 w-2.5" />
                                </div>
                                <span>{persona.name}</span>
                            </button>
                        ))}

                        <Menu as="div" className="relative z-10">
                            <MenuButton
                                className="flex items-center gap-2 rounded-lg py-1 px-2 text-xs font-medium transition-colors hover:bg-surface-subtle border border-transparent hover:border-border-subtle focus:outline-none"
                            >
                                <Plus className="h-3 w-3 text-text-subtle" />
                                <span className="text-text-default">Add Persona</span>
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
                                <MenuItems className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border-default bg-surface-default p-1 ring-1 ring-black/5 focus:outline-none max-h-60 overflow-y-auto">
                                    <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                        Add Author Section
                                    </div>
                                    {personas?.map((persona) => {
                                        return (
                                            <MenuItem key={persona.id}>
                                                {({ active }) => (
                                                    <button
                                                        onClick={() => {
                                                            addPersona(persona.id);
                                                        }}
                                                        className={`${active ? 'bg-surface-subtle text-text-default' : 'text-text-subtle'
                                                            } group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <div
                                                                className="flex h-5 w-5 items-center justify-center rounded"
                                                                style={{ backgroundColor: `${persona.color}20`, color: persona.color }}
                                                            >
                                                                <DynamicIcon name={persona.icon} className="h-3 w-3" />
                                                            </div>
                                                            <span>{persona.name}</span>
                                                        </div>
                                                    </button>
                                                )}
                                            </MenuItem>
                                        );
                                    })}
                                </MenuItems>
                            </Transition>
                        </Menu>
                    </div>

                    <div className="flex items-center gap-2">
                        {status === 'saving' && <span className="text-[10px] text-text-muted animate-pulse">Saving...</span>}
                        {status === 'error' && <span className="text-[10px] text-status-error-text">Error saving draft</span>}
                    </div>
                </div>

                {/* Editor Area - List of Editors */}
                <div className="flex flex-col divide-y divide-border-subtle/30">
                    {sections.map((section) => {
                        const { instanceId, personaId } = section;
                        const persona = personas?.find(p => p.id === personaId);
                        if (!persona) return null;

                        return (
                            <div key={instanceId} className="flex flex-col">
                                {/* Persona Header (always show for consistency in multi-section mode, or only if multiple?) */}
                                {/* Showing always is clearer which section is which */}
                                <div className="flex items-center justify-between px-4 py-1.5 bg-surface-subtle/10">
                                    <Menu as="div" className="relative z-10">
                                        <MenuButton className="flex items-center gap-2 rounded hover:bg-surface-subtle/50 px-1 py-0.5 transition-colors focus:outline-none">
                                            <div
                                                className="flex h-4 w-4 items-center justify-center rounded"
                                                style={{ backgroundColor: `${persona.color}20`, color: persona.color }}
                                            >
                                                <DynamicIcon name={persona.icon} className="h-2.5 w-2.5" />
                                            </div>
                                            <span className="text-[10px] font-medium text-text-subtle">{persona.name}</span>
                                            <ChevronDown className="h-3 w-3 text-text-muted opacity-50" />
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
                                            <MenuItems className="absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-border-default bg-surface-default p-1 ring-1 ring-black/5 focus:outline-none max-h-60 overflow-y-auto">
                                                <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                                    Switch to...
                                                </div>
                                                {personas?.map((p) => (
                                                    <MenuItem key={p.id}>
                                                        {({ active }) => (
                                                            <button
                                                                onClick={() => {
                                                                    changePersona(instanceId, p.id);
                                                                }}
                                                                className={`${active ? 'bg-surface-subtle text-text-default' : 'text-text-subtle'
                                                                    } group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors`}
                                                            >
                                                                <div
                                                                    className="flex h-4 w-4 items-center justify-center rounded"
                                                                    style={{ backgroundColor: `${p.color}20`, color: p.color }}
                                                                >
                                                                    <DynamicIcon name={p.icon} className="h-2.5 w-2.5" />
                                                                </div>
                                                                <span>{p.name}</span>
                                                                {p.id === personaId && <Check className="h-3 w-3 ml-auto" />}
                                                            </button>
                                                        )}
                                                    </MenuItem>
                                                ))}
                                            </MenuItems>
                                        </Transition>
                                    </Menu>

                                    <button
                                        onClick={() => removeSection(instanceId)}
                                        className="text-text-muted hover:text-text-default p-0.5 rounded hover:bg-surface-subtle transition-colors"
                                        title="Remove this section"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>

                                <div className="p-4 min-h-20">
                                    <BlockNoteEditor
                                        initialContent={getDraftContent(instanceId)}
                                        onChange={(content) => saveDraft(instanceId, personaId, content, persona.name)}
                                        placeholder={`What would ${persona.name} say?`}
                                        onEditorReady={(editor) => { editorRefs.current[instanceId] = editor; }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer Actions */}
                {sections.length > 0 && (
                    <div className="flex items-center justify-between px-4 py-2 bg-surface-subtle/30 border-t border-border-subtle/50">
                        <div className="text-[10px] text-text-muted">
                            <span className="font-medium">Cmd+Enter</span> to commit
                        </div>
                        <button
                            onClick={handleCommit}
                            disabled={status === 'saving'}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${status !== 'saving'
                                ? 'bg-action-primary-bg text-white hover:bg-action-primary-hover'
                                : 'bg-surface-subtle text-text-muted cursor-not-allowed'
                                }`}
                        >
                            <Send className="h-3 w-3" />
                            Commit Entry
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
