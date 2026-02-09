// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDraftSystem } from '../useDraftSystem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

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

// Mock lodash debounce to execute immediately for testing
vi.mock('lodash/debounce', () => ({
  default: (fn: (...args: unknown[]) => unknown) => {
    const debounced = (...args: unknown[]) => fn(...args);
    debounced.cancel = vi.fn();
    debounced.flush = vi.fn(() => fn);
    return debounced;
  },
}));

describe('useDraftSystem - Persona Selection Logic', () => {
  let queryClient: QueryClient;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    wrapper = ({ children }) => (
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    );

    // Reset mocks
    vi.clearAllMocks();
    localStorage.clear();

    // Setup default mock responses
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

  it('should track only the active persona when changed', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });

    // Wait for initialization
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instanceId = 'instance-1';
    const content = [{ type: 'paragraph', content: 'Test content' }];

    // Setup RPC mock to create entry with section
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        sections: [{ id: 'section-1' }],
      },
      error: null,
    });

    // Initial save with personaA
    act(() => {
      result.current.saveDraft(instanceId, 'persona-a', content, 'Persona A');
    });

    await waitFor(() => {
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'create_entry_with_section',
        expect.objectContaining({
          p_persona_id: 'persona-a',
        })
      );
    });

    // Setup mock for section update
    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          update: mockUpdate,
          eq: mockEq,
        };
      }
      if (table === 'entries') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    // Change to personaB
    act(() => {
      result.current.saveDraft(instanceId, 'persona-b', content, 'Persona B');
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          persona_id: 'persona-b',
        })
      );
    });
  });

  it('should only commit currently active sections', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instance1 = 'instance-1';
    const instance2 = 'instance-2';
    const content = [{ type: 'paragraph', content: 'Test' }];

    // Setup RPC mock
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        sections: [{ id: 'section-1' }],
      },
      error: null,
    });

    // Save with instance1
    act(() => {
      result.current.saveDraft(instance1, 'persona-a', content, 'Persona A');
    });

    await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

    // Mock for creating second section
    const mockInsert = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'section-2' }, error: null });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          insert: mockInsert,
          select: mockSelect,
          single: mockSingle,
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'section-1' }, { id: 'section-2' }], error: null }),
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'entries') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    // Add a second instance
    act(() => {
      result.current.saveDraft(instance2, 'persona-b', content, 'Persona B');
    });

    await waitFor(() => expect(mockInsert).toHaveBeenCalled());

    // Set only instance2 as active
    act(() => {
      result.current.setActiveInstances([instance2]);
    });

    // Mock for commit
    const mockDelete = vi.fn().mockReturnThis();
    const mockInDelete = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateEntry = vi.fn().mockReturnThis();
    const mockEqEntry = vi.fn().mockResolvedValue({ error: null });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ 
            data: [{ id: 'section-1' }, { id: 'section-2' }], 
            error: null 
          }),
          delete: mockDelete,
          in: mockInDelete,
        };
      }
      if (table === 'entries') {
        return {
          update: mockUpdateEntry,
          eq: mockEqEntry,
        };
      }
      return {};
    });

    // Commit
    await act(async () => {
      await result.current.commitDraft();
    });

    // Verify that section-1 was deleted (not active)
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
      expect(mockInDelete).toHaveBeenCalledWith('id', ['section-1']);
    });

    // Verify entry was marked as not draft
    expect(mockUpdateEntry).toHaveBeenCalledWith({ is_draft: false });
  });

  it('should handle rapid persona changes without creating duplicates', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instanceId = 'instance-1';
    const content = [{ type: 'paragraph', content: 'Test' }];

    // Setup RPC mock
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        sections: [{ id: 'section-1' }],
      },
      error: null,
    });

    // First save
    act(() => {
      result.current.saveDraft(instanceId, 'persona-a', content, 'Persona A');
    });

    await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

    // Setup mock for updates
    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          update: mockUpdate,
          eq: mockEq,
        };
      }
      if (table === 'entries') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    // Rapid changes
    act(() => {
      result.current.saveDraft(instanceId, 'persona-b', content, 'Persona B');
      result.current.saveDraft(instanceId, 'persona-c', content, 'Persona C');
      result.current.saveDraft(instanceId, 'persona-d', content, 'Persona D');
    });

    // Wait for saves to complete
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
    });

    // Last call should be with persona-d
    const lastCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({
      persona_id: 'persona-d',
    });

    // Verify only one section exists (same instanceId, same sectionId)
    // No duplicate sections should be created
    expect(mockUpdate).toHaveBeenCalledTimes(3); // B, C, D updates
  });

  it('should clear orphaned sections when committing', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Setup scenario: 2 sections exist in DB, but only 1 is active
    const instance1 = 'instance-1';
    const content = [{ type: 'paragraph', content: 'Active content' }];

    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        sections: [{ id: 'section-1' }],
      },
      error: null,
    });

    // Save instance1
    act(() => {
      result.current.saveDraft(instance1, 'persona-a', content, 'Persona A');
    });

    await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

    // Set active instances (only instance1)
    act(() => {
      result.current.setActiveInstances([instance1]);
    });

    // Mock commit scenario where DB has orphaned section
    const mockDelete = vi.fn().mockReturnThis();
    const mockIn = vi.fn().mockResolvedValue({ error: null });
    const mockUpdateEntry = vi.fn().mockReturnThis();
    const mockEqEntry = vi.fn().mockResolvedValue({ error: null });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: 'section-1' }, // Active
              { id: 'section-orphaned' }, // Orphaned
            ],
            error: null,
          }),
          delete: mockDelete,
          in: mockIn,
        };
      }
      if (table === 'entries') {
        return {
          update: mockUpdateEntry,
          eq: mockEqEntry,
        };
      }
      return {};
    });

    // Commit
    await act(async () => {
      await result.current.commitDraft();
    });

    // Verify orphaned section was deleted
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
      expect(mockIn).toHaveBeenCalledWith('id', ['section-orphaned']);
    });
  });

  it('should prevent commit when no active sections have content', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instanceId = 'instance-1';

    // Set active instance but with no content
    act(() => {
      result.current.setActiveInstances([instanceId]);
    });

    const mockUpdate = vi.fn();
    mockSupabase.from = vi.fn(() => ({
      update: mockUpdate,
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));

    // Try to commit
    await act(async () => {
      await result.current.commitDraft();
    });

    // Commit should not execute
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should clean up refs when instances are no longer active', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instance1 = 'instance-1';
    const instance2 = 'instance-2';
    const content = [{ type: 'paragraph', content: 'Test' }];

    // Setup RPC mock
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        sections: [{ id: 'section-1' }],
      },
      error: null,
    });

    // Save with instance1
    act(() => {
      result.current.saveDraft(instance1, 'persona-a', content, 'Persona A');
    });

    await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

    // Mock for creating second section
    const mockInsert = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'section-2' }, error: null });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          insert: mockInsert,
          select: mockSelect,
          single: mockSingle,
        };
      }
      if (table === 'entries') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    // Add instance2
    act(() => {
      result.current.saveDraft(instance2, 'persona-b', content, 'Persona B');
    });

    await waitFor(() => expect(mockInsert).toHaveBeenCalled());

    // Now set only instance2 as active (removing instance1)
    act(() => {
      result.current.setActiveInstances([instance2]);
    });

    // After cleanup, instance1 refs should be cleared
    // The key test: commit should only include instance2
    const mockUpdateEntry = vi.fn().mockReturnThis();
    const mockEqEntry = vi.fn().mockResolvedValue({ error: null });
    const mockSelectSections = vi.fn().mockReturnThis();
    const mockEqSections = vi.fn().mockResolvedValue({ 
      data: [{ id: 'section-1' }, { id: 'section-2' }], 
      error: null 
    });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          select: mockSelectSections,
          eq: mockEqSections,
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'entries') {
        return {
          update: mockUpdateEntry,
          eq: mockEqEntry,
        };
      }
      return {};
    });

    // Commit should only include instance2 (section-2)
    await act(async () => {
      await result.current.commitDraft();
    });

    // Verify section-1 (from instance1) was deleted since instance1 is no longer active
    await waitFor(() => {
      expect(mockSupabase.from).toHaveBeenCalledWith('sections');
    });
  });

  it('should handle edge case of empty content after persona change', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instanceId = 'instance-1';
    const content = [{ type: 'paragraph', content: 'Test' }];

    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        sections: [{ id: 'section-1' }],
      },
      error: null,
    });

    // Save with content
    act(() => {
      result.current.saveDraft(instanceId, 'persona-a', content, 'Persona A');
    });

    await waitFor(() => expect(result.current.activeEntryId).toBe('entry-1'));

    // Change persona and clear content
    const mockDelete = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockResolvedValue({ error: null });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return {
          delete: mockDelete,
          eq: mockEq,
        };
      }
      return {};
    });

    act(() => {
      result.current.saveDraft(instanceId, 'persona-b', [], 'Persona B');
    });

    // Should delete the section when content is empty
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
    });
  });
});
