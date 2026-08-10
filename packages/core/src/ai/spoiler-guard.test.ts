import { describe, expect, it } from "vitest";
import { filterSpoilerToolResult, guardSpoilerToolCall } from "./spoiler-guard";

const boundary = {
  bookId: "book-1",
  chapterIndex: 3,
  cfi: "epubcfi(/6/8!/4/10)",
};

describe("spoiler guard", () => {
  it("blocks future chapters and bounds current-chapter context by CFI", () => {
    const future = guardSpoilerToolCall("ragContext", { chapterIndex: 4 }, boundary);
    expect("result" in future && future.result.spoilerProtected).toBe(true);

    const current = guardSpoilerToolCall("ragContext", { chapterIndex: 3 }, boundary);
    expect("args" in current && current.args._maxCfi).toBe(boundary.cfi);
  });

  it("blocks current-chapter retrieval when an exact CFI boundary is unavailable", () => {
    const result = guardSpoilerToolCall(
      "fallbackChapterContext",
      { chapterIndex: 3 },
      { bookId: "book-1", chapterIndex: 3 },
    );

    expect("result" in result && result.result.spoilerProtected).toBe(true);
  });

  it("allows analysis only for completed chapters without changing analysis tools", () => {
    const completed = guardSpoilerToolCall(
      "summarize",
      { scope: "chapter", chapterIndex: 2 },
      boundary,
    );
    expect("args" in completed).toBe(true);

    const current = guardSpoilerToolCall(
      "summarize",
      { scope: "chapter", chapterIndex: 3 },
      boundary,
    );
    expect("result" in current && current.result.spoilerProtected).toBe(true);
  });

  it("filters search matches after the verified reading position", () => {
    const result = filterSpoilerToolResult(
      "ragSearch",
      {
        results: [
          { chapterIndex: 2, cfi: "epubcfi(/6/6!/4/20)", content: "past" },
          { chapterIndex: 3, cfi: "epubcfi(/6/8!/4/8)", content: "current-past" },
          { chapterIndex: 3, cfi: "epubcfi(/6/8!/4/12)", content: "current-future" },
          { chapterIndex: 4, cfi: "epubcfi(/6/10!/4/2)", content: "future" },
        ],
      },
      boundary,
    ) as any;

    expect(result.results.map((item: any) => item.content)).toEqual(["past", "current-past"]);
    expect(result.spoilerFiltered).toBe(2);
  });
});
