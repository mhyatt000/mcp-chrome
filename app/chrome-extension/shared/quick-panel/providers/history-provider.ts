/**
 * History Search Provider (Quick Panel)
 *
 * Searches browser history via background service worker bridge.
 * Runs in content script Quick Panel UI - delegates history queries
 * and navigation to the background service worker via chrome.runtime messaging.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelHistoryDeleteResponse,
  type QuickPanelHistoryQueryResponse,
  type QuickPanelHistorySummary,
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
 * Data associated with a history search result.
 */
export interface HistorySearchResultData {
  historyId: string;
  url: string;
  title: string;
  lastVisitTime?: number;
  visitCount?: number;
  typedCount?: number;
}

// ============================================================
// History Client (Background Bridge)
// ============================================================

interface HistoryClient {
  query: (options: {
    query: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelHistorySummary[]>;
  deleteUrl: (url: string) => Promise<void>;
}

function createRuntimeHistoryClient(): HistoryClient {
  async function query(options: {
    query: string;
    maxResults: number;
    signal: AbortSignal;
  }): Promise<QuickPanelHistorySummary[]> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    if (options.signal.aborted) {
      throw new Error('aborted');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_HISTORY_QUERY,
      payload: { query: options.query, maxResults: options.maxResults },
    })) as QuickPanelHistoryQueryResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to query history');
    }

    return Array.isArray(resp.items) ? resp.items : [];
  }

  async function deleteUrl(url: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const normalized = String(url ?? '').trim();
    if (!normalized) {
      throw new Error('url is required');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_HISTORY_DELETE,
      payload: { url: normalized },
    })) as QuickPanelHistoryDeleteResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to delete history entry');
    }
  }

  return { query, deleteUrl };
}

// ============================================================
// Scoring Helpers
// ============================================================

/**
 * Compute score for a history item based on query tokens.
 * Includes recency boost based on lastVisitTime.
 */
function computeHistoryScore(
  item: QuickPanelHistorySummary,
  tokens: readonly string[],
  now: number,
): number {
  const base = computeWeightedTokenScore(
    [
      { value: item.title ?? '', weight: 0.7, mode: 'text' },
      { value: item.url ?? '', weight: 0.3, mode: 'url' },
    ],
    tokens,
  );
  if (base <= 0) return 0;

  // Add recency boost based on lastVisitTime
  const lastVisit = typeof item.lastVisitTime === 'number' ? item.lastVisitTime : null;
  if (!lastVisit || !Number.isFinite(lastVisit) || lastVisit <= 0) {
    return base;
  }

  // More recently visited pages get a larger boost (up to 15 points over 15 days)
  const ageMs = Math.max(0, now - lastVisit);
  const ageHours = ageMs / (1000 * 60 * 60);
  const recencyBoost = Math.max(0, Math.min(15, 15 - ageHours / 24));

  return base + recencyBoost;
}

// ============================================================
// Provider Factory
// ============================================================

/**
 * Create a History search provider for Quick Panel.
 *
 * @example
 * ```typescript
 * const historyProvider = createHistoryProvider();
 * searchEngine.registerProvider(historyProvider);
 * ```
 */
export function createHistoryProvider(): SearchProvider<HistorySearchResultData> {
  const id = 'history';
  const name = 'History';
  const icon = '\uD83D\uDD50'; // 🕐

  const client = createRuntimeHistoryClient();

  /**
   * Get actions available for a history result.
   */
  function getActions(
    item: SearchResult<HistorySearchResultData>,
  ): Action<HistorySearchResultData>[] {
    const { url, title } = item.data;

    return [
      // Primary action: Open in current tab
      {
        id: 'history.open',
        title: 'Open',
        hotkeyHint: 'Enter',
        execute: async (ctx) => {
          await openUrl({ url, disposition: ctx.openMode ?? 'current_tab' });
        },
      },
      // Open in new tab
      {
        id: 'history.openNewTab',
        title: 'Open in new tab',
        hotkeyHint: 'Cmd/Ctrl+Enter',
        execute: async () => {
          await openUrl({ url, disposition: 'new_tab' });
        },
      },
      // Copy URL
      {
        id: 'history.copyUrl',
        title: 'Copy URL',
        hotkeyHint: 'Cmd+C',
        execute: async () => {
          await writeToClipboard(url, { source: 'history.copy.url', label: title });
        },
      },
      // Copy as Markdown link
      {
        id: 'history.copyMarkdown',
        title: 'Copy as Markdown',
        hotkeyHint: 'Cmd+Shift+C',
        execute: async () => {
          await writeToClipboard(formatMarkdownLink(title, url), {
            source: 'history.copy.markdown',
            label: title,
          });
        },
      },
      // Delete from history (danger)
      {
        id: 'history.delete',
        title: 'Delete from history',
        tone: 'danger',
        execute: async () => {
          await client.deleteUrl(url);
        },
      },
    ];
  }

  /**
   * Search for history items matching the query.
   */
  async function search(
    ctx: SearchProviderContext,
  ): Promise<SearchResult<HistorySearchResultData>[]> {
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
      .map((i) => {
        const score = computeHistoryScore(i, ctx.query.tokens, ctx.now);
        return { i, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        // Primary: score descending
        if (b.score !== a.score) return b.score - a.score;
        // Tie-breaker: more recently visited first
        const aTime = typeof a.i.lastVisitTime === 'number' ? a.i.lastVisitTime : 0;
        const bTime = typeof b.i.lastVisitTime === 'number' ? b.i.lastVisitTime : 0;
        return bTime - aTime;
      })
      .slice(0, ctx.limit);

    // Convert to SearchResult format
    return scored.map(({ i, score }) => {
      const url = (i.url ?? '').trim();
      const title = (i.title ?? '').trim() || url || 'Untitled';

      const data: HistorySearchResultData = {
        historyId: String(i.id),
        title,
        url,
        lastVisitTime: typeof i.lastVisitTime === 'number' ? i.lastVisitTime : undefined,
        visitCount: typeof i.visitCount === 'number' ? i.visitCount : undefined,
        typedCount: typeof i.typedCount === 'number' ? i.typedCount : undefined,
      };

      return {
        id: String(i.id),
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
    scopes: ['history'],
    includeInAll: true,
    priority: 10, // Lower priority than tabs (50) and bookmarks (20)
    maxResults: 50,
    supportsEmptyQuery: false,
    search,
    getActions,
  };
}
