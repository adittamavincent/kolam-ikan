// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDraftSystem } from '../useDraftSystem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- Test Personas ---
// Pak Hadi (retired journalist) — tests crash recovery and long content
// Raka (chaotic student) — tests rapid switching between streams

// Mock Supabase client
const mockSupabase = {
    auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    rpc: vi.fn(),
    from: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => mockSupabase,
}));

vi.mock('lodash/debounce', () => ({
    default: (fn: (...args: unknown[]) => unknown) => {
        const debounced = (...args: unknown[]) => fn(...args);
        debounced.cancel = vi.fn();
        debounced.flush = vi.fn(() => fn);
        return debounced;
    },
}));

describe('useDraftSystem - Edge Cases', () => {
    let queryClient: QueryClient;
    let wrapper: React.FC<{ children: React.ReactNode }>;

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        wrapper = ({ children }) =>
            React.createElement(QueryClientProvider, { client: queryClient }, children);

        vi.clearAllMocks();
        localStorage.clear();

        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'entries') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockResolvedValue({ data: null, error: null }),
                    update: vi.fn().mockReturnThis(),
                    delete: vi.fn().mockReturnThis(),
                    in: vi.fn().mockResolvedValue({ error: null }),
                };
            }
            if (table === 'sections') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                    update: vi.fn().mockReturnThis(),
                    insert: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { id: 'section-new' }, error: null }),
                    delete: vi.fn().mockReturnThis(),
                    in: vi.fn().mockResolvedValue({ error: null }),
                };
            }
            return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
        });
    });

    afterEach(() => {
        queryClient.clear();
    });

    // Scene: Pak Hadi's browser crashes, he switches to a new stream
    it('should initialize with no active entry for a new stream', async () => {
        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-new' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.activeEntryId).toBeNull();
    });

    // Scene: Pak Hadi tries to commit without writing anything
    it('should not create entry when committing with no sections', async () => {
        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        const mockUpdate = vi.fn();
        mockSupabase.from = vi.fn(() => ({
            update: mockUpdate,
            eq: vi.fn().mockResolvedValue({ error: null }),
        }));

        await act(async () => {
            await result.current.commitDraft();
        });

        // No database call should be made
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should not mark recovery available for empty local drafts', async () => {
        localStorage.setItem(
            'kolam_draft_stream-empty',
            JSON.stringify({
                entryId: null,
                sections: {
                    'inst-1': {
                        sectionId: null,
                        personaId: 'persona-a',
                        content: [{ id: 'b1', type: 'paragraph', content: [] }],
                        updatedAt: Date.now(),
                    },
                },
                updatedAt: Date.now(),
            })
        );

        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-empty' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.recoveryAvailable).toBe(false);
        expect(result.current.initialDrafts).toEqual({});
    });

    // Scene: Raka rapidly saves with same instanceId but different content
    it('should handle rapid content changes on same instance', async () => {
        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content1 = [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content2 = [{ id: 'b2', type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content3 = [{ id: 'b3', type: 'paragraph', content: [{ type: 'text', text: 'Third' }] }] as any;

        mockSupabase.rpc = vi.fn().mockResolvedValue({
            data: { id: 'entry-1', sections: [{ id: 'section-1' }] },
            error: null,
        });

        act(() => {
            result.current.saveDraft('inst-1', 'persona-a', content1, 'Raka');
        });

        await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

        const mockUpdate = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockResolvedValue({ error: null });
        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'sections') {
                return { update: mockUpdate, eq: mockEq };
            }
            if (table === 'entries') {
                return { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
            }
            return {};
        });

        // Rapid fire content changes
        act(() => {
            result.current.saveDraft('inst-1', 'persona-a', content2, 'Raka');
            result.current.saveDraft('inst-1', 'persona-a', content3, 'Raka');
        });

        await waitFor(() => {
            expect(mockUpdate).toHaveBeenCalled();
        });

        // Last content should win
        const lastCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1];
        expect(lastCall[0]).toMatchObject({
            content_json: content3,
        });
    });

    // Scene: Raka adds then removes a section
    it('should track section removal via setActiveInstances', async () => {
        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        mockSupabase.rpc = vi.fn().mockResolvedValue({
            data: { id: 'entry-1', sections: [{ id: 'section-1' }] },
            error: null,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }] as any;

        act(() => {
            result.current.saveDraft('inst-1', 'persona-a', content, 'Raka');
        });

        await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

        // Set active instances to empty (Raka removes all sections)
        act(() => {
            result.current.setActiveInstances([]);
        });

        // Try to commit with no active sections
        const mockUpdate = vi.fn();
        mockSupabase.from = vi.fn(() => ({
            update: mockUpdate,
            eq: vi.fn().mockResolvedValue({ error: null }),
        }));

        await act(async () => {
            await result.current.commitDraft();
        });

        // Should not proceed with commit
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    // Scene: Pak Hadi saves draft state to localStorage
    it('should call localStorage.setItem during save', async () => {
        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-local' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        mockSupabase.rpc = vi.fn().mockResolvedValue({
            data: { id: 'entry-local', sections: [{ id: 'section-local' }] },
            error: null,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Pak Hadi memoir draft' }] }] as any;

        act(() => {
            result.current.saveDraft('inst-1', 'persona-hadi', content, 'Pak Hadi');
        });

        await waitFor(() => {
            expect(localStorage.setItem).toHaveBeenCalled();
        });

        // Check the key includes the stream ID
        const calls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls;
        const hasStreamKey = calls.some(
            (call: string[]) => typeof call[0] === 'string' && call[0].includes('stream-local')
        );
        expect(hasStreamKey).toBe(true);
    });

    it('should ignore DB drafts with empty section content', async () => {
        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'entries') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockResolvedValue({
                        data: [
                            {
                                id: 'entry-empty',
                                updated_at: new Date().toISOString(),
                                sections: [
                                    {
                                        id: 'section-empty',
                                        persona_id: 'persona-a',
                                        content_json: [{ id: 'b1', type: 'paragraph', content: [] }],
                                        updated_at: new Date().toISOString(),
                                    },
                                ],
                            },
                        ],
                        error: null,
                    }),
                };
            }

            return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
        });

        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-empty-db' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.activeEntryId).toBeNull();
        expect(result.current.initialDrafts).toEqual({});
        expect(result.current.recoveryAvailable).toBe(false);
    });

    it('should clear section content when delete fails', async () => {
        const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-delete-fallback' }), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        mockSupabase.rpc = vi.fn().mockResolvedValue({
            data: { id: 'entry-1', sections: [{ id: 'section-1' }] },
            error: null,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Draft text' }] }] as any;

        act(() => {
            result.current.saveDraft('inst-1', 'persona-a', content, 'Persona A');
        });

        await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

        const mockDeleteEq = vi.fn().mockResolvedValue({ error: { message: 'delete failed' } });
        const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });
        const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'sections') {
                return {
                    delete: mockDelete,
                    update: mockUpdate,
                };
            }
            return {
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            };
        });

        act(() => {
            result.current.saveDraft('inst-1', 'persona-a', [], 'Persona A');
        });

        await waitFor(() => {
            expect(mockDelete).toHaveBeenCalled();
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    content_json: [],
                })
            );
        });
    });
});
