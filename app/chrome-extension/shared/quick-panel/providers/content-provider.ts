/**
 * Content Search Provider (Quick Panel)
 *
 * Searches cached readable page text for open tabs via background service worker bridge.
 *
 * Notes:
 * - Extraction and caching are performed in the background (see quick-panel/content-handler.ts)
 * - This provider only handles querying and result actions (switch/open/copy/close)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelActivateTabResponse,
  type QuickPanelCloseTabResponse,
  type QuickPanelContentMatchSummary,
  type QuickPanelContentQueryResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { openUrl, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

/**
 * Data associated with a content search result.
 */
export interface ContentSearchResultData {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
  snippet: string;
}

// ============================================================
// Client (Background Bridge)
// ============================================================

interface ContentClient {
  query: (options: {
    query: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelContentMatchSummary[]>;
  activateTab: (tabId: number, windowId?: number) => Promise<void>;
  closeTab: (tabId: number) => Promise<void>;
}

function createRuntimeContentClient(): ContentClient {
  async function query(options: {
    query: string;
    maxResults: number;
    signal: AbortSignal;
  }): Promise<QuickPanelContentMatchSummary[]> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    if (options.signal.aborted) {
      throw new Error('aborted');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CONTENT_QUERY,
      payload: { query: options.query, maxResults: options.maxResults },
    })) as QuickPanelContentQueryResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to query content');
    }

    return Array.isArray(resp.items) ? resp.items : [];
  }

  async function activateTab(tabId: number, windowId?: number): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_ACTIVATE,
      payload: { tabId, windowId },
    })) as QuickPanelActivateTabResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to activate tab');
    }
  }

  async function closeTab(tabId: number): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_CLOSE,
      payload: { tabId },
    })) as QuickPanelCloseTabResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to close tab');
    }
  }

  return { query, activateTab, closeTab };
}

// ============================================================
// Provider Factory
// ============================================================

export function createContentProvider(): SearchProvider<ContentSearchResultData> {
  const id = 'content';
  const name = 'Content';
  const icon = '\uD83D\uDCC4'; // 📄

  const client = createRuntimeContentClient();

  function getActions(
    item: SearchResult<ContentSearchResultData>,
  ): Action<ContentSearchResultData>[] {
    const { tabId, windowId, url, title } = item.data;

    return [
      {
        id: 'content.open',
        title: 'Switch to tab',
        hotkeyHint: 'Enter',
        execute: async (ctx) => {
          // Honor "open in new tab" keyboard hint by opening the URL instead of switching.
          if (ctx.openMode === 'new_tab' || ctx.openMode === 'background_tab') {
            await openUrl({ url, disposition: ctx.openMode });
            return;
          }
          await client.activateTab(tabId, windowId);
        },
      },
      {
        id: 'content.openNewTab',
        title: 'Open in new tab',
        hotkeyHint: 'Cmd/Ctrl+Enter',
        execute: async () => {
          await openUrl({ url, disposition: 'new_tab' });
        },
      },
      {
        id: 'content.copyUrl',
        title: 'Copy URL',
        hotkeyHint: 'Cmd+C',
        execute: async () => {
          await writeToClipboard(url, { source: 'content.copy.url', label: title });
        },
      },
      {
        id: 'content.closeTab',
        title: 'Close tab',
        tone: 'danger',
        hotkeyHint: 'Cmd+W',
        execute: async () => {
          await client.closeTab(tabId);
        },
      },
    ];
  }

  async function search(
    ctx: SearchProviderContext,
  ): Promise<SearchResult<ContentSearchResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.query.tokens.length === 0) return [];

    const items = await client.query({
      query: ctx.query.text,
      maxResults: ctx.limit,
      signal: ctx.signal,
    });

    if (ctx.signal.aborted) return [];

    return items.slice(0, ctx.limit).map((m) => {
      const data: ContentSearchResultData = {
        tabId: m.tabId,
        windowId: m.windowId,
        url: m.url,
        title: m.title,
        favIconUrl: m.favIconUrl,
        snippet: m.snippet,
      };

      return {
        id: String(m.tabId),
        provider: id,
        title: m.title?.trim() || m.url || 'Untitled',
        subtitle: m.snippet?.trim() || m.url,
        icon,
        data,
        score: m.score,
      };
    });
  }

  return {
    id,
    name,
    icon,
    scopes: ['content'],
    includeInAll: true,
    priority: 10,
    maxResults: 30,
    supportsEmptyQuery: false,
    search,
    getActions,
  };
}
