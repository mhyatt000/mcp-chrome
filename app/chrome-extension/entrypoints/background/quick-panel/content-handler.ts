/**
 * Quick Panel Content Search Handler
 *
 * Background service worker bridge for "Content" provider:
 * - Maintains an in-memory cache of extracted readable text for open tabs
 * - Updates cache on page load completion and SPA route changes (best-effort)
 * - Serves token-based content search results to content scripts via messaging
 *
 * Extraction is implemented by reusing the existing injected helper:
 * `inject-scripts/web-fetcher-helper.js` (Readability-based text extraction).
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  TOOL_MESSAGE_TYPES,
  type QuickPanelContentMatchSummary,
  type QuickPanelContentQueryMessage,
  type QuickPanelContentQueryResponse,
} from '@/common/message-types';
import {
  createContentSnippet,
  scoreTokensAgainstNormalizedText,
} from '@/shared/quick-panel/core/content-search';
import { normalizeSearchQuery } from '@/shared/quick-panel/core/types';
import { normalizeText, normalizeUrl } from '@/shared/quick-panel/core/text-score';

const LOG_PREFIX = '[QuickPanelContent]';

// ============================================================
// Config
// ============================================================

/** Maximum number of results returned for a single query. */
const MAX_RESULTS_LIMIT = 200;
/** Maximum cached content size per tab (characters). */
const MAX_CONTENT_CHARS = 50 * 1024; // 50KB target, best-effort
/** Minimum content length to keep (avoid caching empty/noisy extractions). */
const MIN_CONTENT_CHARS = 20;
/** Max cached tab entries to avoid unbounded memory usage. */
const MAX_CACHE_ENTRIES = 200;

/** Delay before indexing after a navigation signal (ms). */
const INDEX_DEBOUNCE_MS = 1200;
/** Limit concurrent extraction work to avoid overwhelming the page/CPU. */
const INDEX_CONCURRENCY = 2;

/** Session storage key (best-effort persistence within browser session). */
const SESSION_STORAGE_KEY = 'quick_panel_content_cache_v1';

// ============================================================
// Types
// ============================================================

interface StoredContentEntry {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
  content: string;
  updatedAt: number;
  lastAccessed?: number;
}

interface ContentEntry extends StoredContentEntry {
  normalizedTitle: string;
  normalizedUrl: string;
  normalizedContent: string;
}

// ============================================================
// Helpers
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeInt(value: unknown, fallback: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(num)));
}

function isValidTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isValidWindowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getLastAccessed(tab: chrome.tabs.Tab): number | undefined {
  const anyTab = tab as unknown as { lastAccessed?: unknown };
  const value = anyTab.lastAccessed;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isIndexableUrl(url: string): boolean {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return false;

  // Only allow http(s) to keep behavior predictable and avoid restricted schemes.
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function truncateContent(text: string): string {
  const value = String(text ?? '');
  if (value.length <= MAX_CONTENT_CHARS) return value;
  return value.slice(0, MAX_CONTENT_CHARS);
}

function toContentEntry(stored: StoredContentEntry): ContentEntry {
  return {
    ...stored,
    normalizedTitle: normalizeText(stored.title),
    normalizedUrl: normalizeUrl(stored.url),
    normalizedContent: normalizeText(stored.content),
  };
}

// (scoring + snippet helpers are shared in core/content-search.ts)

// ============================================================
// Cache + Persistence (best-effort)
// ============================================================

const cache = new Map<number, ContentEntry>();

let sessionLoaded = false;
let sessionLoadPromise: Promise<void> | null = null;
let sessionPersistDisabled = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight: Promise<void> | null = null;
let persistDirty = false;

async function ensureSessionLoaded(): Promise<void> {
  if (sessionLoaded) return;
  if (sessionLoadPromise) return sessionLoadPromise;

  sessionLoadPromise = (async () => {
    try {
      if (!chrome.storage?.session) {
        sessionLoaded = true;
        return;
      }

      const stored = (await chrome.storage.session.get([SESSION_STORAGE_KEY])) as Record<
        string,
        unknown
      >;
      const rawValue = stored?.[SESSION_STORAGE_KEY];
      if (!isRecord(rawValue)) {
        sessionLoaded = true;
        return;
      }

      const entries: ContentEntry[] = [];
      for (const value of Object.values(rawValue)) {
        if (!isRecord(value)) continue;
        const tabId = Number((value as any).tabId);
        const windowId = Number((value as any).windowId);
        const url = normalizeString((value as any).url).trim();
        const title = normalizeString((value as any).title).trim();
        const content = normalizeString((value as any).content);
        const updatedAt = Number((value as any).updatedAt);

        if (!isValidTabId(tabId)) continue;
        if (!isValidWindowId(windowId)) continue;
        if (!url) continue;
        if (!content) continue;
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;

        entries.push(
          toContentEntry({
            tabId,
            windowId,
            url,
            title,
            content: truncateContent(content),
            updatedAt,
            favIconUrl:
              typeof (value as any).favIconUrl === 'string' ? (value as any).favIconUrl : undefined,
            lastAccessed:
              typeof (value as any).lastAccessed === 'number'
                ? (value as any).lastAccessed
                : undefined,
          }),
        );
      }

      // Remove entries for tabs that are no longer open (best-effort).
      const openTabs = await chrome.tabs.query({});
      const openIds = new Set(openTabs.map((t) => t.id).filter(isValidTabId));

      cache.clear();
      for (const e of entries) {
        if (!openIds.has(e.tabId)) continue;
        cache.set(e.tabId, e);
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to load session cache:`, err);
    } finally {
      sessionLoaded = true;
    }
  })().finally(() => {
    sessionLoadPromise = null;
  });

  return sessionLoadPromise;
}

function scheduleSessionPersist(): void {
  if (sessionPersistDisabled) return;
  if (!chrome.storage?.session) return;

  persistDirty = true;
  if (persistTimer) return;

  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushSessionPersist();
  }, 500);
}

async function flushSessionPersist(): Promise<void> {
  if (sessionPersistDisabled) return;
  if (!chrome.storage?.session) return;

  if (persistInFlight) {
    await persistInFlight.catch(() => {});
  }

  if (!persistDirty) return;
  persistDirty = false;

  const snapshot: Record<string, StoredContentEntry> = {};
  for (const e of cache.values()) {
    snapshot[String(e.tabId)] = {
      tabId: e.tabId,
      windowId: e.windowId,
      url: e.url,
      title: e.title,
      favIconUrl: e.favIconUrl,
      content: e.content,
      updatedAt: e.updatedAt,
      lastAccessed: e.lastAccessed,
    };
  }

  persistInFlight = chrome.storage.session
    .set({ [SESSION_STORAGE_KEY]: snapshot })
    .catch((err) => {
      // Avoid noisy logs if storage quota is exceeded; disable further attempts.
      sessionPersistDisabled = true;
      console.warn(`${LOG_PREFIX} Disabled session persistence due to error:`, err);
    })
    .finally(() => {
      persistInFlight = null;
      if (persistDirty) scheduleSessionPersist();
    });

  await persistInFlight.catch(() => {});
}

function upsertCacheEntry(entry: ContentEntry): void {
  cache.set(entry.tabId, entry);

  // Enforce max cache size (evict oldest updatedAt).
  if (cache.size > MAX_CACHE_ENTRIES) {
    let oldest: ContentEntry | null = null;
    for (const e of cache.values()) {
      if (!oldest || e.updatedAt < oldest.updatedAt) oldest = e;
    }
    if (oldest) cache.delete(oldest.tabId);
  }

  scheduleSessionPersist();
}

function removeCacheEntry(tabId: number): void {
  if (!cache.delete(tabId)) return;
  scheduleSessionPersist();
}

// ============================================================
// Extraction + Indexing Queue
// ============================================================

const inFlightByTabId = new Map<number, Promise<void>>();
const scheduledTimersByTabId = new Map<number, ReturnType<typeof setTimeout>>();
const pendingReindexByTabId = new Set<number>();

let runningIndexTasks = 0;
const indexQueue: Array<() => void> = [];

function pumpIndexQueue(): void {
  while (runningIndexTasks < INDEX_CONCURRENCY && indexQueue.length > 0) {
    const run = indexQueue.shift();
    run?.();
  }
}

function enqueueIndexTask(task: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    indexQueue.push(() => {
      runningIndexTasks += 1;
      task()
        .catch(() => {
          // Best-effort: errors are handled inside task
        })
        .finally(() => {
          runningIndexTasks -= 1;
          resolve();
          pumpIndexQueue();
        });
    });
    pumpIndexQueue();
  });
}

async function ensureWebFetcherHelper(tabId: number): Promise<void> {
  // Try a lightweight ping first.
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: 'search_tabs_content_ping' });
    if (resp && (resp as any).status === 'pong') return;
  } catch {
    // Fall through to injection
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['inject-scripts/web-fetcher-helper.js'],
  });
}

async function extractReadableText(tabId: number): Promise<string | null> {
  try {
    await ensureWebFetcherHelper(tabId);

    const resp = await chrome.tabs.sendMessage(tabId, {
      action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
    });

    if (resp && (resp as any).success === true) {
      const text = normalizeString((resp as any).textContent);
      const truncated = text ? truncateContent(text) : '';
      return truncated;
    }
    return null;
  } catch (err) {
    // Common for restricted pages; treat as non-indexable.
    return null;
  }
}

async function indexTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id || !isValidTabId(tab.id)) return;

    const url = normalizeString(tab.url).trim();
    const title = normalizeString(tab.title).trim();

    if (!url || !isIndexableUrl(url)) {
      removeCacheEntry(tabId);
      return;
    }

    const content = await extractReadableText(tabId);
    if (content === null) {
      // Extraction failed: clear stale cache for this URL to avoid wrong matches.
      const existing = cache.get(tabId);
      if (existing && existing.url !== url) removeCacheEntry(tabId);
      return;
    }

    // Avoid caching empty/noisy content.
    if (content.trim().length < MIN_CONTENT_CHARS) {
      removeCacheEntry(tabId);
      return;
    }

    const entry: ContentEntry = toContentEntry({
      tabId,
      windowId: isValidWindowId(tab.windowId) ? tab.windowId : 0,
      url,
      title,
      favIconUrl: typeof tab.favIconUrl === 'string' ? tab.favIconUrl : undefined,
      content,
      updatedAt: Date.now(),
      lastAccessed: getLastAccessed(tab),
    });

    // If we somehow can't determine a valid windowId, skip caching.
    if (!isValidWindowId(entry.windowId)) return;

    upsertCacheEntry(entry);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to index tab ${tabId}:`, err);
  }
}

function scheduleIndex(tabId: number, delayMs: number = INDEX_DEBOUNCE_MS): void {
  if (!isValidTabId(tabId)) return;

  const existingTimer = scheduledTimersByTabId.get(tabId);
  if (existingTimer) clearTimeout(existingTimer);

  const t = setTimeout(
    () => {
      scheduledTimersByTabId.delete(tabId);

      if (inFlightByTabId.has(tabId)) {
        // Don't drop updates while an index job is running; reindex once it finishes.
        pendingReindexByTabId.add(tabId);
        return;
      }

      const promise = enqueueIndexTask(() => indexTab(tabId)).finally(() => {
        inFlightByTabId.delete(tabId);
        if (pendingReindexByTabId.has(tabId)) {
          pendingReindexByTabId.delete(tabId);
          scheduleIndex(tabId, 200);
        }
      });
      inFlightByTabId.set(tabId, promise);
    },
    Math.max(0, delayMs),
  );

  scheduledTimersByTabId.set(tabId, t);
}

// ============================================================
// Query Handler
// ============================================================

async function handleContentQuery(
  message: QuickPanelContentQueryMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelContentQueryResponse> {
  try {
    const senderTabId = sender.tab?.id;
    const senderWindowId = sender.tab?.windowId;

    if (!isValidTabId(senderTabId)) {
      return { success: false, error: 'Quick Panel request must originate from a tab.' };
    }

    await ensureSessionLoaded();

    const query = normalizeString(message.payload?.query).trim();
    const maxResults = normalizeInt(message.payload?.maxResults, 20, MAX_RESULTS_LIMIT);

    const normalized = normalizeSearchQuery(query);
    if (normalized.tokens.length === 0) {
      return { success: true, items: [] };
    }

    const tokens = normalized.tokens;
    const now = Date.now();

    const currentTabId = senderTabId;
    const currentWindow = isValidWindowId(senderWindowId) ? senderWindowId : null;

    const scored: Array<{ entry: ContentEntry; score: number }> = [];

    for (const entry of cache.values()) {
      const contentScore = scoreTokensAgainstNormalizedText(entry.normalizedContent, tokens);
      if (contentScore <= 0) continue;

      const titleScore = scoreTokensAgainstNormalizedText(entry.normalizedTitle, tokens);
      const urlScore = scoreTokensAgainstNormalizedText(entry.normalizedUrl, tokens);

      let score = contentScore;
      score += titleScore * 0.08; // up to +8
      score += urlScore * 0.04; // up to +4

      // Recency boost (freshly indexed pages get a small bump)
      const refTs =
        typeof entry.lastAccessed === 'number' && Number.isFinite(entry.lastAccessed)
          ? entry.lastAccessed
          : entry.updatedAt;
      const ageMs = Math.max(0, now - refTs);
      const ageHours = ageMs / (1000 * 60 * 60);
      const recencyBoost = Math.max(0, Math.min(6, 6 - ageHours));
      score += recencyBoost;

      // Context boosts (similar to Tabs provider)
      if (currentWindow !== null && entry.windowId === currentWindow) score += 10;
      if (entry.tabId === currentTabId) score += 15;

      scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxResults);

    const items: QuickPanelContentMatchSummary[] = top.map(({ entry, score }) => ({
      tabId: entry.tabId,
      windowId: entry.windowId,
      url: entry.url,
      title: entry.title || entry.url,
      favIconUrl: entry.favIconUrl,
      snippet: createContentSnippet(entry.content, tokens),
      score,
    }));

    return { success: true, items };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error querying content:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to query content' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

export function initQuickPanelContentHandler(): void {
  if (initialized) return;
  initialized = true;

  // Load session cache in background to reduce first-query latency.
  void ensureSessionLoaded();

  // Index active tab (best-effort warmup).
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const tabId = tabs?.[0]?.id;
      if (isValidTabId(tabId)) scheduleIndex(tabId, 200);
    })
    .catch(() => {});

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo?.status === 'complete') {
      scheduleIndex(tabId);
    }
  });

  if (chrome.webNavigation?.onHistoryStateUpdated) {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      // Only top-frame navigations.
      if (details?.frameId !== 0) return;
      scheduleIndex(details.tabId, 600);
    });
  }

  chrome.tabs.onRemoved.addListener((tabId) => {
    const timer = scheduledTimersByTabId.get(tabId);
    if (timer) {
      clearTimeout(timer);
      scheduledTimersByTabId.delete(tabId);
    }
    pendingReindexByTabId.delete(tabId);
    removeCacheEntry(tabId);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CONTENT_QUERY) {
      handleContentQuery(message as QuickPanelContentQueryMessage, sender).then(sendResponse);
      return true; // Async response
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
