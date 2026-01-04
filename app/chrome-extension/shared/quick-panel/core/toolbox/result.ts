/**
 * Quick Panel Toolbox Result
 *
 * A small, serializable result type for pure utility functions.
 */

export type ToolboxResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): ToolboxResult<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): ToolboxResult<T> {
  return { ok: false, error };
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}
