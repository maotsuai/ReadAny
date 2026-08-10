/**
 * Message processing pipeline
 * - Citation reference injection
 * - 8-message sliding window
 * - Context assembly
 */
import type { Message, SemanticContext, Thread } from "../types";
import type { Book, Skill } from "../types";

interface PipelineConfig {
  slidingWindowSize: number; // default 8
}

interface PipelineContext {
  book: Book | null;
  bookId?: string | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  userLanguage: string;
  memorySummary?: string;
}

export interface ProcessedMessage {
  role: "user" | "assistant";
  content: string;
  /** DeepSeek reasoning_content — needed for multi-turn tool-calling with reasoner models */
  reasoning?: string;
}

interface ProcessedMessages {
  messages: ProcessedMessage[];
}

const DEFAULT_CONFIG: PipelineConfig = {
  slidingWindowSize: 8,
};

/** Process a thread into messages ready for AI API call */
export function processMessages(
  thread: Thread,
  context: PipelineContext,
  config: PipelineConfig = DEFAULT_CONFIG,
): ProcessedMessages {
  // The reading agent builds the one authoritative system prompt after routing
  // and tool filtering. Keeping a second prompt here caused configuration drift.
  void context;

  // Apply sliding window — keep last N messages
  const windowedMessages = applySlidingWindow(thread.messages, config.slidingWindowSize);

  // Process citations in messages, preserving reasoning for DeepSeek multi-turn
  const processed: ProcessedMessage[] = windowedMessages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const msg: ProcessedMessage = {
        role: m.role as "user" | "assistant",
        content: injectCitations(m),
      };
      // Preserve reasoning content for assistant messages (needed by DeepSeek reasoner)
      if (m.role === "assistant" && m.reasoning && m.reasoning.length > 0) {
        msg.reasoning = m.reasoning.map((r) => r.content).join("\n");
      }
      return msg;
    });

  return { messages: processed };
}

/** Apply sliding window, keeping system messages + last N user/assistant pairs */
function applySlidingWindow(messages: Message[], windowSize: number): Message[] {
  if (messages.length <= windowSize) return messages;
  return messages.slice(-windowSize);
}

/** Inject citation references into message content */
function injectCitations(message: Message): string {
  const citations = new Map<
    string,
    {
      citationIndex?: number;
      bookId?: string;
      chapterTitle?: string;
      chapterIndex?: number;
      cfi?: string;
      text?: string;
    }
  >();

  for (const citation of message.citations ?? []) {
    citations.set(citation.id, {
      bookId: citation.bookId,
      chapterTitle: citation.chapterTitle,
      chapterIndex: citation.chapterIndex,
      cfi: citation.cfi,
      text: citation.text,
    });
  }
  for (const entry of message.partsOrder ?? []) {
    if (entry.type !== "citation") continue;
    citations.set(entry.id, {
      citationIndex: entry.citationIndex,
      bookId: entry.bookId,
      chapterTitle: entry.chapterTitle,
      chapterIndex: entry.chapterIndex,
      cfi: entry.cfi,
      text: entry.text,
    });
  }
  for (const toolCall of message.toolCalls ?? []) {
    const result = toolCall.result;
    if (!result || typeof result !== "object") continue;
    const record = result as Record<string, unknown>;
    if (record.type !== "citation") continue;
    citations.set(toolCall.id, {
      citationIndex: Number(record.citationIndex) || undefined,
      bookId: String(record.bookId || "") || undefined,
      chapterTitle: String(record.chapterTitle || "") || undefined,
      chapterIndex: Number.isInteger(Number(record.chapterIndex))
        ? Number(record.chapterIndex)
        : undefined,
      cfi: String(record.cfi || "") || undefined,
      text: String(record.text || "") || undefined,
    });
  }

  let content = message.content;
  if (citations.size > 0) {
    const references = [...citations.values()].map((citation, index) => {
      const marker = citation.citationIndex || index + 1;
      const location = [
        citation.bookId ? `bookId=${citation.bookId}` : "",
        citation.chapterTitle ? `chapter=${citation.chapterTitle}` : "",
        Number.isInteger(citation.chapterIndex) ? `chapterIndex=${citation.chapterIndex}` : "",
        citation.cfi ? `cfi=${citation.cfi}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `- [${marker}] ${location}${citation.text ? ` — “${citation.text.slice(0, 240)}”` : ""}`;
    });
    content += `\n\nVerified sources from this message:\n${references.join("\n")}`;
  }

  const quoteSources = (message.partsOrder ?? [])
    .filter((entry) => entry.type === "quote")
    .map((entry) =>
      [
        entry.bookId ? `bookId=${entry.bookId}` : "",
        entry.chapterTitle || entry.source ? `chapter=${entry.chapterTitle || entry.source}` : "",
        Number.isInteger(entry.chapterIndex) ? `chapterIndex=${entry.chapterIndex}` : "",
        entry.cfi ? `cfi=${entry.cfi}` : "",
      ]
        .filter(Boolean)
        .join(", "),
    )
    .filter(Boolean);
  if (quoteSources.length > 0 && !content.includes("[Source:")) {
    content += `\n\nAttached quote sources:\n${quoteSources.map((source) => `- ${source}`).join("\n")}`;
  }

  return content;
}
