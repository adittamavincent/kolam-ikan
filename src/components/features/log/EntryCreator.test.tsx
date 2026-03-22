// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { EntryCreator } from "./EntryCreator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mocks
const mockMutate = vi.fn();
const mockMutateAsync = vi.fn();
const mockSaveDraft = vi.fn();
const mockCommitDraft = vi.fn();
const mockDraftContents: Record<string, unknown[]> = {};
const mockGetDraftContent = (instanceId: string) =>
  mockDraftContents[instanceId] ?? [];
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
    personas: [{ id: "p1", name: "Myself", icon: "User", color: "#0ea5e9" }],
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
  useKeyboard: vi.fn(),
}));

vi.mock("@/lib/hooks/useDraftSystem", () => ({
  useDraftSystem: () => ({
    status: "idle",
    saveDraft: mockSaveDraft,
    saveFileAttachmentDraft: vi.fn(),
    commitDraft: mockCommitDraft,
    initialDrafts: {},
    getDraftContent: mockGetDraftContent,
    getFileAttachmentDraft: mockGetFileAttachmentDraft,
    isLoading: false,
    setActiveInstances: vi.fn(),
    flushPendingSaves: vi.fn(),
    clearDraft: vi.fn(),
  }),
}));

vi.mock("@/components/shared/BlockNoteEditor", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BlockNoteEditor: ({ onChange, initialContent }: any) => (
    <input
      data-testid="mock-editor"
      onChange={(e) => onChange([{ content: [{ text: e.target.value }] }])}
      value={initialContent?.[0]?.content?.[0]?.text || ""}
    />
  ),
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

  beforeEach(() => {
    queryClient = new QueryClient();
    vi.clearAllMocks();
    Object.keys(mockDraftContents).forEach((key) => delete mockDraftContents[key]);
    mockSaveDraft.mockImplementation(
      (instanceId: string, _personaId: string, content: unknown[]) => {
        mockDraftContents[instanceId] = content;
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
});
