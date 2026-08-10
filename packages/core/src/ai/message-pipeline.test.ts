import { describe, expect, it } from "vitest";
import type { Thread } from "../types";
import { processMessages } from "./message-pipeline";

const pipelineContext = {
  book: null,
  bookId: null,
  semanticContext: null,
  enabledSkills: [],
  isVectorized: false,
  userLanguage: "en",
};

describe("message pipeline source continuity", () => {
  it("re-injects persisted citation metadata into later model history", () => {
    const thread: Thread = {
      id: "thread-1",
      title: "Sources",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          content: "The answer is supported here [1].",
          partsOrder: [
            {
              type: "citation",
              id: "citation-1",
              citationIndex: 1,
              bookId: "book-1",
              chapterTitle: "Chapter 2",
              chapterIndex: 1,
              cfi: "epubcfi(/6/4)",
              text: "verified excerpt",
            },
          ],
          createdAt: 1,
        },
        {
          id: "user-2",
          threadId: "thread-1",
          role: "user",
          content: "Continue.",
          createdAt: 2,
        },
      ],
    };

    const result = processMessages(thread, pipelineContext);

    expect(result.messages[0].content).toContain("Verified sources from this message");
    expect(result.messages[0].content).toContain("bookId=book-1");
    expect(result.messages[0].content).toContain("chapterIndex=1");
    expect(result.messages[0].content).toContain("cfi=epubcfi(/6/4)");
    expect(result.messages[0].content).toContain("verified excerpt");
    expect(result).not.toHaveProperty("systemPrompt");
  });

  it("preserves attached quote location metadata from partsOrder", () => {
    const thread: Thread = {
      id: "thread-2",
      bookId: "book-1",
      title: "Quote",
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: "user-1",
          threadId: "thread-2",
          role: "user",
          content: "Please explain this quote.",
          partsOrder: [
            {
              type: "quote",
              id: "quote-1",
              text: "quoted text",
              source: "Chapter 3",
              bookId: "book-1",
              chapterTitle: "Chapter 3",
              chapterIndex: 2,
              cfi: "epubcfi(/6/6)",
            },
          ],
          createdAt: 1,
        },
      ],
    };

    const result = processMessages(thread, pipelineContext);

    expect(result.messages[0].content).toContain("Attached quote sources");
    expect(result.messages[0].content).toContain("bookId=book-1");
    expect(result.messages[0].content).toContain("chapter=Chapter 3");
    expect(result.messages[0].content).toContain("chapterIndex=2");
    expect(result.messages[0].content).toContain("cfi=epubcfi(/6/6)");
  });
});
