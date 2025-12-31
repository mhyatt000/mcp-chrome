/**
 * Quick Panel History Handler
 *
 * Background service worker bridge for HistoryProvider.
 * Handles history queries from content script Quick Panel UI.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelHistoryQueryMessage,
  type QuickPanelHistoryQueryResponse,
  type QuickPanelHistorySummary,
} from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelHistory]';

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

async function handleHistoryQuery(
  message: QuickPanelHistoryQueryMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelHistoryQueryResponse> {
  try {
    // Validate sender
    if (!sender.tab?.id) {
      return { success: false, error: 'Quick Panel request must originate from a tab.' };
    }

    const query = normalizeString(message.payload?.query).trim();
    const maxResults = normalizeInt(message.payload?.maxResults, 200);

    // Empty query returns empty results
    if (!query) {
      return { success: true, items: [] };
    }

    // Search history using Chrome API
    const items = await chrome.history.search({
      text: query,
      maxResults,
      startTime: 0, // Search all history
    });

    // Filter and transform to summary format
    const normalized = (Array.isArray(items) ? items : [])
      .filter((i) => typeof i?.url === 'string' && !!i.url)
      .map(
        (i): QuickPanelHistorySummary => ({
          id: String(i.id),
          url: i.url ?? '',
          title: i.title ?? '',
          lastVisitTime: typeof i.lastVisitTime === 'number' ? i.lastVisitTime : undefined,
          visitCount: typeof i.visitCount === 'number' ? i.visitCount : undefined,
          typedCount: typeof i.typedCount === 'number' ? i.typedCount : undefined,
        }),
      )
      .filter((i) => i.url.length > 0);

    return { success: true, items: normalized };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error querying history:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to query history' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

/**
 * Initialize the Quick Panel history message handler.
 * Should be called once during background script setup.
 */
export function initQuickPanelHistoryHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_HISTORY_QUERY) {
      handleHistoryQuery(message as QuickPanelHistoryQueryMessage, sender).then(sendResponse);
      return true; // Will respond asynchronously
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
