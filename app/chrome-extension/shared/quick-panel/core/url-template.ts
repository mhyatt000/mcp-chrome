/**
 * Quick Panel URL Template Utilities
 *
 * Pure (DOM-free) helpers for building URLs from templates.
 *
 * Supported placeholders:
 * - `{query}`: normalized query (trimmed + collapsed whitespace), URL-encoded
 * - `{rawQuery}`: raw query (trimmed only), URL-encoded
 *
 * This module is intentionally small and testable, used by web-search providers
 * and any future "open by template" features.
 */

// ============================================================
// Types
// ============================================================

export interface UrlTemplateEngine {
  template: string;
}

// ============================================================
// Helpers
// ============================================================

function normalizeQuery(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function trimOnly(value: string): string {
  return String(value ?? '').trim();
}

function hasPlaceholders(template: string): boolean {
  return template.includes('{query}') || template.includes('{rawQuery}');
}

function replaceAllLiteral(input: string, needle: string, replacement: string): string {
  if (!needle) return input;
  if (!input.includes(needle)) return input;
  return input.split(needle).join(replacement);
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a URL by filling a template with a query string.
 *
 * @example
 * ```ts
 * buildSearchUrl({ template: 'https://www.google.com/search?q={query}' }, 'react hooks')
 * // -> "https://www.google.com/search?q=react%20hooks"
 * ```
 */
export function buildSearchUrl(engine: UrlTemplateEngine, query: string): string {
  const template = String(engine?.template ?? '').trim();
  if (!template) {
    throw new Error('URL template is required');
  }
  if (!hasPlaceholders(template)) {
    throw new Error('URL template must include {query} or {rawQuery}');
  }

  const rawQuery = trimOnly(query);
  const normalizedQuery = normalizeQuery(query);

  const encodedQuery = encodeURIComponent(normalizedQuery);
  const encodedRawQuery = encodeURIComponent(rawQuery);

  // Replace placeholders. Order doesn't matter because tokens do not overlap.
  let url = template;
  url = replaceAllLiteral(url, '{query}', encodedQuery);
  url = replaceAllLiteral(url, '{rawQuery}', encodedRawQuery);
  return url;
}
