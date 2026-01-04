/**
 * Bookmarks Search Provider (Quick Panel)
 *
 * Searches browser bookmarks via background service worker bridge.
 * Runs in content script Quick Panel UI - delegates bookmark queries
 * and navigation to the background service worker via chrome.runtime messaging.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelBookmarkSummary,
  type QuickPanelBookmarkRemoveResponse,
  type QuickPanelBookmarksQueryResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import {
  computeWeightedTokenScore,
  formatMarkdownLink,
  openUrl,
  writeToClipboard,
} from './provider-utils';

// ============================================================
// Types
// ============================================================

/**
 * Data associated with a bookmark search result.
 */
export interface BookmarksSearchResultData {
  bookmarkId: string;
  url: string;
  title: string;
  dateAdded?: number;
  parentId?: string;
}

// ============================================================
// Bookmarks Client (Background Bridge)
// ============================================================

interface BookmarksClient {
  query: (options: {
    query: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelBookmarkSummary[]>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
}

function createRuntimeBookmarksClient(): BookmarksClient {
  async function query(options: {
    query: string;
    maxResults: number;
    signal: AbortSignal;
  }): Promise<QuickPanelBookmarkSummary[]> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    if (options.signal.aborted) {
      throw new Error('aborted');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_BOOKMARKS_QUERY,
      payload: { query: options.query, maxResults: options.maxResults },
    })) as QuickPanelBookmarksQueryResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to query bookmarks');
    }

    return Array.isArray(resp.bookmarks) ? resp.bookmarks : [];
  }

  async function removeBookmark(bookmarkId: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const id = String(bookmarkId ?? '').trim();
    if (!id) {
      throw new Error('bookmarkId is required');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_BOOKMARK_REMOVE,
      payload: { bookmarkId: id },
    })) as QuickPanelBookmarkRemoveResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to remove bookmark');
    }
  }

  return { query, removeBookmark };
}

// ============================================================
// Scoring Helpers
// ============================================================

/**
 * Compute score for a bookmark based on query tokens.
 * Includes recency boost based on dateAdded.
 */
function computeBookmarkScore(
  bookmark: QuickPanelBookmarkSummary,
  tokens: readonly string[],
  now: number,
): number {
  const base = computeWeightedTokenScore(
    [
      { value: bookmark.title ?? '', weight: 0.75, mode: 'text' },
      { value: bookmark.url ?? '', weight: 0.25, mode: 'url' },
    ],
    tokens,
  );
  if (base <= 0) return 0;

  // Add recency boost based on dateAdded
  const dateAdded = typeof bookmark.dateAdded === 'number' ? bookmark.dateAdded : null;
  if (!dateAdded || !Number.isFinite(dateAdded) || dateAdded <= 0) {
    return base;
  }

  // More recently added bookmarks get a small boost (up to 8 points over 8 days)
  const ageMs = Math.max(0, now - dateAdded);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyBoost = Math.max(0, Math.min(8, 8 - ageDays));

  return base + recencyBoost;
}

// ============================================================
// Provider Factory
// ============================================================

/**
 * Create a Bookmarks search provider for Quick Panel.
 *
 * @example
 * ```typescript
 * const bookmarksProvider = createBookmarksProvider();
 * searchEngine.registerProvider(bookmarksProvider);
 * ```
 */
export function createBookmarksProvider(): SearchProvider<BookmarksSearchResultData> {
  const id = 'bookmarks';
  const name = 'Bookmarks';
  const icon = '\u2B50'; // ⭐

  const client = createRuntimeBookmarksClient();

  /**
   * Get actions available for a bookmark result.
   */
  function getActions(
    item: SearchResult<BookmarksSearchResultData>,
  ): Action<BookmarksSearchResultData>[] {
    const { bookmarkId, url, title } = item.data;

    return [
      // Primary action: Open in current tab
      {
        id: 'bookmarks.open',
        title: 'Open',
        hotkeyHint: 'Enter',
        execute: async (ctx) => {
          await openUrl({ url, disposition: ctx.openMode ?? 'current_tab' });
        },
      },
      // Open in new tab
      {
        id: 'bookmarks.openNewTab',
        title: 'Open in new tab',
        hotkeyHint: 'Cmd/Ctrl+Enter',
        execute: async () => {
          await openUrl({ url, disposition: 'new_tab' });
        },
      },
      // Copy URL
      {
        id: 'bookmarks.copyUrl',
        title: 'Copy URL',
        hotkeyHint: 'Cmd+C',
        execute: async () => {
          await writeToClipboard(url, { source: 'bookmarks.copy.url', label: title });
        },
      },
      // Copy as Markdown link
      {
        id: 'bookmarks.copyMarkdown',
        title: 'Copy as Markdown',
        hotkeyHint: 'Cmd+Shift+C',
        execute: async () => {
          await writeToClipboard(formatMarkdownLink(title, url), {
            source: 'bookmarks.copy.markdown',
            label: title,
          });
        },
      },
      // Delete bookmark (danger)
      {
        id: 'bookmarks.delete',
        title: 'Delete bookmark',
        tone: 'danger',
        execute: async () => {
          await client.removeBookmark(bookmarkId);
        },
      },
    ];
  }

  /**
   * Search for bookmarks matching the query.
   */
  async function search(
    ctx: SearchProviderContext,
  ): Promise<SearchResult<BookmarksSearchResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.query.tokens.length === 0) return [];

    // Fetch more than needed for client-side scoring
    const fetchMax = Math.min(200, Math.max(50, ctx.limit * 5));
    const items = await client.query({
      query: ctx.query.text,
      maxResults: fetchMax,
      signal: ctx.signal,
    });

    if (ctx.signal.aborted) return [];

    // Score and sort results
    const scored = items
      .map((b) => {
        const score = computeBookmarkScore(b, ctx.query.tokens, ctx.now);
        return { b, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        // Primary: score descending
        if (b.score !== a.score) return b.score - a.score;
        // Tie-breaker: title alphabetically
        return String(a.b.title ?? '').localeCompare(String(b.b.title ?? ''));
      })
      .slice(0, ctx.limit);

    // Convert to SearchResult format
    return scored.map(({ b, score }) => {
      const title = (b.title ?? '').trim() || b.url || 'Untitled';
      const url = (b.url ?? '').trim();

      const data: BookmarksSearchResultData = {
        bookmarkId: String(b.id),
        title,
        url,
        dateAdded: typeof b.dateAdded === 'number' ? b.dateAdded : undefined,
        parentId: typeof b.parentId === 'string' ? b.parentId : undefined,
      };

      return {
        id: String(b.id),
        provider: id,
        title,
        subtitle: url,
        icon,
        data,
        score,
      };
    });
  }

  return {
    id,
    name,
    icon,
    scopes: ['bookmarks'],
    includeInAll: true,
    priority: 20, // Lower priority than tabs (50)
    maxResults: 50,
    supportsEmptyQuery: false,
    search,
    getActions,
  };
}
