/**
 * Tabs Search Provider (Quick Panel)
 *
 * Searches open browser tabs via background service worker bridge.
 * Runs in content script Quick Panel UI - delegates tab operations
 * to the background service worker via chrome.runtime messaging.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelActivateTabResponse,
  type QuickPanelCloseTabResponse,
  type QuickPanelTabSetMutedResponse,
  type QuickPanelTabSetPinnedResponse,
  type QuickPanelTabSummary,
  type QuickPanelTabsQueryResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { computeWeightedTokenScore, formatMarkdownLink, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

/**
 * Data associated with a tab search result.
 */
export interface TabsSearchResultData {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  muted: boolean;
}

export interface TabsProviderOptions {
  /** Provider ID. Default: 'tabs' */
  id?: string;
  /** Display name. Default: 'Tabs' */
  name?: string;
  /** Icon. Default: '🗂️' */
  icon?: string;
  /** Include tabs from all windows. Default: true */
  includeAllWindows?: boolean;
}

// ============================================================
// Tabs Client (Background Bridge)
// ============================================================

interface TabsSnapshot {
  tabs: QuickPanelTabSummary[];
  currentTabId: number | null;
  currentWindowId: number | null;
}

interface TabsClient {
  listTabs: (options: { includeAllWindows: boolean; signal: AbortSignal }) => Promise<TabsSnapshot>;
  activateTab: (tabId: number, windowId?: number) => Promise<void>;
  closeTab: (tabId: number) => Promise<void>;
  setPinned: (tabId: number, pinned: boolean) => Promise<void>;
  setMuted: (tabId: number, muted: boolean) => Promise<void>;
}

function createRuntimeTabsClient(): TabsClient {
  async function listTabs(options: {
    includeAllWindows: boolean;
    signal: AbortSignal;
  }): Promise<TabsSnapshot> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    if (options.signal.aborted) {
      throw new Error('aborted');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TABS_QUERY,
      payload: { includeAllWindows: options.includeAllWindows },
    })) as QuickPanelTabsQueryResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to query tabs');
    }

    return {
      tabs: resp.tabs,
      currentTabId: resp.currentTabId,
      currentWindowId: resp.currentWindowId,
    };
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

  async function setPinned(tabId: number, pinned: boolean): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_SET_PINNED,
      payload: { tabId, pinned },
    })) as QuickPanelTabSetPinnedResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to set tab pinned state');
    }
  }

  async function setMuted(tabId: number, muted: boolean): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_SET_MUTED,
      payload: { tabId, muted },
    })) as QuickPanelTabSetMutedResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to set tab muted state');
    }
  }

  return { listTabs, activateTab, closeTab, setPinned, setMuted };
}

// ============================================================
// Scoring Helpers
// ============================================================

/**
 * Compute overall score for a tab based on query tokens.
 * Each token can match in EITHER title OR url (cross-field matching).
 */
function computeTabScore(
  tab: QuickPanelTabSummary,
  queryTokens: readonly string[],
  currentWindowId: number | null,
  currentTabId: number | null,
): number {
  if (queryTokens.length === 0) return 0;

  // Use shared weighted token scoring
  const base = computeWeightedTokenScore(
    [
      { value: tab.title, weight: 0.75, mode: 'text' },
      { value: tab.url, weight: 0.25, mode: 'url' },
    ],
    queryTokens,
  );
  if (base <= 0) return 0;

  // Boost for context relevance
  let boost = 0;
  if (typeof currentWindowId === 'number' && tab.windowId === currentWindowId) {
    boost += 10;
  }
  if (typeof currentTabId === 'number' && tab.tabId === currentTabId) {
    boost += 15;
  } else if (tab.active) {
    boost += 6;
  }
  if (tab.pinned) boost += 4;
  if (tab.audible) boost += 2;

  return base + boost;
}

/**
 * Sort tabs by score with tie-breaking rules.
 */
function sortTabs(
  a: { tab: QuickPanelTabSummary; score: number },
  b: { tab: QuickPanelTabSummary; score: number },
  currentWindowId: number | null,
  currentTabId: number | null,
): number {
  // Primary: score descending
  if (b.score !== a.score) return b.score - a.score;

  // Tie-breaker 1: current tab first
  const aIsCurrentTab = typeof currentTabId === 'number' && a.tab.tabId === currentTabId;
  const bIsCurrentTab = typeof currentTabId === 'number' && b.tab.tabId === currentTabId;
  if (aIsCurrentTab !== bIsCurrentTab) return aIsCurrentTab ? -1 : 1;

  // Tie-breaker 2: current window first
  const aIsCurrentWin = typeof currentWindowId === 'number' && a.tab.windowId === currentWindowId;
  const bIsCurrentWin = typeof currentWindowId === 'number' && b.tab.windowId === currentWindowId;
  if (aIsCurrentWin !== bIsCurrentWin) return aIsCurrentWin ? -1 : 1;

  // Tie-breaker 3: pinned first
  if (a.tab.pinned !== b.tab.pinned) return a.tab.pinned ? -1 : 1;

  // Tie-breaker 4: active first
  if (a.tab.active !== b.tab.active) return a.tab.active ? -1 : 1;

  // Tie-breaker 5: tab index
  return a.tab.index - b.tab.index;
}

// ============================================================
// Provider Factory
// ============================================================

/**
 * Create a Tabs search provider for Quick Panel.
 *
 * @example
 * ```typescript
 * const tabsProvider = createTabsProvider();
 * searchEngine.registerProvider(tabsProvider);
 * ```
 */
export function createTabsProvider(
  options: TabsProviderOptions = {},
): SearchProvider<TabsSearchResultData> {
  const id = options.id?.trim() || 'tabs';
  const name = options.name?.trim() || 'Tabs';
  const icon = options.icon?.trim() || '\uD83D\uDDC2\uFE0F'; // 🗂️
  const includeAllWindows = options.includeAllWindows ?? true;

  const client: TabsClient = createRuntimeTabsClient();

  /**
   * Get actions available for a tab result.
   */
  function getActions(item: SearchResult<TabsSearchResultData>): Action<TabsSearchResultData>[] {
    const { tabId, windowId, url, title, pinned, audible, muted } = item.data;

    const actions: Action<TabsSearchResultData>[] = [
      // Primary action: Switch to tab
      {
        id: 'tabs.activate',
        title: 'Switch to tab',
        hotkeyHint: 'Enter',
        execute: async () => {
          await client.activateTab(tabId, windowId);
        },
      },
      // Copy URL
      {
        id: 'tabs.copyUrl',
        title: 'Copy URL',
        hotkeyHint: 'Cmd+C',
        execute: async () => {
          await writeToClipboard(url, { source: 'tabs.copy.url', label: title });
        },
      },
      // Copy as Markdown link
      {
        id: 'tabs.copyMarkdown',
        title: 'Copy as Markdown',
        hotkeyHint: 'Cmd+Shift+C',
        execute: async () => {
          await writeToClipboard(formatMarkdownLink(title, url), {
            source: 'tabs.copy.markdown',
            label: title,
          });
        },
      },
      // Pin/Unpin toggle
      {
        id: pinned ? 'tabs.unpin' : 'tabs.pin',
        title: pinned ? 'Unpin tab' : 'Pin tab',
        hotkeyHint: 'Cmd+P',
        execute: async () => {
          await client.setPinned(tabId, !pinned);
        },
      },
    ];

    // Add mute/unmute action only for audible tabs or already muted tabs
    if (audible || muted) {
      actions.push({
        id: muted ? 'tabs.unmute' : 'tabs.mute',
        title: muted ? 'Unmute tab' : 'Mute tab',
        hotkeyHint: 'Cmd+M',
        execute: async () => {
          await client.setMuted(tabId, !muted);
        },
      });
    }

    // Close tab (danger action at the end)
    actions.push({
      id: 'tabs.close',
      title: 'Close tab',
      tone: 'danger',
      hotkeyHint: 'Cmd+W',
      execute: async () => {
        await client.closeTab(tabId);
      },
    });

    return actions;
  }

  /**
   * Search for tabs matching the query.
   */
  async function search(ctx: SearchProviderContext): Promise<SearchResult<TabsSearchResultData>[]> {
    if (ctx.signal.aborted) return [];

    const snapshot = await client.listTabs({ includeAllWindows, signal: ctx.signal });
    if (ctx.signal.aborted) return [];

    const tokens = ctx.query.tokens;
    const limit = ctx.limit;

    const scored: Array<{ tab: QuickPanelTabSummary; score: number }> = [];

    for (const tab of snapshot.tabs) {
      // Skip invalid tabs
      if (typeof tab.tabId !== 'number' || tab.tabId <= 0) continue;

      // Empty query: show all tabs with recency-based scoring
      if (tokens.length === 0) {
        let score = 0;
        if (typeof snapshot.currentTabId === 'number' && tab.tabId === snapshot.currentTabId) {
          score += 100;
        }
        if (
          typeof snapshot.currentWindowId === 'number' &&
          tab.windowId === snapshot.currentWindowId
        ) {
          score += 30;
        }
        if (tab.active) score += 20;
        if (tab.pinned) score += 10;

        // Use lastAccessed for recency (more recent = higher score)
        const lastAccessed = tab.lastAccessed;
        if (typeof lastAccessed === 'number' && Number.isFinite(lastAccessed) && lastAccessed > 0) {
          // Normalize recency: more recent tabs get higher bonus (up to 15 points)
          // Clamp ageMs to prevent negative values from future timestamps
          const ageMs = Math.max(0, ctx.now - lastAccessed);
          // Decay over 1 hour, clamp bonus to [0, 15]
          const recencyBonus = Math.max(0, Math.min(15, 15 - ageMs / (1000 * 60 * 60)));
          score += recencyBonus;
        } else {
          // Fallback to index if lastAccessed not available
          score += Math.max(0, 5 - tab.index * 0.05);
        }

        scored.push({ tab, score });
        continue;
      }

      // Query-based scoring
      const score = computeTabScore(tab, tokens, snapshot.currentWindowId, snapshot.currentTabId);
      if (score > 0) {
        scored.push({ tab, score });
      }
    }

    // Sort and limit
    scored.sort((a, b) => sortTabs(a, b, snapshot.currentWindowId, snapshot.currentTabId));
    const top = scored.slice(0, limit);

    // Convert to SearchResult format
    return top.map(({ tab, score }) => {
      const title = tab.title?.trim() || tab.url || 'Untitled';
      const url = tab.url?.trim() || '';

      const data: TabsSearchResultData = {
        tabId: tab.tabId,
        windowId: tab.windowId,
        title,
        url,
        favIconUrl: tab.favIconUrl,
        pinned: tab.pinned,
        active: tab.active,
        audible: tab.audible,
        muted: tab.muted,
      };

      return {
        id: String(tab.tabId),
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
    scopes: ['tabs'],
    includeInAll: true,
    priority: 50, // High priority for tab switching
    maxResults: 50,
    supportsEmptyQuery: true,
    search,
    getActions,
  };
}
