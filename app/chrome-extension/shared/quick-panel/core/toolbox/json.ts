/**
 * Quick Panel Toolbox - JSON
 */

import { err, ok, safeErrorMessage, type ToolboxResult } from './result';

export interface JsonFormats {
  pretty: string;
  minified: string;
}

export function formatJson(input: string): ToolboxResult<JsonFormats> {
  const raw = String(input ?? '').trim();
  if (!raw) return err('JSON input is required');

  try {
    const parsed = JSON.parse(raw) as unknown;
    const pretty = JSON.stringify(parsed, null, 2);
    const minified = JSON.stringify(parsed);
    return ok({ pretty, minified });
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}
