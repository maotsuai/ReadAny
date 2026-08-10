/**
 * Chat reader store — reading context for standalone chat page
 */
import { create } from "zustand";
import { getPlatformService } from "../services/platform";

const SELECTED_BOOKS_KEY_PREFIX = "chat-selected-books:";
let selectedBooksLoad: { threadId: string; token: symbol; promise: Promise<void> } | null = null;

function persistSelectedBooks(threadId: string, bookIds: string[]): void {
  try {
    void getPlatformService()
      .kvSetItem(`${SELECTED_BOOKS_KEY_PREFIX}${threadId}`, JSON.stringify(bookIds))
      .catch((error) => console.warn("[ChatReader] Failed to persist selected books:", error));
  } catch (error) {
    console.warn("[ChatReader] Platform is not ready; selected books remain in memory:", error);
  }
}

export interface ChatReaderContext {
  bookId: string | null;
  bookTitle: string;
  currentChapter: string;
  selectedBooks: string[]; // multiple book context for standalone chat
  activeThreadContextId: string | null;
}

export interface ChatReaderState extends ChatReaderContext {
  setBookContext: (bookId: string, title: string) => void;
  setCurrentChapter: (chapter: string) => void;
  addSelectedBook: (bookId: string) => void;
  removeSelectedBook: (bookId: string) => void;
  setActiveThreadContext: (threadId: string | null) => Promise<void>;
  bindSelectedBooksToThread: (threadId: string) => void;
  clearContext: () => void;
}

export const useChatReaderStore = create<ChatReaderState>((set, get) => ({
  bookId: null,
  bookTitle: "",
  currentChapter: "",
  selectedBooks: [],
  activeThreadContextId: null,

  setBookContext: (bookId, title) => set({ bookId, bookTitle: title }),

  setCurrentChapter: (chapter) => set({ currentChapter: chapter }),

  addSelectedBook: (bookId) =>
    set((state) => {
      const selectedBooks = state.selectedBooks.includes(bookId)
        ? state.selectedBooks
        : [...state.selectedBooks, bookId];
      if (state.activeThreadContextId) {
        persistSelectedBooks(state.activeThreadContextId, selectedBooks);
      }
      return { selectedBooks };
    }),

  removeSelectedBook: (bookId) =>
    set((state) => {
      const selectedBooks = state.selectedBooks.filter((id) => id !== bookId);
      if (state.activeThreadContextId) {
        persistSelectedBooks(state.activeThreadContextId, selectedBooks);
      }
      return { selectedBooks };
    }),

  setActiveThreadContext: (threadId) => {
    if (!threadId) {
      selectedBooksLoad = null;
      set({ activeThreadContextId: null, selectedBooks: [] });
      return Promise.resolve();
    }
    if (get().activeThreadContextId === threadId) {
      return selectedBooksLoad?.threadId === threadId
        ? selectedBooksLoad.promise
        : Promise.resolve();
    }
    set({ activeThreadContextId: threadId, selectedBooks: [] });

    const token = Symbol(threadId);
    const promise = Promise.resolve().then(async () => {
      try {
        const raw = await getPlatformService().kvGetItem(`${SELECTED_BOOKS_KEY_PREFIX}${threadId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return;
        set((state) =>
          state.activeThreadContextId === threadId
            ? { selectedBooks: [...new Set(parsed.filter((id) => typeof id === "string"))] }
            : {},
        );
      } catch (error) {
        console.warn("[ChatReader] Failed to restore selected books:", error);
      } finally {
        if (selectedBooksLoad?.token === token) {
          selectedBooksLoad = null;
        }
      }
    });
    selectedBooksLoad = { threadId, token, promise };
    return promise;
  },

  bindSelectedBooksToThread: (threadId) =>
    set((state) => {
      persistSelectedBooks(threadId, state.selectedBooks);
      return { activeThreadContextId: threadId };
    }),

  clearContext: () => {
    selectedBooksLoad = null;
    set({
      bookId: null,
      bookTitle: "",
      currentChapter: "",
      selectedBooks: [],
      activeThreadContextId: null,
    });
  },
}));
