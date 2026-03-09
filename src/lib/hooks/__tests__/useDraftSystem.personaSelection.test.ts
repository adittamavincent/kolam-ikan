// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useDraftSystem } from '../useDraftSystem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PartialBlock } from '@blocknote/core';
import React from 'react';

// Mock Supabase client
const mockSupabase = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
  },
  from: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}));

describe('useDraftSystem - Persona Selection Logic', () => {
  let queryClient: QueryClient;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    queryClient = new QueryClient();
    wrapper = ({ children }) => (
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    );

    vi.clearAllMocks();
    localStorage.clear();

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'entry-new' }, error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }
      if (table === 'sections') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('should track only the active persona when changed within localStorage', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instanceId = 'instance-1';
    const content = [{ type: 'paragraph', content: 'Test content' }] as PartialBlock[];

    act(() => {
      result.current.saveDraft(instanceId, 'persona-a', content, 'Persona A');
    });

    let draftStr = localStorage.getItem('kolam_draft_v2_stream-1');
    expect(draftStr).toContain('persona-a');

    act(() => {
      result.current.saveDraft(instanceId, 'persona-b', content, 'Persona B');
    });

    draftStr = localStorage.getItem('kolam_draft_v2_stream-1');
    expect(draftStr).toContain('persona-b');
    expect(draftStr).not.toContain('persona-a'); // Overwritten
  });

  it('should only commit meaningful active sections', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instance1 = 'instance-1';
    const instance2 = 'instance-empty';
    const content = [{ type: 'paragraph', content: 'Test' }] as PartialBlock[];

    act(() => {
      result.current.saveDraft(instance1, 'persona-a', content, 'Persona A');
      result.current.saveDraft(instance2, 'persona-empty', [], 'Persona Empty'); // Empty content
    });

    const mockInsertSections = vi.fn().mockResolvedValue({ error: null });
    mockSupabase.from = vi.fn((table: string) => {
        if (table === 'sections') return { insert: mockInsertSections };
        if (table === 'entries') return { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }), delete: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
        return {};
    });

    await act(async () => {
      await result.current.commitDraft();
    });

    expect(mockInsertSections).toHaveBeenCalledTimes(1);
    const insertArgs = mockInsertSections.mock.calls[0][0];
    expect(insertArgs).toHaveLength(1); // Only instance1 should be inserted
    expect(insertArgs[0].persona_id).toBe('persona-a');
  });

  it('should handle rapid persona changes synchronously and commit correctly', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const instanceId = 'instance-1';
    const content = [{ type: 'paragraph', content: 'Test' }] as PartialBlock[];

    act(() => {
      result.current.saveDraft(instanceId, 'persona-a', content, 'Persona A');
      result.current.saveDraft(instanceId, 'persona-b', content, 'Persona B');
      result.current.saveDraft(instanceId, 'persona-c', content, 'Persona C');
      result.current.saveDraft(instanceId, 'persona-d', content, 'Persona D');
    });

    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') return { insert: mockInsert };
      if (table === 'entries') return { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }), delete: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
      return {};
    });

    await act(async () => {
      await result.current.commitDraft();
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0][0].persona_id).toBe('persona-d');
  });

  it('should prevent commit when no active sections have content', async () => {
    const { result } = renderHook(() => useDraftSystem({ streamId: 'stream-1' }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const mockInsert = vi.fn();
    mockSupabase.from = vi.fn(() => ({
      insert: mockInsert,
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }));

    await act(async () => {
      await result.current.commitDraft();
    });

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
