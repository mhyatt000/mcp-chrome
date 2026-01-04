/**
 * Quick Panel Toolbox - JWT Decode (no verification)
 */

import { base64UrlDecodeUtf8 } from './base64';
import { err, ok, safeErrorMessage, type ToolboxResult } from './result';

export interface DecodedJwt {
  header: unknown;
  payload: unknown;
  signature: string;
}

function safeJsonParse(text: string): ToolboxResult<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}

export function decodeJwt(input: string): ToolboxResult<DecodedJwt> {
  const raw = String(input ?? '').trim();
  if (!raw) return err('JWT token is required');

  const parts = raw.split('.');
  if (parts.length !== 3) return err('JWT must have 3 dot-separated parts');

  const headerText = base64UrlDecodeUtf8(parts[0] ?? '');
  if (!headerText.ok) return err(`Invalid JWT header: ${headerText.error}`);

  const payloadText = base64UrlDecodeUtf8(parts[1] ?? '');
  if (!payloadText.ok) return err(`Invalid JWT payload: ${payloadText.error}`);

  const header = safeJsonParse(headerText.value);
  if (!header.ok) return err(`Invalid JWT header JSON: ${header.error}`);

  const payload = safeJsonParse(payloadText.value);
  if (!payload.ok) return err(`Invalid JWT payload JSON: ${payload.error}`);

  return ok({
    header: header.value,
    payload: payload.value,
    signature: parts[2] ?? '',
  });
}
