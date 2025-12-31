/**
 * Quick Panel Usage Key Utilities
 *
 * Defines how SearchResult items are mapped to usage tracking keys.
 *
 * Key formats:
 * - `url:<normalizedUrl>` - For page-like items (tabs, bookmarks, history)
 * - `cmd:<commandId>` - For command items
 *
 * URL normalization rules:
 * - Strip hash fragment
 * - Remove username/password for privacy
 * - Use WHATWG URL normalization
 */

import type { SearchResult } from './types';

// ============================================================
// Types
// ============================================================

/**
 * Parsed usage key structure.
 */
export interface ParsedUsageKey {
  type: 'url' | 'cmd';
  value: string;
}

// ============================================================
// Helpers
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ============================================================
// URL Normalization
// ============================================================

/**
 * Normalize a URL for usage tracking.
 *
 * Privacy-first normalization rules:
 * - Trim whitespace
 * - Remove hash fragment (page anchors should be same "page")
 * - Strip query string (commonly contains sensitive tokens, user IDs, search queries)
 * - Strip username/password to avoid persisting sensitive info
 * - Only track http/https URLs (skip javascript:, data:, file:, etc.)
 * - Use WHATWG URL normalization when possible
 *
 * The result is `origin + pathname` only - minimal tracking footprint.
 *
 * @param input - Raw URL string
 * @returns Normalized URL or null if invalid/not trackable
 */
export function normalizeUrlForUsage(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);

    // Only track http/https URLs for privacy and security
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    // Strip all potentially sensitive parts: hash, query, credentials
    url.hash = '';
    url.search = '';
    url.username = '';
    url.password = '';

    return url.toString();
  } catch {
    // Non-parseable URLs are not tracked
    return null;
  }
}

// ============================================================
// Key Generation
// ============================================================

/**
 * Compute a usage key from a SearchResult.
 *
 * Mapping rules:
 * - Commands (data.commandId exists): `cmd:<commandId>`
 * - Page-like items (data.url exists): `url:<normalizedUrl>`
 * - Fallback: Try subtitle as URL
 *
 * @param result - Search result to compute key for
 * @returns Usage key string or null if not trackable
 */
export function computeUsageKey(result: SearchResult): string | null {
  if (!result) return null;

  const data = result.data;

  // Commands: key by commandId
  if (isRecord(data) && typeof data.commandId === 'string') {
    const commandId = data.commandId.trim();
    if (commandId) {
      return `cmd:${commandId}`;
    }
  }

  // Page-like items: key by normalized URL
  if (isRecord(data) && typeof data.url === 'string') {
    const normalized = normalizeUrlForUsage(data.url);
    if (normalized) {
      return `url:${normalized}`;
    }
  }

  // Fallback: some providers may place URL in subtitle
  if (typeof result.subtitle === 'string' && result.subtitle.trim()) {
    // Only consider if it looks like a URL
    const subtitle = result.subtitle.trim();
    if (subtitle.startsWith('http://') || subtitle.startsWith('https://')) {
      const normalized = normalizeUrlForUsage(subtitle);
      if (normalized) {
        return `url:${normalized}`;
      }
    }
  }

  return null;
}

// ============================================================
// Key Parsing
// ============================================================

/**
 * Parse a usage key back into its components.
 *
 * @param key - Usage key string
 * @returns Parsed key or null if invalid format
 */
export function parseUsageKey(key: string): ParsedUsageKey | null {
  const raw = String(key ?? '').trim();
  if (!raw) return null;

  if (raw.startsWith('url:')) {
    const value = raw.slice(4).trim();
    return value ? { type: 'url', value } : null;
  }

  if (raw.startsWith('cmd:')) {
    const value = raw.slice(4).trim();
    return value ? { type: 'cmd', value } : null;
  }

  return null;
}

/**
 * Check if a key represents a URL-based result.
 */
export function isUrlKey(key: string): boolean {
  return String(key ?? '')
    .trim()
    .startsWith('url:');
}

/**
 * Check if a key represents a command result.
 */
export function isCommandKey(key: string): boolean {
  return String(key ?? '')
    .trim()
    .startsWith('cmd:');
}
