/**
 * Quick Panel Bookmarks Handler
 *
 * Background service worker bridge for BookmarksProvider.
 * Handles bookmark queries from content script Quick Panel UI.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelBookmarksQueryMessage,
  type QuickPanelBookmarksQueryResponse,
  type QuickPanelBookmarkSummary,
} from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelBookmarks]';

// ============================================================
// Helpers
// ============================================================

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Maximum allowed results to prevent excessive memory usage */
const MAX_RESULTS_LIMIT = 500;

function normalizeInt(value: unknown, fallback: number, max: number = MAX_RESULTS_LIMIT): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(num)));
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

// ============================================================
// Message Handler
// ============================================================

async function handleBookmarksQuery(
  message: QuickPanelBookmarksQueryMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelBookmarksQueryResponse> {
  try {
    // Validate sender
    if (!sender.tab?.id) {
      return { success: false, error: 'Quick Panel request must originate from a tab.' };
    }

    const query = normalizeString(message.payload?.query).trim();
    const maxResults = normalizeInt(message.payload?.maxResults, 200);

    // Empty query returns empty results
    if (!query) {
      return { success: true, bookmarks: [] };
    }

    // Search bookmarks using Chrome API
    const nodes = await chrome.bookmarks.search({ query });

    // Filter and transform to summary format
    const bookmarks = (Array.isArray(nodes) ? nodes : [])
      .filter((n) => typeof n?.url === 'string' && !!n.url) // Only include bookmarks with URLs (not folders)
      .slice(0, maxResults)
      .map(
        (n): QuickPanelBookmarkSummary => ({
          id: String(n.id),
          title: n.title ?? '',
          url: n.url ?? '',
          dateAdded: typeof n.dateAdded === 'number' ? n.dateAdded : undefined,
          parentId: typeof n.parentId === 'string' ? n.parentId : undefined,
        }),
      )
      .filter((b) => b.url.length > 0);

    return { success: true, bookmarks };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error querying bookmarks:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to query bookmarks' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

/**
 * Initialize the Quick Panel bookmarks message handler.
 * Should be called once during background script setup.
 */
export function initQuickPanelBookmarksHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_BOOKMARKS_QUERY) {
      handleBookmarksQuery(message as QuickPanelBookmarksQueryMessage, sender).then(sendResponse);
      return true; // Will respond asynchronously
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
