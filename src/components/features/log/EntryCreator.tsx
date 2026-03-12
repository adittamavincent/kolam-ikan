'use client';

import React, { useState, useRef, Fragment, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { BlockNoteEditor as BlockNoteEditorType } from '@blocknote/core';
import { Loader2, Send, Check, Plus, X, ChevronDown, FileText, Upload, GripVertical, ExternalLink, Download, Eye } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { useKeyboard } from '@/lib/hooks/useKeyboard';
import { NavigationGuard } from './NavigationGuard';
import { useDraftSystem } from '@/lib/hooks/useDraftSystem';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { PdfAttachmentThumbnail } from './PdfAttachmentThumbnail';
import { DocumentImportModal } from '@/components/features/documents/DocumentImportModal';
import { DocumentWithLatestJob } from '@/lib/types';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableSection({ id, children }: { id: string; children: (dragHandleProps: React.HTMLAttributes<HTMLElement>) => React.ReactElement }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style = { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined };
    return <div ref={setNodeRef} style={style}>{children({ ...attributes, ...listeners })}</div>;
}

interface EntryCreatorProps {
    streamId: string;
    currentBranch?: string;
    onCurrentBranchChange?: (branchName: string) => void;
}

export function EntryCreator({ streamId, currentBranch }: EntryCreatorProps) {
    const supabase = createClient();
    const queryClient = useQueryClient();
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

    interface PdfAttachmentState {
        documentId: string;
        titleSnapshot: string;
        pageCount: number;
        author: string | null;
        creationDate: string | null;
        storagePath: string;
        previewUrl: string | null;
        annotationText?: string | null;
        referencedPersonaId?: string | null;
        referencedPage?: number | null;
    }

    type SectionState =
        | {
            instanceId: string;
            kind: 'PERSONA';
            personaId: string;
        }
        | {
            instanceId: string;
            kind: 'PDF';
            displayMode: 'inline' | 'download' | 'external';
            attachments: PdfAttachmentState[];
            note: string;
            isUploading: boolean;
        };

    const [sections, setSections] = useState<SectionState[]>([]);
    const [personaUsageCounts, setPersonaUsageCounts] = useState<Record<string, number>>(getInitialPersonaUsage);
    const [pdfPickerTargetInstanceId, setPdfPickerTargetInstanceId] = useState<string | null>(null);
    const selectedBranch = currentBranch ?? 'main';

    const { data: branches, refetch: refetchBranches } = useQuery({
        queryKey: ['branches', streamId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('branches')
                .select('*')
                .eq('stream_id', streamId);
            if (error) throw error;
            return data;
        },
        enabled: !!streamId,
    });

    // Refs for editors to clear them
    const editorRefs = useRef<Record<string, BlockNoteEditorType>>({});
    const pendingFocusInstanceIdRef = useRef<string | null>(null);

    const focusEditorForInstance = (instanceId: string) => {
        let attempts = 0;
        const maxAttempts = 10;

        const tryFocus = () => {
            const editor = editorRefs.current[instanceId];
            if (editor) {
                editor.focus();
                return;
            }

            attempts += 1;
            if (attempts < maxAttempts) {
                window.setTimeout(tryFocus, 30);
            }
        };

        // Delay one tick so focus wins after menu close/focus restoration.
        window.setTimeout(tryFocus, 0);
    };

    // Draft System Hook
    const {
        status,
        saveDraft,
        savePdfDraft,
        commitDraft,
        initialDrafts,
        getDraftContent,
        getPdfDraft,
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
                    ...(draft.sectionType === 'PDF'
                        ? {
                            kind: 'PDF' as const,
                            displayMode: draft.pdfDisplayMode ?? 'inline',
                            attachments: (draft.pdfAttachments ?? []).map((attachment) => ({
                                documentId: attachment.documentId,
                                titleSnapshot: attachment.titleSnapshot,
                                pageCount: 0,
                                author: null,
                                creationDate: null,
                                storagePath: '',
                                previewUrl: null,
                                annotationText: attachment.annotationText ?? null,
                                referencedPersonaId: attachment.referencedPersonaId ?? null,
                                referencedPage: attachment.referencedPage ?? null,
                            })),
                            note: '',
                            isUploading: false,
                        }
                        : {
                            kind: 'PERSONA' as const,
                            personaId: draft.personaId ?? '',
                        })
                }));
                setSections(loadedSections.filter((section) => {
                    if (section.kind === 'PDF') return true;
                    return !!section.personaId;
                }));
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
        setActiveInstances(sections.map((section) => section.instanceId));
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
            const committedEntryId = await commitDraft();

            if (!committedEntryId) {
                console.warn('Commit skipped: no meaningful content to persist.');
                return;
            }

            let targetBranch = branches?.find(b => b.name === selectedBranch);

            if (!targetBranch) {
                const { data: newBranch, error: createBranchError } = await supabase
                    .from('branches')
                    .insert({ stream_id: streamId, name: selectedBranch })
                    .select('*')
                    .single();
                if (createBranchError) throw createBranchError;
                targetBranch = newBranch;
            }

            if (targetBranch) {
                const { error: deleteError } = await supabase
                    .from('commit_branches')
                    .delete()
                    .eq('branch_id', targetBranch.id);
                if (deleteError) throw deleteError;

                const { error } = await supabase
                    .from('commit_branches')
                    .insert({ commit_id: committedEntryId, branch_id: targetBranch.id });
                if (error) throw error;
            }

            await refetchBranches();
            queryClient.invalidateQueries({ queryKey: ['commit-branches', streamId] });
            queryClient.invalidateQueries({ queryKey: ['branch-head-entry', streamId] });

            // Reset to empty state (no auto-default persona)
            setSections([]);
            editorRefs.current = {};
            pendingFocusInstanceIdRef.current = null;
        } catch (e) {
            console.error("Failed to commit", e);
        }
    };

    const addPersona = (pId: string) => {
        const instanceId = crypto.randomUUID();
        const persona = personas?.find((p) => p.id === pId);
        pendingFocusInstanceIdRef.current = instanceId;

        trackPersonaUsage(pId);
        setSections((prev) => [
            ...prev,
            { instanceId, kind: 'PERSONA', personaId: pId }
        ]);

        // Persist section creation immediately so empty sections survive reload.
        saveDraft(instanceId, pId, [], persona?.name);

        // Request focus immediately; helper retries until editor instance is ready.
        focusEditorForInstance(instanceId);
    };

    const removeSection = (instanceId: string) => {
        // Find the section and remaining list BEFORE updating state so we can
        // pass them to saveDraft synchronously (outside the updater).
        const section = sections.find(s => s.instanceId === instanceId);
        const remaining = sections.filter(s => s.instanceId !== instanceId);

        // Pure state update — no side effects inside the updater.
        setSections(remaining);

        if (section) {
            if (section.kind === 'PERSONA') {
                const persona = personas?.find(p => p.id === section.personaId);
                saveDraft(instanceId, section.personaId, [], persona?.name, true);
            } else {
                savePdfDraft(instanceId, {
                    displayMode: section.displayMode,
                    attachments: [],
                }, true);
            }
        }

        if (remaining.length === 0) {
            // Clear immediately when the last section is removed so clearing flags
            // are written before a fast page unload can interrupt async cleanup.
            void clearDraft();
        }

        if (pendingFocusInstanceIdRef.current === instanceId) {
            pendingFocusInstanceIdRef.current = null;
        }
    };

    const changePersona = (instanceId: string, newPersonaId: string) => {
        const section = sections.find(s => s.instanceId === instanceId);
        if (!section || section.kind !== 'PERSONA' || section.personaId === newPersonaId) return;

        const newPersona = personas?.find(p => p.id === newPersonaId);

        // Update state
        setSections(prev => prev.map(s => {
            if (s.instanceId !== instanceId || s.kind !== 'PERSONA') return s;
            return { ...s, personaId: newPersonaId };
        }));

        // Get current content and save with new persona
        // This will update the same section with the new persona
        const content = getDraftContent(instanceId);

        // Force immediate save to ensure refs are updated
        saveDraft(instanceId, newPersonaId, content, newPersona?.name);
        trackPersonaUsage(newPersonaId);

        // Keep typing context active on the currently selected persona section.
        focusEditorForInstance(instanceId);
    };

    const addPdfSection = () => {
        const instanceId = crypto.randomUUID();
        const nextSection: SectionState = {
            instanceId,
            kind: 'PDF',
            displayMode: 'inline',
            attachments: [],
            note: '',
            isUploading: false,
        };

        setSections((prev) => [...prev, nextSection]);
        savePdfDraft(instanceId, {
            displayMode: nextSection.displayMode,
            attachments: [],
            content: [],
        });
    };

    const updatePdfSection = (instanceId: string, updater: (section: Extract<SectionState, { kind: 'PDF' }>) => Extract<SectionState, { kind: 'PDF' }>) => {
        setSections((prev) => prev.map((section) => {
            if (section.instanceId !== instanceId || section.kind !== 'PDF') return section;
            return updater(section);
        }));
    };

    const persistPdfSection = (instanceId: string, draft?: Extract<SectionState, { kind: 'PDF' }>) => {
        const section = draft ?? sections.find((s) => s.instanceId === instanceId && s.kind === 'PDF');
        if (!section || section.kind !== 'PDF') return;

        savePdfDraft(instanceId, {
            displayMode: section.displayMode,
            attachments: section.attachments.map((attachment) => ({
                documentId: attachment.documentId,
                titleSnapshot: attachment.titleSnapshot,
                annotationText: attachment.annotationText ?? null,
                referencedPersonaId: attachment.referencedPersonaId ?? null,
                referencedPage: attachment.referencedPage ?? null,
            })),
            content: [],
        });
    };

    const attachDocumentToPdfSection = async (instanceId: string, document: DocumentWithLatestJob) => {
        updatePdfSection(instanceId, (section) => ({ ...section, isUploading: true }));

        const existing = sections.find((section) => section.instanceId === instanceId && section.kind === 'PDF') as Extract<SectionState, { kind: 'PDF' }> | undefined;
        if (existing?.attachments.some((attachment: PdfAttachmentState) => attachment.documentId === document.id)) {
            updatePdfSection(instanceId, (section) => ({ ...section, isUploading: false }));
            return;
        }

        const signed = await supabase.storage
            .from('document-files')
            .createSignedUrl(document.storage_path, 60 * 30);

        const sourceMetadata = (document.source_metadata ?? {}) as {
            pageCount?: number;
            extractedAuthor?: string;
            extractedCreationDate?: string;
        };

        const nextAttachment: PdfAttachmentState = {
            documentId: document.id,
            titleSnapshot: document.title,
            pageCount: sourceMetadata.pageCount ?? 0,
            author: sourceMetadata.extractedAuthor ?? null,
            creationDate: sourceMetadata.extractedCreationDate ?? null,
            storagePath: document.storage_path,
            previewUrl: signed.data?.signedUrl ?? null,
            annotationText: null,
            referencedPersonaId: null,
            referencedPage: null,
        };

        let draftToPersist: Extract<SectionState, { kind: 'PDF' }> | null = null;
        updatePdfSection(instanceId, (section) => {
            const updated: Extract<SectionState, { kind: 'PDF' }> = {
                ...section,
                isUploading: false,
                attachments: [...section.attachments, nextAttachment],
            };
            draftToPersist = updated;
            return updated;
        });

        if (draftToPersist) {
            persistPdfSection(instanceId, draftToPersist);
        }
    };

    const removePdfAttachment = (instanceId: string, documentId: string) => {
        let draftToPersist: Extract<SectionState, { kind: 'PDF' }> | null = null;
        updatePdfSection(instanceId, (section) => {
            const updated: Extract<SectionState, { kind: 'PDF' }> = {
                ...section,
                attachments: section.attachments.filter((attachment) => attachment.documentId !== documentId),
            };
            draftToPersist = updated;
            return updated;
        });

        if (draftToPersist) {
            persistPdfSection(instanceId, draftToPersist);
        }
    };

    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setSections((prev) => {
                const oldIndex = prev.findIndex((s) => s.instanceId === active.id);
                const newIndex = prev.findIndex((s) => s.instanceId === over.id);
                return arrayMove(prev, oldIndex, newIndex);
            });
        }
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

                {/* Persona picker */}
                <div className={`flex items-center gap-2 flex-wrap px-3 py-2 bg-surface-subtle/50 rounded-t-xl ${sections.length > 0 ? 'border-b border-border-default/50' : 'rounded-b-xl'}`}>
                    <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">New Entry as</span>

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

                    <Menu as="div" className="relative z-30">
                        <MenuButton
                            className="flex items-center gap-1.5 rounded-lg py-1 px-2 text-xs font-medium transition-colors hover:bg-surface-subtle border border-transparent hover:border-border-subtle focus:outline-none"
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
                            <MenuItems
                                anchor={{ to: 'bottom start', gap: 4 }}
                                portal
                                className="z-9999 w-56 max-h-60 overflow-y-auto overflow-hidden rounded-xl border border-border-default bg-surface-elevated p-1 shadow-2xl ring-1 ring-black/10 focus:outline-none"
                            >
                                <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                    Add Author Section
                                </div>
                                {personas?.map((persona) => (
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
                                ))}
                            </MenuItems>
                        </Transition>
                    </Menu>

                    <button
                        onClick={addPdfSection}
                        className="flex items-center gap-1.5 rounded-lg py-1 px-2 text-xs font-medium transition-colors hover:bg-surface-subtle border border-transparent hover:border-border-subtle focus:outline-none"
                        title="Add PDF attachment section"
                    >
                        <FileText className="h-3 w-3 text-text-subtle" />
                        <span className="text-text-default">Add PDF Section</span>
                    </button>
                </div>

                {/* Editor sections */}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sections.map(s => s.instanceId)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col divide-y divide-border-subtle/30">
                    {sections.map((section) => {
                        const { instanceId } = section;

                        if (section.kind === 'PERSONA') {
                            const persona = personas?.find(p => p.id === section.personaId);
                            if (!persona) return null;

                            return (
                                <SortableSection key={instanceId} id={instanceId}>
                                {(dragHandleProps) => (
                                <div className="flex flex-col">
                                    <div className="flex items-center justify-between px-4 py-1.5 bg-surface-subtle/50 border-y border-border-subtle/70">
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="cursor-grab rounded p-0.5 text-text-muted hover:bg-surface-subtle active:cursor-grabbing"
                                                aria-label="Drag to reorder"
                                                {...dragHandleProps}
                                            >
                                                <GripVertical className="h-3 w-3" />
                                            </button>

                                            <Menu as="div" className="relative z-30">
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
                                                    <MenuItems
                                                        anchor={{ to: 'bottom start', gap: 4 }}
                                                        portal
                                                        className="z-9999 w-48 max-h-60 overflow-y-auto overflow-hidden rounded-xl border border-border-default bg-surface-elevated p-1 shadow-2xl ring-1 ring-black/10 focus:outline-none"
                                                    >
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
                                                                        {p.id === section.personaId && <Check className="h-3 w-3 ml-auto" />}
                                                                    </button>
                                                                )}
                                                            </MenuItem>
                                                        ))}
                                                    </MenuItems>
                                                </Transition>
                                            </Menu>
                                        </div>

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
                                            onChange={(content) => saveDraft(instanceId, section.personaId, content, persona.name)}
                                            placeholder={`What would ${persona.name} say?`}
                                            onEditorReady={(editor) => {
                                                editorRefs.current[instanceId] = editor;
                                                if (pendingFocusInstanceIdRef.current === instanceId) {
                                                    pendingFocusInstanceIdRef.current = null;
                                                    focusEditorForInstance(instanceId);
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                                )}
                                </SortableSection>
                            );
                        }

                        const pdfSection = section as Extract<SectionState, { kind: 'PDF' }>;
                        const pdfDraft = getPdfDraft(instanceId);
                        const effectiveAttachments = pdfSection.attachments.length > 0 ? pdfSection.attachments : pdfDraft.attachments.map((attachment) => ({
                            documentId: attachment.documentId,
                            titleSnapshot: attachment.titleSnapshot,
                            pageCount: 0,
                            author: null,
                            creationDate: null,
                            storagePath: '',
                            previewUrl: null,
                            annotationText: attachment.annotationText ?? null,
                            referencedPersonaId: attachment.referencedPersonaId ?? null,
                            referencedPage: attachment.referencedPage ?? null,
                        }));

                        return (
                            <SortableSection key={instanceId} id={instanceId}>
                            {(dragHandleProps) => (
                            <div className="flex flex-col bg-surface-subtle/25">
                                <div className="flex items-center justify-between px-4 py-1.5 bg-surface-subtle/50 border-y border-border-subtle/70">
                                    <div className="flex items-center gap-2">
                                        <button
                                            className="cursor-grab rounded p-0.5 text-text-muted hover:bg-surface-subtle active:cursor-grabbing"
                                            aria-label="Drag to reorder"
                                            {...dragHandleProps}
                                        >
                                            <GripVertical className="h-3 w-3" />
                                        </button>
                                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                                            <FileText className="h-3 w-3" />
                                            PDF Section
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => removeSection(instanceId)}
                                        className="text-text-muted hover:text-text-default p-0.5 rounded hover:bg-surface-subtle transition-colors"
                                        title="Remove this PDF section"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>

                                <div className="p-4 space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-default hover:bg-surface-default"
                                            onClick={() => setPdfPickerTargetInstanceId(instanceId)}
                                        >
                                            <Upload className="h-3 w-3" />
                                            Import / Select PDF
                                        </button>

                                        {section.isUploading && (
                                            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                Uploading PDFs...
                                            </span>
                                        )}
                                    </div>

                                    {effectiveAttachments.length === 0 ? (
                                        <div className="rounded-lg border border-dashed border-border-subtle bg-surface-subtle/30 px-3 py-4 text-center text-xs text-text-muted">
                                            Drop or attach one or more PDFs to start building this section.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {effectiveAttachments.map((attachment) => (
                                                <div key={attachment.documentId} className="rounded-lg border border-border-subtle bg-surface-default px-3 py-2">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex items-center gap-2">
                                                            <PdfAttachmentThumbnail url={attachment.previewUrl} title={attachment.titleSnapshot} />
                                                            <div>
                                                                <div className="text-xs font-medium text-text-default">{attachment.titleSnapshot}</div>
                                                                <div className="text-[11px] text-text-muted">
                                                                    {attachment.pageCount > 0 ? `${attachment.pageCount} pages` : 'PDF'}
                                                                    {attachment.author ? ` • ${attachment.author}` : ''}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-1">
                                                            {attachment.previewUrl && (
                                                                <>
                                                                    <a
                                                                        href={attachment.previewUrl}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="rounded p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
                                                                        aria-label="Open PDF preview"
                                                                    >
                                                                        {section.displayMode === 'download' ? <Download className="h-3.5 w-3.5" /> : section.displayMode === 'external' ? <ExternalLink className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                                                    </a>
                                                                    {section.displayMode === 'inline' && (
                                                                        <iframe
                                                                            src={attachment.previewUrl}
                                                                            className="h-24 w-40 rounded border border-border-subtle"
                                                                            title={`Inline preview for ${attachment.titleSnapshot}`}
                                                                        />
                                                                    )}
                                                                </>
                                                            )}
                                                            <button
                                                                onClick={() => removePdfAttachment(instanceId, attachment.documentId)}
                                                                className="rounded p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
                                                                aria-label={`Remove ${attachment.titleSnapshot}`}
                                                            >
                                                                <X className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            )}
                            </SortableSection>
                        );
                    })}
                </div>
                </SortableContext>
                </DndContext>

                {/* Footer — commit action */}
                {sections.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 bg-surface-subtle/50 border-t border-border-default/50 rounded-b-xl">
                        <div className="text-[10px] text-text-muted">
                            <kbd className="rounded border border-border-subtle bg-surface-subtle px-1 py-0.5 text-[9px] font-mono">⌘+Enter</kbd>
                            <span className="mx-1">→</span>
                            <span className="font-medium">{selectedBranch || 'main'}</span>
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
                            Commit
                        </button>
                    </div>
                )}
            </div>

            <DocumentImportModal
                isOpen={!!pdfPickerTargetInstanceId}
                onClose={() => setPdfPickerTargetInstanceId(null)}
                streamId={streamId}
                onSelectDocument={(document) => {
                    if (!pdfPickerTargetInstanceId) return;
                    void attachDocumentToPdfSection(pdfPickerTargetInstanceId, document);
                }}
            />
        </div>
    );
}
