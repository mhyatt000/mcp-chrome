/**
 * Quick Panel Content Search Utilities
 *
 * Pure helpers shared by the background content cache and tests:
 * - Token scoring against already-normalized text (AND semantics)
 * - Snippet extraction around the first matched token
 */

import { scoreToken } from './text-score';

export function scoreTokensAgainstNormalizedText(
  haystack: string,
  tokens: readonly string[],
): number {
  if (!haystack || tokens.length === 0) return 0;

  let total = 0;
  for (const t of tokens) {
    const s = scoreToken(haystack, t);
    if (s <= 0) return 0; // AND semantics
    total += s;
  }
  return (total / tokens.length) * 100;
}

export interface CreateContentSnippetOptions {
  beforeChars?: number;
  afterChars?: number;
  maxLen?: number;
}

export function createContentSnippet(
  content: string,
  tokens: readonly string[],
  options: CreateContentSnippetOptions = {},
): string {
  const raw = String(content ?? '').trim();
  if (!raw) return '';

  const lower = raw.toLowerCase();

  let bestIdx = -1;
  let bestToken = '';
  for (const t of tokens) {
    if (!t) continue;
    const idx = lower.indexOf(t);
    if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
      bestToken = t;
    }
  }

  const targetIdx = bestIdx >= 0 ? bestIdx : 0;
  const targetLen = bestIdx >= 0 ? bestToken.length : 0;

  const before = typeof options.beforeChars === 'number' ? Math.max(0, options.beforeChars) : 64;
  const after = typeof options.afterChars === 'number' ? Math.max(0, options.afterChars) : 140;
  const maxLen = typeof options.maxLen === 'number' ? Math.max(40, options.maxLen) : 220;

  const start = Math.max(0, targetIdx - before);
  const end = Math.min(raw.length, targetIdx + targetLen + after);

  let snippet = raw.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < raw.length) snippet = `${snippet}…`;

  if (snippet.length > maxLen) {
    snippet = `${snippet.slice(0, maxLen - 1).trimEnd()}…`;
  }

  return snippet;
}
