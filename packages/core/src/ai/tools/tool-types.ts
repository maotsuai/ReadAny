/**
 * Tool type definitions for AI agent system.
 * The actual tool implementations (which depend on db/rag) live in the app package.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  timeoutMs?: number;
  execute: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<unknown>;
}

export interface ToolExecutionContext {
  /** Aborted when the user stops generation or the per-tool timeout expires. */
  signal?: AbortSignal;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}
