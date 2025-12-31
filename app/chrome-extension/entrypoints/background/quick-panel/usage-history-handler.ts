/**
 * Quick Panel Usage History Handler
 *
 * Background service worker bridge for `HistoryTracker` (frecency).
 *
 * Architecture:
 * - IndexedDB in Background Service Worker (extension-origin storage, shared across all tabs)
 * - Per-key readwrite transactions avoid lost updates from full-object writes
 * - Content scripts call via chrome.runtime.sendMessage
 * - Legacy chrome.storage.local used as fallback if IndexedDB fails
 *
 * Why background-owned IndexedDB:
 * - Content script `indexedDB` is page-origin scoped
 * - Extension-origin storage shared across all tabs
 * - Per-key readwrite transactions avoid concurrent overwrite issues
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelUsageEntrySummary,
  type QuickPanelUsageGetEntriesMessage,
  type QuickPanelUsageGetEntriesResponse,
  type QuickPanelUsageListRecentMessage,
  type QuickPanelUsageListRecentResponse,
  type QuickPanelUsageRecordMessage,
  type QuickPanelUsageRecordResponse,
} from '@/common/message-types';
import { parseUsageKey } from '@/shared/quick-panel/core/usage-key';
import { IndexedDbClient } from '@/utils/indexeddb-client';

const LOG_PREFIX = '[QuickPanelUsageHistory]';

// ============================================================
// IndexedDB Schema
// ============================================================

const DB_NAME = 'quick_panel_usage';
const DB_VERSION = 1;

const STORE = 'usage';
const META_KEY = '__meta__' as const;

const IDX_NAMESPACE_LAST_USED_AT = 'namespace_lastUsedAt';
const IDX_NAMESPACE_LAST_USED_AT_COUNT = 'namespace_lastUsedAt_count';

// Keep defaults aligned with shared/quick-panel/core/history-tracker.ts
const DEFAULT_NAMESPACE = 'quickPanelUsage.v1';
const DEFAULT_MAX_ENTRIES = 500;

// Safety limits
const MAX_ENTRIES_HARD_CAP = 10_000;
const MAX_COUNT_HARD_CAP = 10_000;

// Cursor bounds for numeric keys (use safe integers to handle edge cases)
const IDB_NUMBER_MIN = Number.MIN_SAFE_INTEGER;
const IDB_NUMBER_MAX = Number.MAX_SAFE_INTEGER;

// ============================================================
// Types
// ============================================================

interface UsageEntryRecord {
  namespace: string;
  key: string;
  lastUsedAt: number;
  count: number;
}

interface UsageMetaRecord {
  namespace: string;
  key: typeof META_KEY;
  schemaVersion: 1;
  migratedAt: number;
  legacyUpdatedAt: number;
}

interface LegacyUsageEntry {
  lastUsedAt: number;
  count: number;
}

interface LegacyUsageStoreV1 {
  version: 1;
  updatedAt: number;
  entries: Record<string, LegacyUsageEntry>;
}

// ============================================================
// Helpers
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function normalizeNamespace(value: unknown): string {
  const ns = String(value ?? '').trim();
  return ns || DEFAULT_NAMESPACE;
}

// ============================================================
// Legacy Storage (chrome.storage.local)
// ============================================================

function parseLegacyStore(raw: unknown): LegacyUsageStoreV1 | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1) return null;
  if (!isRecord(raw.entries)) return null;

  const entries: Record<string, LegacyUsageEntry> = {};

  for (const [key, value] of Object.entries(raw.entries)) {
    const k = String(key ?? '').trim();
    if (!k) continue;
    if (!parseUsageKey(k)) continue;

    if (!isRecord(value)) continue;
    // Clamp negative timestamps to 0 to avoid IndexedDB range issues
    const lastUsedAt = Math.max(0, toFiniteNumber(value.lastUsedAt, 0));
    const count = clampInt(value.count, 0, 0, MAX_COUNT_HARD_CAP);

    if (lastUsedAt <= 0 && count <= 0) continue;
    entries[k] = { lastUsedAt, count };
  }

  return {
    version: 1,
    updatedAt: toFiniteNumber(raw.updatedAt, 0),
    entries,
  };
}

function evictLegacyEntries(entries: Map<string, LegacyUsageEntry>, maxEntries: number): void {
  if (entries.size <= maxEntries) return;

  const ordered = [...entries.entries()].sort((a, b) => {
    const aAt = toFiniteNumber(a[1]?.lastUsedAt, 0);
    const bAt = toFiniteNumber(b[1]?.lastUsedAt, 0);
    if (aAt !== bAt) return aAt - bAt;

    const aCount = toFiniteNumber(a[1]?.count, 0);
    const bCount = toFiniteNumber(b[1]?.count, 0);
    return aCount - bCount;
  });

  const toRemove = entries.size - maxEntries;
  for (let i = 0; i < toRemove; i++) {
    const key = ordered[i]?.[0];
    if (typeof key === 'string') entries.delete(key);
  }
}

async function readLegacyStore(namespace: string): Promise<LegacyUsageStoreV1 | null> {
  try {
    const res = await chrome.storage.local.get([namespace]);
    const raw = (res as Record<string, unknown> | undefined)?.[namespace];
    return parseLegacyStore(raw);
  } catch {
    return null;
  }
}

/**
 * Read legacy store for migration purposes - propagates errors instead of swallowing them
 * to prevent marking migration complete when legacy data couldn't be read.
 */
async function readLegacyStoreForMigration(namespace: string): Promise<LegacyUsageStoreV1 | null> {
  const res = await chrome.storage.local.get([namespace]);
  const raw = (res as Record<string, unknown> | undefined)?.[namespace];
  return parseLegacyStore(raw);
}

async function writeLegacyStore(namespace: string, store: LegacyUsageStoreV1): Promise<void> {
  await chrome.storage.local.set({ [namespace]: store });
}

// ============================================================
// IndexedDB Client
// ============================================================

const idb = new IndexedDbClient(DB_NAME, DB_VERSION, (db, oldVersion) => {
  if (oldVersion < 1) {
    const store = db.createObjectStore(STORE, { keyPath: ['namespace', 'key'] });
    // Index for listing recent (by lastUsedAt DESC)
    store.createIndex(IDX_NAMESPACE_LAST_USED_AT, ['namespace', 'lastUsedAt'], { unique: false });
    // Index for eviction (by lastUsedAt ASC, count ASC)
    store.createIndex(IDX_NAMESPACE_LAST_USED_AT_COUNT, ['namespace', 'lastUsedAt', 'count'], {
      unique: false,
    });
  }
});

// ============================================================
// Migration (chrome.storage.local -> IndexedDB)
// ============================================================

const migrationPromises = new Map<string, Promise<void>>();

async function ensureMigrated(namespace: string): Promise<void> {
  const ns = normalizeNamespace(namespace);
  const existing = migrationPromises.get(ns);
  if (existing) return existing;

  const p = (async () => {
    // Check if already migrated
    const meta = await idb.get<UsageMetaRecord>(STORE, [ns, META_KEY]);
    if (meta?.schemaVersion === 1) return;

    // Read legacy data - use error-propagating reader to avoid marking migrated
    // when legacy data couldn't be read
    const legacy = await readLegacyStoreForMigration(ns);
    const migratedAt = safeNow();

    // Build entries map for potential truncation
    const legacyEntries = legacy
      ? new Map<string, LegacyUsageEntry>(Object.entries(legacy.entries))
      : null;

    // Truncate bloated legacy stores to avoid long blocking migrations
    if (legacyEntries && legacyEntries.size > MAX_ENTRIES_HARD_CAP) {
      console.warn(
        `${LOG_PREFIX} Legacy store has ${legacyEntries.size} entries; truncating to ${MAX_ENTRIES_HARD_CAP} before migration.`,
      );
      evictLegacyEntries(legacyEntries, MAX_ENTRIES_HARD_CAP);
    }

    // Migrate to IndexedDB
    await idb.tx<void>(STORE, 'readwrite', (st) => {
      if (legacyEntries) {
        for (const [key, entry] of legacyEntries) {
          const record: UsageEntryRecord = {
            namespace: ns,
            key,
            lastUsedAt: entry.lastUsedAt,
            count: entry.count,
          };
          st.put(record);
        }
      }

      // Write migration marker
      const metaRecord: UsageMetaRecord = {
        namespace: ns,
        key: META_KEY,
        schemaVersion: 1,
        migratedAt,
        legacyUpdatedAt: legacy?.updatedAt ?? 0,
      };
      st.put(metaRecord);
    });
  })();

  migrationPromises.set(ns, p);
  p.catch(() => migrationPromises.delete(ns));
  return p;
}

// ============================================================
// IndexedDB Operations
// ============================================================

async function recordUsageInIdb(namespace: string, key: string, maxEntries: number): Promise<void> {
  const ns = normalizeNamespace(namespace);

  await idb.tx<void>(STORE, 'readwrite', async (st) => {
    const now = safeNow();

    // Read existing entry
    const existing = await idb
      .promisifyRequest<UsageEntryRecord | undefined>(st.get([ns, key]), STORE, `get(${key})`)
      .catch(() => undefined);

    // Defensively clamp existing values to handle corrupted records (NaN/undefined)
    const prevCount = clampInt(existing?.count, 0, 0, MAX_COUNT_HARD_CAP);
    const prevLastUsedAt = Math.max(0, toFiniteNumber(existing?.lastUsedAt, 0));

    const nextCount = Math.min(MAX_COUNT_HARD_CAP, prevCount + 1);
    const nextLastUsedAt = Math.max(now, prevLastUsedAt);

    // Write updated entry
    const updated: UsageEntryRecord = {
      namespace: ns,
      key,
      lastUsedAt: nextLastUsedAt,
      count: nextCount,
    };
    await idb.promisifyRequest(st.put(updated), STORE, `put(${key})`);

    // Count entries (excluding meta)
    const byLastUsedAt = st.index(IDX_NAMESPACE_LAST_USED_AT);
    const countRange = IDBKeyRange.bound([ns, IDB_NUMBER_MIN], [ns, IDB_NUMBER_MAX]);
    const total = await idb.promisifyRequest<number>(
      byLastUsedAt.count(countRange),
      STORE,
      'count(namespace)',
    );

    if (total <= maxEntries) return;

    // Evict oldest/least used entries
    const toRemove = total - maxEntries;
    const evictionIndex = st.index(IDX_NAMESPACE_LAST_USED_AT_COUNT);
    const evictionRange = IDBKeyRange.bound(
      [ns, IDB_NUMBER_MIN, IDB_NUMBER_MIN],
      [ns, IDB_NUMBER_MAX, IDB_NUMBER_MAX],
    );

    await new Promise<void>((resolve, reject) => {
      let removed = 0;
      const req = evictionIndex.openCursor(evictionRange, 'next');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || removed >= toRemove) {
          resolve();
          return;
        }

        // Skip meta record
        const value = cursor.value as UsageEntryRecord | UsageMetaRecord;
        if (value.key === META_KEY) {
          cursor.continue();
          return;
        }

        const delReq = cursor.delete();
        delReq.onerror = () => reject(delReq.error);
        delReq.onsuccess = () => {
          removed++;
          cursor.continue();
        };
      };
    });
  });
}

async function getEntriesInIdb(
  namespace: string,
  keys: string[],
): Promise<QuickPanelUsageEntrySummary[]> {
  const ns = normalizeNamespace(namespace);

  return idb.tx<QuickPanelUsageEntrySummary[]>(STORE, 'readonly', async (st) => {
    const requests = keys.map((k) =>
      idb
        .promisifyRequest<UsageEntryRecord | undefined>(st.get([ns, k]), STORE, `get(${k})`)
        .catch(() => undefined),
    );

    const rows = await Promise.all(requests);

    const out: QuickPanelUsageEntrySummary[] = [];
    for (const row of rows) {
      if (!row || typeof row.key !== 'string' || row.key === META_KEY) continue;
      const lastUsedAt = toFiniteNumber(row.lastUsedAt, 0);
      const count = clampInt(row.count, 0, 0, MAX_COUNT_HARD_CAP);
      if (lastUsedAt <= 0 && count <= 0) continue;
      out.push({ key: row.key, lastUsedAt, count });
    }
    return out;
  });
}

async function listRecentInIdb(
  namespace: string,
  limit: number,
): Promise<QuickPanelUsageEntrySummary[]> {
  const ns = normalizeNamespace(namespace);
  const max = Math.max(0, limit);
  if (max <= 0) return [];

  return idb.tx<QuickPanelUsageEntrySummary[]>(STORE, 'readonly', (st) => {
    const index = st.index(IDX_NAMESPACE_LAST_USED_AT);
    const range = IDBKeyRange.bound([ns, IDB_NUMBER_MIN], [ns, IDB_NUMBER_MAX]);

    return new Promise<QuickPanelUsageEntrySummary[]>((resolve, reject) => {
      const items: QuickPanelUsageEntrySummary[] = [];
      const req = index.openCursor(range, 'prev'); // DESC order

      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || items.length >= max) {
          resolve(items);
          return;
        }

        const value = cursor.value as UsageEntryRecord | UsageMetaRecord;
        // Skip meta record
        if (value.key !== META_KEY && typeof value.key === 'string') {
          // Type narrowing: after excluding META_KEY, this must be UsageEntryRecord
          const entry = value as UsageEntryRecord;
          items.push({
            key: entry.key,
            lastUsedAt: toFiniteNumber(entry.lastUsedAt, 0),
            count: clampInt(entry.count, 0, 0, MAX_COUNT_HARD_CAP),
          });
        }

        cursor.continue();
      };
    });
  });
}

// ============================================================
// Legacy Fallback (chrome.storage.local)
// ============================================================

async function recordUsageInLegacy(
  namespace: string,
  key: string,
  maxEntries: number,
): Promise<void> {
  const ns = normalizeNamespace(namespace);
  const now = safeNow();
  const store = (await readLegacyStore(ns)) ?? { version: 1, updatedAt: 0, entries: {} };

  const entries = new Map<string, LegacyUsageEntry>(Object.entries(store.entries));
  const prev = entries.get(key);
  const nextCount = Math.min(MAX_COUNT_HARD_CAP, (prev?.count ?? 0) + 1);

  entries.set(key, { lastUsedAt: now, count: nextCount });
  evictLegacyEntries(entries, maxEntries);

  const payload: LegacyUsageStoreV1 = {
    version: 1,
    updatedAt: now,
    entries: Object.fromEntries(entries.entries()),
  };

  await writeLegacyStore(ns, payload);
}

async function getEntriesInLegacy(
  namespace: string,
  keys: string[],
): Promise<QuickPanelUsageEntrySummary[]> {
  const ns = normalizeNamespace(namespace);
  const store = await readLegacyStore(ns);
  if (!store) return [];

  const out: QuickPanelUsageEntrySummary[] = [];
  for (const key of keys) {
    const entry = store.entries[key];
    if (!entry) continue;
    out.push({ key, lastUsedAt: entry.lastUsedAt, count: entry.count });
  }
  return out;
}

async function listRecentInLegacy(
  namespace: string,
  limit: number,
): Promise<QuickPanelUsageEntrySummary[]> {
  const ns = normalizeNamespace(namespace);
  const store = await readLegacyStore(ns);
  if (!store) return [];

  const items: QuickPanelUsageEntrySummary[] = [];
  for (const [key, entry] of Object.entries(store.entries)) {
    items.push({ key, lastUsedAt: entry.lastUsedAt, count: entry.count });
  }

  items.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return items.slice(0, Math.max(0, limit));
}

// ============================================================
// Message Handlers
// ============================================================

async function handleUsageRecord(
  message: QuickPanelUsageRecordMessage,
): Promise<QuickPanelUsageRecordResponse> {
  try {
    const ns = normalizeNamespace(message.payload?.namespace);
    const key = String(message.payload?.key ?? '').trim();

    if (!key || !parseUsageKey(key)) {
      return { success: false, error: 'Invalid usage key' };
    }

    const maxEntries = clampInt(
      message.payload?.maxEntries,
      DEFAULT_MAX_ENTRIES,
      1,
      MAX_ENTRIES_HARD_CAP,
    );

    // Ensure migration (best-effort)
    try {
      await ensureMigrated(ns);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Migration failed (will continue):`, err);
    }

    // Try IndexedDB first
    try {
      await recordUsageInIdb(ns, key, maxEntries);
      return { success: true };
    } catch (idbErr) {
      console.warn(`${LOG_PREFIX} IndexedDB write failed, falling back to legacy:`, idbErr);
    }

    // Fallback to legacy storage
    await recordUsageInLegacy(ns, key, maxEntries);
    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error recording usage:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to record usage' };
  }
}

async function handleUsageGetEntries(
  message: QuickPanelUsageGetEntriesMessage,
): Promise<QuickPanelUsageGetEntriesResponse> {
  try {
    const ns = normalizeNamespace(message.payload?.namespace);
    const rawKeys = Array.isArray(message.payload?.keys) ? message.payload.keys : [];
    const keys = [
      ...new Set(
        rawKeys.map((k) => String(k ?? '').trim()).filter((k) => k && parseUsageKey(k) !== null),
      ),
    ].slice(0, 2000); // Limit keys to prevent abuse

    if (keys.length === 0) return { success: true, entries: [] };

    // Ensure migration (best-effort)
    try {
      await ensureMigrated(ns);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Migration failed (will continue):`, err);
    }

    // Try IndexedDB first
    try {
      const entries = await getEntriesInIdb(ns, keys);
      return { success: true, entries };
    } catch (idbErr) {
      console.warn(`${LOG_PREFIX} IndexedDB read failed, falling back to legacy:`, idbErr);
    }

    // Fallback to legacy storage
    const entries = await getEntriesInLegacy(ns, keys);
    return { success: true, entries };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error fetching usage entries:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to fetch usage entries' };
  }
}

async function handleUsageListRecent(
  message: QuickPanelUsageListRecentMessage,
): Promise<QuickPanelUsageListRecentResponse> {
  try {
    const ns = normalizeNamespace(message.payload?.namespace);
    const limit = clampInt(message.payload?.limit, 200, 0, 5000);
    if (limit <= 0) return { success: true, items: [] };

    // Ensure migration (best-effort)
    try {
      await ensureMigrated(ns);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Migration failed (will continue):`, err);
    }

    // Try IndexedDB first
    try {
      const items = await listRecentInIdb(ns, limit);
      return { success: true, items };
    } catch (idbErr) {
      console.warn(`${LOG_PREFIX} IndexedDB read failed, falling back to legacy:`, idbErr);
    }

    // Fallback to legacy storage
    const items = await listRecentInLegacy(ns, limit);
    return { success: true, items };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error listing recent usage:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to list recent usage' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

/**
 * Initialize the Quick Panel usage history message handler.
 * Should be called once during background script setup.
 */
export function initQuickPanelUsageHistoryHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_RECORD) {
      handleUsageRecord(message as QuickPanelUsageRecordMessage).then(sendResponse);
      return true; // Will respond asynchronously
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_GET_ENTRIES) {
      handleUsageGetEntries(message as QuickPanelUsageGetEntriesMessage).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_LIST_RECENT) {
      handleUsageListRecent(message as QuickPanelUsageListRecentMessage).then(sendResponse);
      return true;
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
