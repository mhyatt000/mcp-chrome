/**
 * Quick Panel Toolbox - Base64
 *
 * Notes:
 * - `btoa/atob` operate on Latin1 "binary strings". We explicitly convert UTF-8 <-> bytes.
 * - We accept Base64URL input (JWT) and normalize padding.
 */

import { err, ok, safeErrorMessage, type ToolboxResult } from './result';

interface NodeBufferLike extends Uint8Array {
  toString: (encoding: string) => string;
}

interface NodeBufferConstructorLike {
  from: (data: string | ArrayBufferView, encoding?: string) => NodeBufferLike;
}

function hasBrowserBase64(): boolean {
  return typeof globalThis.btoa === 'function' && typeof globalThis.atob === 'function';
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function binaryStringToBytes(bin: string): Uint8Array {
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function encodeBase64Bytes(bytes: Uint8Array): ToolboxResult<string> {
  try {
    if (hasBrowserBase64()) {
      return ok(globalThis.btoa(bytesToBinaryString(bytes)));
    }

    const anyGlobal = globalThis as unknown as { Buffer?: NodeBufferConstructorLike };
    if (typeof anyGlobal.Buffer?.from === 'function') {
      return ok(anyGlobal.Buffer.from(bytes).toString('base64'));
    }

    return err('Base64 encoder is not available in this environment');
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}

function decodeBase64ToBytes(base64: string): ToolboxResult<Uint8Array> {
  try {
    const normalized = normalizeBase64Input(base64);
    if (!normalized.ok) return normalized;

    if (hasBrowserBase64()) {
      const bin = globalThis.atob(normalized.value);
      return ok(binaryStringToBytes(bin));
    }

    const anyGlobal = globalThis as unknown as { Buffer?: NodeBufferConstructorLike };
    if (typeof anyGlobal.Buffer?.from === 'function') {
      return ok(anyGlobal.Buffer.from(normalized.value, 'base64'));
    }

    return err('Base64 decoder is not available in this environment');
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}

/**
 * Normalize Base64/Base64URL inputs:
 * - trims whitespace
 * - removes internal whitespace
 * - converts base64url to base64
 * - fixes missing padding
 */
export function normalizeBase64Input(input: string): ToolboxResult<string> {
  const raw = String(input ?? '').trim();
  if (!raw) return err('Base64 input is required');

  const compact = raw.replace(/\s+/g, '');
  const standard = compact.replace(/-/g, '+').replace(/_/g, '/');

  const mod = standard.length % 4;
  if (mod === 1) return err('Invalid Base64 length');
  if (mod === 2) return ok(`${standard}==`);
  if (mod === 3) return ok(`${standard}=`);
  return ok(standard);
}

export function base64EncodeUtf8(input: string): ToolboxResult<string> {
  const text = String(input ?? '');
  if (!text.trim()) return err('Input is required');

  try {
    const enc = new TextEncoder();
    const bytes = enc.encode(text);
    return encodeBase64Bytes(bytes);
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}

export function base64DecodeUtf8(input: string): ToolboxResult<string> {
  const decoded = decodeBase64ToBytes(input);
  if (!decoded.ok) return decoded;

  try {
    const dec = new TextDecoder();
    return ok(dec.decode(decoded.value));
  } catch (e) {
    return err(safeErrorMessage(e));
  }
}

export function base64UrlDecodeUtf8(input: string): ToolboxResult<string> {
  return base64DecodeUtf8(input);
}
