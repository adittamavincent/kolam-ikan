// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { EntryCreator } from "./EntryCreator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mocks
const { mockUseKeyboard } = vi.hoisted(() => ({
  mockUseKeyboard: vi.fn(),
}));
const mockMutate = vi.fn();
const mockMutateAsync = vi.fn();
const mockSaveDraft = vi.fn();
const mockCommitDraft = vi.fn();
const mockDraftContents: Record<string, unknown[]> = {};
const mockDraftMarkdown: Record<string, string> = {};
const mockPersonas = [
  { id: "p1", name: "Myself", icon: "User", color: "#0ea5e9" },
];
const mockGetDraftContent = (instanceId: string) =>
  mockDraftContents[instanceId] ?? [];
const mockGetDraftMarkdown = (instanceId: string) =>
  mockDraftMarkdown[instanceId] ?? "";
const mockGetFileAttachmentDraft = () => undefined;

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useMutation: (options: any) => {
      // Capture the mutation function to test it directly if needed,
      // or just mock the return
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutate: (args: any) => {
          mockMutate(args);
          // Simulate debounce completion / async
          if (options.onMutate) options.onMutate(args);

          // Simulate success to reset isSaving state
          // We return a mock result structure matching what the component expects
          const mockResult = {
            isUpdate: false,
            data: {
              id: "entry-1",
              sections: [{ id: "section-1" }],
            },
          };
          if (options.onSuccess) options.onSuccess(mockResult);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutateAsync: async (args: any) => {
          mockMutateAsync(args);
          if (options.onMutate) options.onMutate(args);

          const mockResult = { isUpdate: true, id: "entry-1" };
          if (options.onSuccess) options.onSuccess(mockResult);
          return mockResult;
        },
        isPending: false,
      };
    },
    useQueryClient: () => ({
      cancelQueries: vi.fn(),
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    }),
  };
});

const mockSupabase = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    getSession: vi.fn().mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "test@example.com" } } },
      error: null,
    }),
    onAuthStateChange: vi.fn(() => ({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    })),
  },
  rpc: vi.fn(),
  from: vi.fn(() => ({
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
  })),
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

vi.mock("@/lib/hooks/usePersonas", () => ({
  usePersonas: () => ({
    personas: mockPersonas,
  }),
}));

vi.mock("@/lib/hooks/useDocuments", () => ({
  useDocuments: () => ({
    documents: [],
    isLoading: false,
  }),
}));

vi.mock("@/components/features/documents/DocumentImportModal", () => ({
  DocumentImportModal: () => null,
}));

vi.mock("@/lib/hooks/useKeyboard", () => ({
  useKeyboard: mockUseKeyboard,
}));

vi.mock("@/lib/hooks/useDraftSystem", () => ({
  useDraftSystem: () => ({
    status: "idle",
    localStatus: "idle",
    saveDraft: mockSaveDraft,
    saveFileAttachmentDraft: vi.fn(),
    commitDraft: mockCommitDraft,
    initialDrafts: {},
    getDraftContent: mockGetDraftContent,
    getDraftMarkdown: mockGetDraftMarkdown,
    getFileAttachmentDraft: mockGetFileAttachmentDraft,
    isLoading: false,
    setActiveInstances: vi.fn(),
    flushPendingSaves: vi.fn(),
    clearDraft: vi.fn(),
  }),
}));

vi.mock("@/components/shared/MarkdownEditor", () => ({
  MarkdownEditor: ({
    onChange,
    initialContent,
    onEditorReady,
    onFocusChange,
    placeholder,
  }: {
    onChange: (content: unknown[], markdown: string) => void;
    initialContent?: Array<{
      content?: Array<{ text?: string }>;
    }>;
    onEditorReady?: (editor: {
      focus: () => void;
      isFocused: () => boolean;
    }) => void;
    onFocusChange?: (isFocused: boolean) => void;
    placeholder?: string;
  }) => {
    const focusedRef = React.useRef(false);

    React.useEffect(() => {
      onEditorReady?.({
        focus: () => {
          focusedRef.current = true;
          onFocusChange?.(true);
        },
        isFocused: () => focusedRef.current,
      });

      return () => {
        focusedRef.current = false;
        onFocusChange?.(false);
      };
      // Match the real editor lifecycle: ready registration happens on mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <textarea
        data-testid="mock-editor"
        defaultValue={initialContent?.[0]?.content?.[0]?.text || ""}
        placeholder={placeholder}
        onFocus={() => {
          focusedRef.current = true;
          onFocusChange?.(true);
        }}
        onBlur={() => {
          focusedRef.current = false;
          onFocusChange?.(false);
        }}
        onChange={(e) =>
          onChange(
            [{ content: [{ text: e.target.value }] }],
            e.target.value,
          )
        }
      />
    );
  },
}));

// We need to mock debounce to execute immediately or wait
vi.mock("lodash/debounce", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  default: (fn: Function) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debounced = (...args: any[]) => fn(...args);
    debounced.cancel = vi.fn();
    debounced.flush = vi.fn();
    return debounced;
  },
}));

describe("EntryCreator", () => {
  let queryClient: QueryClient;

  const triggerShortcut = (matcher: {
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
  }) => {
    const registeredShortcuts =
      mockUseKeyboard.mock.calls.at(-1)?.[0] ?? [];
    const shortcut = registeredShortcuts.find(
      (candidate: {
        key: string;
        metaKey?: boolean;
        shiftKey?: boolean;
        handler: (event: KeyboardEvent) => void;
      }) =>
        candidate.key === matcher.key &&
        Boolean(candidate.metaKey) === Boolean(matcher.metaKey) &&
        Boolean(candidate.shiftKey) === Boolean(matcher.shiftKey),
    );

    if (!shortcut) {
      throw new Error(`Shortcut not registered: ${matcher.key}`);
    }

    const preventDefault = vi.fn();
    shortcut.handler({ preventDefault } as unknown as KeyboardEvent);
    return preventDefault;
  };

  beforeEach(() => {
    queryClient = new QueryClient();
    vi.clearAllMocks();
    Object.keys(mockDraftContents).forEach((key) => delete mockDraftContents[key]);
    Object.keys(mockDraftMarkdown).forEach((key) => delete mockDraftMarkdown[key]);
    mockSaveDraft.mockImplementation(
      (
        instanceId: string,
        _personaId: string,
        content: unknown[],
        _personaName?: string,
        _forceDelete?: boolean,
        markdown?: string,
      ) => {
        mockDraftContents[instanceId] = content;
        mockDraftMarkdown[instanceId] = markdown ?? "";
      },
    );
    mockCommitDraft.mockResolvedValue("entry-1");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders correctly", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Add Persona")).toBeInTheDocument();
  });

  it("calls save mutation with isDraft: true on content change", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTitle("Quick add Myself"));

    const editor = await screen.findByTestId("mock-editor");
    fireEvent.change(editor, { target: { value: "Test content" } });

    expect(mockSaveDraft).toHaveBeenCalled();
  });

  it("calls save mutation with isDraft: false on commit", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTitle("Quick add Myself"));

    const editor = await screen.findByTestId("mock-editor");
    fireEvent.change(editor, { target: { value: "Test content" } });

    const commitBtn = await screen.findByText(/Commit Entry/);
    fireEvent.click(commitBtn);

    expect(mockCommitDraft).toHaveBeenCalled();
  });

  it("enables the commit button after typing meaningful content", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTitle("Quick add Myself"));

    const commitBtn = await screen.findByRole("button", {
      name: /commit entry/i,
    });
    expect(commitBtn).toBeDisabled();

    const editor = await screen.findByTestId("mock-editor");
    fireEvent.change(editor, { target: { value: "Test content" } });

    await waitFor(() => {
      expect(commitBtn).toBeEnabled();
    });
  });

  it("toggles the focused markdown section into fullscreen with Cmd+Shift+Enter", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTitle("Quick add Myself"));

    const editor = await screen.findByTestId("mock-editor");
    fireEvent.focus(editor);

    triggerShortcut({ key: "Enter", metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByTitle("Exit fullscreen editor")).toBeInTheDocument();
    });
    expect(
      screen.getByTitle("Toggle fullscreen: Cmd+Shift+Enter"),
    ).toBeInTheDocument();

    const fullscreenEditor = screen.getAllByTestId("mock-editor").at(-1);
    if (!fullscreenEditor) {
      throw new Error("Fullscreen editor not found");
    }
    fireEvent.focus(fullscreenEditor);

    triggerShortcut({ key: "Enter", metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(
        screen.queryByTitle("Exit fullscreen editor"),
      ).not.toBeInTheDocument();
    });
  });

  it("ignores the fullscreen shortcut when no markdown editor is focused", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EntryCreator streamId="stream-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTitle("Quick add Myself"));

    await screen.findByTestId("mock-editor");

    triggerShortcut({ key: "Enter", metaKey: true, shiftKey: true });

    expect(screen.queryByTitle("Exit fullscreen editor")).not.toBeInTheDocument();
  });
});
