/**
 * Quick Panel Toolbox - Timestamp
 */

import { err, ok, type ToolboxResult } from './result';

export interface TimestampConversion {
  seconds: number;
  milliseconds: number;
  iso: string;
}

function isValidDate(d: Date): boolean {
  return Number.isFinite(d.getTime());
}

function parseTimestampNumber(raw: string): number | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toMilliseconds(n: number): number {
  const abs = Math.abs(n);

  // Heuristics:
  // - 13+ digits -> ms
  // - 10 digits -> seconds
  // - otherwise: treat values < 1e11 as seconds (covers modern unix seconds),
  //   and >= 1e11 as ms (covers modern unix ms).
  const digits = Math.floor(abs).toString().length;
  if (digits >= 13) return Math.round(n);
  if (digits <= 10) return Math.round(n * 1000);
  return abs < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

export function convertUnixTimestamp(input: string): ToolboxResult<TimestampConversion> {
  const raw = String(input ?? '');
  const n = parseTimestampNumber(raw);
  if (n === null) return err('Timestamp must be a number (seconds or milliseconds)');

  const ms = toMilliseconds(n);
  const date = new Date(ms);
  if (!isValidDate(date)) return err('Invalid timestamp');

  const seconds = Math.floor(ms / 1000);
  return ok({ seconds, milliseconds: ms, iso: date.toISOString() });
}
