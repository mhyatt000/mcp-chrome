/**
 * Quick Panel Toolbox - URL Encode/Decode
 */

import { err, ok, safeErrorMessage, type ToolboxResult } from './result';

export function urlEncode(input: string): ToolboxResult<string> {
  const raw = String(input ?? '');
  if (!raw.trim()) return err('Input is required');
  try {
    return ok(encodeURIComponent(raw));
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}

export function urlDecode(input: string): ToolboxResult<string> {
  const raw = String(input ?? '');
  if (!raw.trim()) return err('Input is required');
  try {
    return ok(decodeURIComponent(raw));
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}
