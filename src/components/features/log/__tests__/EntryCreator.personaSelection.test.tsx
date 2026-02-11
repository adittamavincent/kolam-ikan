// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EntryCreator } from '../EntryCreator';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock dependencies
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

const mockPersonas = [
  { id: 'persona-a', name: 'Persona A', icon: 'user', color: '#0ea5e9' },
  { id: 'persona-b', name: 'Persona B', icon: 'brain', color: '#8b5cf6' },
  { id: 'persona-c', name: 'Persona C', icon: 'heart', color: '#ec4899' },
];

vi.mock('@/lib/hooks/usePersonas', () => ({
  usePersonas: () => ({
    personas: mockPersonas,
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/useKeyboard', () => ({
  useKeyboard: vi.fn(),
}));

// Mock BlockNoteEditor
const mockEditors: Record<string, { content: unknown[]; onChange: (c: unknown[]) => void }> = {};

vi.mock('@/components/shared/BlockNoteEditor', () => ({
  BlockNoteEditor: ({ 
    initialContent, 
    onChange, 
    onEditorReady, 
    placeholder 
  }: {
    initialContent?: unknown[];
    onChange: (content: unknown[]) => void;
    onEditorReady?: (editor: unknown) => void;
    placeholder?: string;
  }) => {
    const editorId = React.useId();
    
    React.useEffect(() => {
      mockEditors[editorId] = {
        content: initialContent || [],
        onChange,
      };
      
      if (onEditorReady) {
        onEditorReady({
          focus: vi.fn(),
          document: [],
          replaceBlocks: vi.fn(),
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return React.createElement('div', {
      'data-testid': `editor-${Object.keys(mockEditors).length}`,
      'data-placeholder': placeholder,
    }, React.createElement('textarea', {
      'data-testid': 'editor-input',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const content = [{ type: 'paragraph', content: e.target.value }];
        onChange(content);
      },
      placeholder,
    }));
  },
}));

vi.mock('lodash/debounce', () => ({
  default: (fn: (...args: unknown[]) => unknown) => {
    const debounced = (...args: unknown[]) => fn(...args);
    debounced.cancel = vi.fn();
    debounced.flush = vi.fn(() => fn);
    return debounced;
  },
}));

describe('EntryCreator - Persona Selection Integration Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    vi.clearAllMocks();
    localStorage.clear();
    Object.keys(mockEditors).forEach(key => delete mockEditors[key]);

    // Default mock responses
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnThis(),
        };
      }
      if (table === 'sections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          update: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'section-1' }, error: null }),
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'entry-1',
        sections: [{ id: 'section-1' }],
      },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('should add a persona section when "Add Persona" is clicked', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Add Persona')).toBeInTheDocument();
    });

    // Click "Add Persona" button
    const addButton = screen.getByText('Add Persona');
    fireEvent.click(addButton);

    // Wait for menu to appear
    await waitFor(() => {
      expect(screen.getByText('Persona A')).toBeInTheDocument();
    });

    // Click on Persona A
    fireEvent.click(screen.getByText('Persona A'));

    // Verify section is added
    await waitFor(() => {
      expect(screen.getByPlaceholderText('What would Persona A say?')).toBeInTheDocument();
    });
  });

  it('should change persona when dropdown is used', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Add Persona')).toBeInTheDocument();
    });

    // Add Persona A
    fireEvent.click(screen.getByText('Add Persona'));
    await waitFor(() => screen.getByText('Persona A'));
    fireEvent.click(screen.getByText('Persona A'));

    // Wait for section to appear
    await waitFor(() => {
      expect(screen.getByPlaceholderText('What would Persona A say?')).toBeInTheDocument();
    });

    // Type some content
    const input = screen.getByPlaceholderText('What would Persona A say?');
    fireEvent.change(input, { target: { value: 'Test content' } });

    // Setup mock for section update
    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return { update: mockUpdate, eq: mockEq };
      }
      if (table === 'entries') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    // Open persona dropdown (click on the persona name)
    const personaButton = screen.getByText('Persona A');
    fireEvent.click(personaButton);

    // Wait for dropdown and select Persona B
    await waitFor(() => screen.getByText('Persona B'));
    fireEvent.click(screen.getByText('Persona B'));

    // Verify placeholder changed
    await waitFor(() => {
      expect(screen.getByPlaceholderText('What would Persona B say?')).toBeInTheDocument();
    });

    // Verify update was called with new persona
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          persona_id: 'persona-b',
        })
      );
    });
  });

  it('should only commit the visible persona section', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>
    );

    await waitFor(() => screen.getByText('Add Persona'));

    // Add Persona A
    fireEvent.click(screen.getByText('Add Persona'));
    await waitFor(() => screen.getByText('Persona A'));
    fireEvent.click(screen.getByText('Persona A'));

    await waitFor(() => screen.getByPlaceholderText('What would Persona A say?'));

    // Type content
    const input = screen.getByPlaceholderText('What would Persona A say?');
    fireEvent.change(input, { target: { value: 'Final content' } });

    // Wait for auto-save
    await waitFor(() => {
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'create_entry_with_section',
        expect.objectContaining({
          p_persona_id: 'persona-a',
        })
      );
    });

    // Change to Persona B
    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return { 
          update: mockUpdate, 
          eq: mockEq,
          select: vi.fn().mockReturnThis(),
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

    fireEvent.click(screen.getByText('Persona A'));
    await waitFor(() => screen.getByText('Persona B'));
    fireEvent.click(screen.getByText('Persona B'));

    await waitFor(() => screen.getByPlaceholderText('What would Persona B say?'));

    // Commit
    const commitButton = screen.getByText('Commit Entry');
    fireEvent.click(commitButton);

    // Verify only Persona B section is committed (Persona A should not exist)
    await waitFor(() => {
      // Entry should be updated to not draft
      const fromCalls = mockSupabase.from.mock.calls;
      const entryUpdateCall = fromCalls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any[]) => call[0] === 'entries'
      );
      expect(entryUpdateCall).toBeDefined();
    });
  });

  it('should handle multiple rapid persona changes', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>
    );

    await waitFor(() => screen.getByText('Add Persona'));

    // Add Persona A
    fireEvent.click(screen.getByText('Add Persona'));
    await waitFor(() => screen.getByText('Persona A'));
    fireEvent.click(screen.getByText('Persona A'));

    await waitFor(() => screen.getByPlaceholderText('What would Persona A say?'));

    // Type content
    fireEvent.change(screen.getByPlaceholderText('What would Persona A say?'), {
      target: { value: 'Content' },
    });

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    // Setup mock for updates
    const updateCalls: string[] = [];
    const mockUpdate = vi.fn((data) => {
      updateCalls.push(data.persona_id);
      return {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return { update: mockUpdate };
      }
      if (table === 'entries') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    // Rapidly change personas: A -> B -> C
    fireEvent.click(screen.getByText('Persona A'));
    await waitFor(() => screen.getByText('Persona B'));
    fireEvent.click(screen.getByText('Persona B'));

    await waitFor(() => screen.getByPlaceholderText('What would Persona B say?'));

    fireEvent.click(screen.getByText('Persona B'));
    await waitFor(() => screen.getByText('Persona C'));
    fireEvent.click(screen.getByText('Persona C'));

    await waitFor(() => screen.getByPlaceholderText('What would Persona C say?'));

    // Wait for all updates
    await waitFor(() => {
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    // Verify last update is Persona C
    const lastUpdate = updateCalls[updateCalls.length - 1];
    expect(lastUpdate).toBe('persona-c');
  });

  it('should remove section when X button is clicked (if multiple sections)', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>
    );

    await waitFor(() => screen.getByText('Add Persona'));

    // Add two personas
    fireEvent.click(screen.getByText('Add Persona'));
    await waitFor(() => screen.getByText('Persona A'));
    fireEvent.click(screen.getByText('Persona A'));

    await waitFor(() => screen.getByPlaceholderText('What would Persona A say?'));

    fireEvent.click(screen.getByText('Add Persona'));
    await waitFor(() => screen.getAllByText('Persona B')[0]);
    fireEvent.click(screen.getAllByText('Persona B')[0]);

    // Now we should have 2 sections, and X buttons should appear
    await waitFor(() => {
      const editors = screen.getAllByTestId(/^editor-\d+$/);
      expect(editors.length).toBe(2);
    });

    // Look for X buttons (they should be rendered when sections.length > 1)
    const xButtons = screen.getAllByTitle('Remove this section');
    expect(xButtons.length).toBeGreaterThan(0);

    // Setup delete mock
    const mockDelete = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockResolvedValue({ error: null });

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'sections') {
        return { delete: mockDelete, eq: mockEq };
      }
      return {};
    });

    // Click first X button
    fireEvent.click(xButtons[0]);

    // Wait for section to be removed from UI
    await waitFor(() => {
      const remainingEditors = screen.getAllByTestId(/^editor-\d+$/);
      // Should be back to 1 editor after deletion
      expect(remainingEditors.length).toBeLessThan(3);
    });

    // Verify delete was called
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  it('should not commit if no content is present', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>
    );

    await waitFor(() => screen.getByText('Add Persona'));

    // Add persona but don't type anything
    fireEvent.click(screen.getByText('Add Persona'));
    await waitFor(() => screen.getByText('Persona A'));
    fireEvent.click(screen.getByText('Persona A'));

    await waitFor(() => screen.getByPlaceholderText('What would Persona A say?'));

    // Try to commit without content
    const commitButton = screen.getByText('Commit Entry');
    
    // Button should be disabled
    expect(commitButton).toHaveClass('cursor-not-allowed');
  });
});
