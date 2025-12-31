/**
 * Quick Panel Provider Utilities
 *
 * Shared utilities for all Quick Panel search providers:
 * - Clipboard operations
 * - Markdown formatting
 * - Text normalization
 * - Token-based scoring
 */

// ============================================================
// Clipboard Utilities
// ============================================================

/**
 * Write text to the clipboard using execCommand fallback.
 * This is the legacy approach that works in more contexts.
 */
function writeToClipboardFallback(text: string): void {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const success = document.execCommand('copy');
    if (!success) {
      throw new Error('execCommand copy failed');
    }
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Write text to the clipboard.
 * Uses the modern Clipboard API with fallback for older browsers or restricted contexts.
 */
export async function writeToClipboard(text: string): Promise<void> {
  // Try modern API first, with fallback on any failure
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Modern API failed (permission denied, no user gesture, etc.)
      // Fall through to legacy approach
    }
  }

  // Fallback for older browsers or when modern API fails
  writeToClipboardFallback(text);
}

/**
 * Format a title and URL as a Markdown link.
 * Escapes special characters in both title and URL for valid Markdown.
 */
export function formatMarkdownLink(title: string, url: string): string {
  // Escape special characters in title for Markdown: [ ] \
  const escapedTitle = String(title ?? '').replace(/([[\]\\])/g, '\\$1');
  // Escape parentheses in URL to avoid breaking the link syntax
  const escapedUrl = String(url ?? '').replace(/[()]/g, (ch) => encodeURIComponent(ch));
  return `[${escapedTitle}](${escapedUrl})`;
}

// ============================================================
// Text Normalization
// ============================================================

/**
 * Normalize text for comparison:
 * - Trim whitespace
 * - Convert to lowercase
 * - Collapse multiple spaces
 */
export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize URL for comparison:
 * - Remove protocol (http://, https://)
 * - Remove www prefix
 * - URL decode
 * - Apply text normalization
 */
export function normalizeUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  // Remove protocol and www prefix for cleaner matching
  let text = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

  // Attempt URL decode
  try {
    text = decodeURIComponent(text);
  } catch {
    // Best-effort
  }

  return normalizeText(text);
}

// ============================================================
// Token Scoring
// ============================================================

/**
 * Check if needle is a subsequence of haystack.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i >= needle.length) return true;
  }
  return false;
}

/** Minimum token length for subsequence matching (to avoid over-matching) */
const MIN_SUBSEQUENCE_TOKEN_LENGTH = 3;

/**
 * Check if character is a word boundary.
 */
function isBoundaryChar(ch: string): boolean {
  return (
    ch === '' ||
    ch === ' ' ||
    ch === '/' ||
    ch === '-' ||
    ch === '_' ||
    ch === '.' ||
    ch === ':' ||
    ch === '#' ||
    ch === '?' ||
    ch === '&'
  );
}

/**
 * Score a single token against a haystack string.
 * Returns 0 if no match, higher values for better matches.
 *
 * Scoring:
 * - Exact match: 1.0
 * - Prefix match: 0.95
 * - Substring match: 0.55-0.95 (depends on position and boundary)
 * - Subsequence match: 0.4 (only for tokens >= 3 chars)
 */
export function scoreToken(haystack: string, token: string): number {
  if (!haystack || !token) return 0;

  // Exact match
  if (haystack === token) return 1;

  // Prefix match
  if (haystack.startsWith(token)) return 0.95;

  // Substring match
  const idx = haystack.indexOf(token);
  if (idx >= 0) {
    const prev = idx > 0 ? haystack[idx - 1] : '';
    const boundaryBoost = isBoundaryChar(prev) ? 0.15 : 0;
    const positionPenalty = idx / Math.max(1, haystack.length);
    return Math.max(0.55, 0.8 + boundaryBoost - positionPenalty * 0.2);
  }

  // Subsequence match (fuzzy) - only for tokens >= MIN_SUBSEQUENCE_TOKEN_LENGTH
  if (token.length >= MIN_SUBSEQUENCE_TOKEN_LENGTH && isSubsequence(token, haystack)) {
    return 0.4;
  }

  return 0;
}

// ============================================================
// Weighted Field Scoring
// ============================================================

/**
 * Field mode for normalization.
 */
export type WeightedFieldMode = 'text' | 'url';

/**
 * A field to score against with its weight.
 */
export interface WeightedField {
  /** The field value */
  value: string;
  /** Weight of this field in scoring (should be positive) */
  weight: number;
  /** Normalization mode. Default: 'text' */
  mode?: WeightedFieldMode;
}

/**
 * Compute a weighted score for multiple fields against query tokens.
 *
 * For each token, scores against all fields and combines using weights.
 * Returns 0 if any token has no match (AND semantics).
 *
 * @param fields - Array of fields to score against
 * @param tokens - Query tokens to match
 * @returns Score from 0-100
 */
export function computeWeightedTokenScore(
  fields: readonly WeightedField[],
  tokens: readonly string[],
): number {
  if (tokens.length === 0) return 0;
  if (fields.length === 0) return 0;

  // Normalize fields and filter invalid ones
  const normalized = fields
    .map((f) => {
      const weight = Number.isFinite(f.weight) ? Math.max(0, f.weight) : 0;
      const mode = f.mode ?? 'text';
      const text = mode === 'url' ? normalizeUrl(f.value) : normalizeText(f.value);
      return { weight, text };
    })
    .filter((f) => f.weight > 0 && f.text.length > 0);

  if (normalized.length === 0) return 0;

  const weightSum = normalized.reduce((sum, f) => sum + f.weight, 0) || 1;

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    let weighted = 0;

    for (const f of normalized) {
      const s = scoreToken(f.text, token);
      if (s > best) best = s;
      weighted += s * f.weight;
    }

    // If no field matched this token, reject entirely (AND semantics)
    if (best <= 0) return 0;

    total += weighted / weightSum;
  }

  return (total / tokens.length) * 100;
}
