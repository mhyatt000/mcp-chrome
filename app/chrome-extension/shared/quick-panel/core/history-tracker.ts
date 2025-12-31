/**
 * Quick Panel History Tracker
 *
 * Tracks usage statistics for search results and provides:
 * - Recording of usage events
 * - Frecency signals for search ranking
 * - Recent items list for empty query state
 *
 * Storage: IndexedDB (background service worker) via chrome.runtime messaging
 *
 * Frecency algorithm (exponential decay with log frequency):
 * - recency = exp(-ageHours * ln(2) / halfLifeHours)  [0-1]  // half-life decay
 * - frequency = log1p(count) / log1p(countCap)  [0-1]
 * - boost = 30*recency + 10*frequency  [0-40]
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelUsageGetEntriesResponse,
  type QuickPanelUsageListRecentResponse,
  type QuickPanelUsageRecordResponse,
} from '@/common/message-types';

import { parseUsageKey } from './usage-key';

// ============================================================
// Types
// ============================================================

/**
 * Raw usage entry stored per key.
 */
export interface UsageEntry {
  /** Timestamp of last usage (ms since epoch) */
  lastUsedAt: number;
  /** Total usage count */
  count: number;
}

/**
 * Computed usage signal for ranking.
 */
export interface UsageSignal {
  /** Timestamp of last usage */
  lastUsedAt: number;
  /** Total usage count */
  count: number;
  /** Recency factor [0-1], higher = more recent */
  recency: number;
  /** Frequency factor [0-1], higher = more frequent */
  frequency: number;
  /** Score boost to add to search result [0-40] */
  boost: number;
}

/**
 * Item in the recent list.
 */
export interface RecentItem {
  /** Usage key */
  key: string;
  /** Timestamp of last usage */
  lastUsedAt: number;
  /** Total usage count */
  count: number;
}

/**
 * Options for HistoryTracker.
 */
export interface HistoryTrackerOptions {
  /** History namespace (legacy chrome.storage.local key). Default: 'quickPanelUsage.v1' */
  storageKey?: string;
  /** @deprecated Kept for backward compatibility (no-op for IndexedDB backend). */
  flushDebounceMs?: number;
  /** Maximum entries to keep. Oldest/lowest usage evicted. Default: 500 */
  maxEntries?: number;
  /** Half-life for recency decay in hours. Default: 72 */
  halfLifeHours?: number;
  /** Cap for frequency calculation. Default: 30 */
  countCap?: number;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_STORAGE_KEY = 'quickPanelUsage.v1';
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_RECENT_LIMIT = 20;

// Frecency parameters
const DEFAULT_HALF_LIFE_HOURS = 72; // 3 days
const DEFAULT_COUNT_CAP = 30;

// Safety limits
const MAX_ENTRIES_HARD_CAP = 10_000;
const MAX_COUNT_HARD_CAP = 10_000;
const MAX_KEYS_PER_REQUEST = 2000;

// ============================================================
// Helpers
// ============================================================

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(toFiniteNumber(value, fallback));
  return Math.max(min, Math.min(max, n));
}

function safeNow(): number {
  return Date.now();
}

// ============================================================
// HistoryTracker Class
// ============================================================

/**
 * Tracks Quick Panel usage for frecency ranking and recent items.
 *
 * Uses background service worker IndexedDB via chrome.runtime messaging
 * to ensure data persistence across all tabs without concurrent write issues.
 *
 * @example
 * ```typescript
 * const tracker = new HistoryTracker();
 *
 * // Record usage after action execution
 * await tracker.recordUsage('url:https://example.com/');
 *
 * // Get signals for ranking
 * const signals = await tracker.getSignals(['url:https://example.com/', 'cmd:reload']);
 *
 * // Get recent items for empty query
 * const recent = await tracker.getRecentList(10);
 * ```
 */
export class HistoryTracker {
  private readonly storageKey: string;
  private readonly maxEntries: number;
  private readonly halfLifeHours: number;
  private readonly countCap: number;

  constructor(options: HistoryTrackerOptions = {}) {
    this.storageKey =
      String(options.storageKey ?? DEFAULT_STORAGE_KEY).trim() || DEFAULT_STORAGE_KEY;
    this.maxEntries = clampInt(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, MAX_ENTRIES_HARD_CAP);
    this.halfLifeHours = Math.max(
      1,
      toFiniteNumber(options.halfLifeHours, DEFAULT_HALF_LIFE_HOURS),
    );
    this.countCap = clampInt(options.countCap, DEFAULT_COUNT_CAP, 1, MAX_COUNT_HARD_CAP);
  }

  // --------------------------------------------------------
  // Public API
  // --------------------------------------------------------

  /**
   * Record a usage event for a key.
   * Updates lastUsedAt to now and increments count.
   *
   * @param key - Usage key (must be valid format: url:... or cmd:...)
   */
  async recordUsage(key: string): Promise<void> {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) return;

    // Validate key format
    if (!parseUsageKey(normalizedKey)) return;

    const resp = await this.callBackground<QuickPanelUsageRecordResponse>({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_RECORD,
      payload: {
        namespace: this.storageKey,
        key: normalizedKey,
        maxEntries: this.maxEntries,
      },
    });

    // Best-effort: ignore persistence failures
    if (!resp || resp.success !== true) return;
  }

  /**
   * Get usage signals for a set of keys.
   *
   * @param keys - Array of usage keys to look up
   * @returns Map of key -> signal (only keys with usage data included)
   */
  async getSignals(keys: string[]): Promise<Map<string, UsageSignal>> {
    const now = safeNow();
    const uniqueKeys = [
      ...new Set(
        (Array.isArray(keys) ? keys : [])
          .map((k) => String(k ?? '').trim())
          .filter((k) => k && parseUsageKey(k) !== null),
      ),
    ].slice(0, MAX_KEYS_PER_REQUEST);

    const out = new Map<string, UsageSignal>();

    if (uniqueKeys.length === 0) return out;

    const resp = await this.callBackground<QuickPanelUsageGetEntriesResponse>({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_GET_ENTRIES,
      payload: {
        namespace: this.storageKey,
        keys: uniqueKeys,
      },
    });

    if (!resp || resp.success !== true) return out;

    const rows = Array.isArray(resp.entries) ? resp.entries : [];
    for (const row of rows) {
      const key = typeof row?.key === 'string' ? row.key : '';
      if (!key) continue;

      const lastUsedAt = toFiniteNumber(row.lastUsedAt, 0);
      const count = clampInt(row.count, 0, 0, MAX_COUNT_HARD_CAP);
      if (lastUsedAt <= 0 && count <= 0) continue;

      const recency = this.computeRecency(now, lastUsedAt);
      const frequency = this.computeFrequency(count);
      const boost = this.computeBoost(recency, frequency);

      out.set(key, { lastUsedAt, count, recency, frequency, boost });
    }

    return out;
  }

  /**
   * Get list of recently used items.
   *
   * @param limit - Maximum items to return. Default: 20
   * @param scopeFilter - Optional filter function to include only matching keys
   * @returns Array of recent items sorted by lastUsedAt descending
   */
  async getRecentList(
    limit: number = DEFAULT_RECENT_LIMIT,
    scopeFilter?: (key: string) => boolean,
  ): Promise<RecentItem[]> {
    const max = clampInt(limit, DEFAULT_RECENT_LIMIT, 0, 500);
    if (max <= 0) return [];

    // Ask for more than requested to allow caller-side filtering
    const scanLimit = Math.min(Math.max(max * 10, 100), Math.min(this.maxEntries, 2000));

    const resp = await this.callBackground<QuickPanelUsageListRecentResponse>({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_LIST_RECENT,
      payload: {
        namespace: this.storageKey,
        limit: scanLimit,
      },
    });

    if (!resp || resp.success !== true) return [];

    const out: RecentItem[] = [];
    const rows = Array.isArray(resp.items) ? resp.items : [];

    for (const row of rows) {
      const key = typeof row?.key === 'string' ? row.key : '';
      if (!key) continue;
      if (scopeFilter && !scopeFilter(key)) continue;

      const lastUsedAt = toFiniteNumber(row.lastUsedAt, 0);
      const count = clampInt(row.count, 0, 0, MAX_COUNT_HARD_CAP);
      if (lastUsedAt <= 0 && count <= 0) continue;

      out.push({ key, lastUsedAt, count });
      if (out.length >= max) break;
    }

    // Defensive: ensure ordering even if backend changes
    out.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    return out;
  }

  /**
   * Check if tracker has been disposed.
   */
  isDisposed(): boolean {
    return false; // No dispose needed for this implementation
  }

  // --------------------------------------------------------
  // Frecency Calculations
  // --------------------------------------------------------

  private computeRecency(now: number, lastUsedAt: number): number {
    if (!Number.isFinite(lastUsedAt) || lastUsedAt <= 0) return 0;
    const ageMs = Math.max(0, now - lastUsedAt);
    const ageHours = ageMs / (1000 * 60 * 60);
    // Exponential decay: value halves every halfLifeHours
    return Math.exp((-ageHours * Math.LN2) / this.halfLifeHours);
  }

  private computeFrequency(count: number): number {
    const c = clampInt(count, 0, 0, this.countCap);
    const denom = Math.log1p(this.countCap);
    if (denom <= 0) return 0;
    return Math.max(0, Math.min(1, Math.log1p(c) / denom));
  }

  private computeBoost(recency: number, frequency: number): number {
    const r = Math.max(0, Math.min(1, toFiniteNumber(recency, 0)));
    const f = Math.max(0, Math.min(1, toFiniteNumber(frequency, 0)));
    // 30 points for recency + 10 points for frequency = max 40 points
    return Math.max(0, Math.min(40, 30 * r + 10 * f));
  }

  // --------------------------------------------------------
  // Persistence (Background IndexedDB via Message Bridge)
  // --------------------------------------------------------

  private async callBackground<T>(message: unknown): Promise<T | null> {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
      return (await chrome.runtime.sendMessage(message)) as T;
    } catch {
      return null;
    }
  }
}
