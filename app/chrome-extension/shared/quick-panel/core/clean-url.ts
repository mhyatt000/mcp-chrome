/**
 * Quick Panel Clean URL
 *
 * Pure helpers for removing common tracking parameters from URLs.
 * Intended for the `> Clean URL` command and any future share/sanitize flows.
 */

// ============================================================
// Types
// ============================================================

export interface CleanUrlResult {
  original: string;
  cleaned: string;
  changed: boolean;
  removedParams: string[];
}

// ============================================================
// Config
// ============================================================

const EXACT_TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'igshid',
  'yclid',
  'gbraid',
  'wbraid',
  'srsltid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
]);

// ============================================================
// Public API
// ============================================================

/**
 * Remove common tracking parameters from a URL.
 *
 * Rules:
 * - Only operates on http(s) URLs.
 * - Removes any param with `utm_` prefix (case-insensitive).
 * - Removes a curated set of common tracking params (fbclid/gclid/etc).
 * - Preserves hash fragment by default (anchors are often meaningful).
 */
export function cleanUrl(input: string): CleanUrlResult {
  const original = String(input ?? '').trim();
  if (!original) {
    return { original, cleaned: '', changed: false, removedParams: [] };
  }

  let url: URL;
  try {
    url = new URL(original);
  } catch {
    // Best-effort: non-parseable URLs are returned as-is.
    return { original, cleaned: original, changed: false, removedParams: [] };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { original, cleaned: original, changed: false, removedParams: [] };
  }

  const removedParams: string[] = [];
  const keysToDelete: string[] = [];

  for (const [key] of url.searchParams) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || EXACT_TRACKING_PARAMS.has(lower)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      removedParams.push(key);
    }
  }

  const cleaned = url.toString();
  return { original, cleaned, changed: cleaned !== original, removedParams };
}
