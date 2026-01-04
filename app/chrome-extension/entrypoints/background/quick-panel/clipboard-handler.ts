/**
 * Quick Panel Clipboard History Handler
 *
 * Background service worker bridge for Clipboard History (Phase 15.1).
 *
 * Scope:
 * - Records ONLY clipboard writes initiated by Quick Panel actions (best-effort).
 * - Does NOT read clipboard contents proactively.
 *
 * Design:
 * - Uses chrome.storage.local with a versioned schema.
 * - Enforces incognito boundary (no cross-context reads/writes).
 * - Applies storage caps to avoid hitting extension storage limits.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelClipboardDeleteMessage,
  type QuickPanelClipboardDeleteResponse,
  type QuickPanelClipboardGetMessage,
  type QuickPanelClipboardGetResponse,
  type QuickPanelClipboardItemDetail,
  type QuickPanelClipboardItemSummary,
  type QuickPanelClipboardListMessage,
  type QuickPanelClipboardListResponse,
  type QuickPanelClipboardRecordMessage,
  type QuickPanelClipboardRecordResponse,
  type QuickPanelClipboardSetPinnedMessage,
  type QuickPanelClipboardSetPinnedResponse,
} from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelClipboard]';

// ============================================================
// Storage Schema
// ============================================================

const STORAGE_KEY = 'quick_panel_clipboard_v1';
const SCHEMA_VERSION = 1 as const;

// Safety caps (aligned with storage.local practical limits; keep headroom for other features).
const MAX_ITEMS = 200;
const MAX_TOTAL_STORED_BYTES = 3_500_000; // ~3.5MB best-effort budget
const MAX_ITEM_STORED_BYTES = 80_000; // Store up to ~80KB per item
const MAX_ITEM_CHARS_FOR_ENCODING = 200_000; // Avoid huge TextEncoder allocations

const PREVIEW_MAX_LEN = 220;

interface ClipboardItemV1 {
  id: string;
  createdAt: number;
  updatedAt: number;
  incognito: boolean;
  pinned: boolean;
  copyCount: number;

  // Metadata (best-effort)
  source?: string;
  label?: string;
  originUrl?: string;
  originTitle?: string;

  // Content
  preview: string;
  byteLength: number; // original UTF-8 size (best-effort, may be approximate when oversized)
  stored: boolean;
  value: string | null; // null when not stored (e.g. too large)
  storedByteLength: number; // value byte length when stored
}

interface ClipboardStoreV1 {
  version: typeof SCHEMA_VERSION;
  updatedAt: number;
  items: ClipboardItemV1[];
}

// ============================================================
// Helpers
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(toFiniteNumber(value, fallback));
  return Math.max(min, Math.min(max, n));
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function createClipboardId(): string {
  try {
    const id = crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    // Fallback for environments without crypto.randomUUID
  }
  return `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isValidTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function resolveSenderIncognito(sender: chrome.runtime.MessageSender): Promise<boolean> {
  const tabId = sender.tab?.id;
  if (!isValidTabId(tabId)) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.incognito === true;
  } catch {
    return false;
  }
}

function buildPreview(text: string): string {
  const oneLine = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!oneLine) return '';
  if (oneLine.length <= PREVIEW_MAX_LEN) return oneLine;
  return `${oneLine.slice(0, Math.max(0, PREVIEW_MAX_LEN - 1))}\u2026`;
}

function utf8ByteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    // Fallback approximation: JS strings are UTF-16.
    return Math.min(Number.MAX_SAFE_INTEGER, text.length * 2);
  }
}

function estimateStoredBytes(item: ClipboardItemV1): number {
  // Estimate bytes that materially affect storage usage.
  // The exact storage representation is implementation-defined; this is a best-effort guard.
  const meta =
    utf8ByteLength(item.preview) +
    utf8ByteLength(item.source || '') +
    utf8ByteLength(item.label || '') +
    utf8ByteLength(item.originUrl || '') +
    utf8ByteLength(item.originTitle || '');
  return item.storedByteLength + meta + 200; // small fixed overhead per item
}

function parseStore(raw: unknown): ClipboardStoreV1 {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION || !Array.isArray(raw.items)) {
    return { version: SCHEMA_VERSION, updatedAt: 0, items: [] };
  }

  const updatedAt = Math.max(0, toFiniteNumber(raw.updatedAt, 0));
  const seen = new Set<string>();
  const items: ClipboardItemV1[] = [];

  for (const v of raw.items) {
    if (!isRecord(v)) continue;
    const id = normalizeString(v.id).trim();
    if (!id || seen.has(id)) continue;

    const createdAt = Math.max(0, toFiniteNumber(v.createdAt, 0));
    const itemUpdatedAt = Math.max(0, toFiniteNumber(v.updatedAt, 0));
    const incognito = normalizeBoolean(v.incognito);
    const pinned = normalizeBoolean(v.pinned);
    const copyCount = clampInt(v.copyCount, 1, 1, 10_000);

    const preview = buildPreview(normalizeString(v.preview));
    if (!preview) continue;

    const byteLength = Math.max(0, toFiniteNumber(v.byteLength, preview.length));
    const stored = normalizeBoolean(v.stored);
    const valueRaw = stored ? normalizeString(v.value) : '';
    const value = stored && valueRaw ? valueRaw : null;
    const storedByteLength =
      stored && value ? Math.max(0, toFiniteNumber(v.storedByteLength, utf8ByteLength(value))) : 0;

    items.push({
      id,
      createdAt: createdAt || itemUpdatedAt || updatedAt || Date.now(),
      updatedAt: itemUpdatedAt || createdAt || updatedAt || Date.now(),
      incognito,
      pinned,
      copyCount,
      source: normalizeString(v.source).trim() || undefined,
      label: normalizeString(v.label).trim() || undefined,
      originUrl: normalizeString(v.originUrl).trim() || undefined,
      originTitle: normalizeString(v.originTitle).trim() || undefined,
      preview,
      byteLength,
      stored: stored && !!value,
      value,
      storedByteLength,
    });

    seen.add(id);
    if (items.length >= MAX_ITEMS * 2) break; // safety
  }

  // Keep pinned first, then most-recent.
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return b.createdAt - a.createdAt;
  });

  // Clamp size.
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;

  return { version: SCHEMA_VERSION, updatedAt, items };
}

async function readStore(): Promise<ClipboardStoreV1> {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = (res as Record<string, unknown> | undefined)?.[STORAGE_KEY];
    return parseStore(raw);
  } catch {
    return { version: SCHEMA_VERSION, updatedAt: 0, items: [] };
  }
}

async function writeStore(store: ClipboardStoreV1): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

let storeMutex: Promise<void> = Promise.resolve();

async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = storeMutex;
  let release: (() => void) | null = null;
  storeMutex = new Promise<void>((r) => {
    release = r;
  });

  await prev;
  try {
    return await fn();
  } finally {
    try {
      release?.();
    } catch {
      // Best-effort
    }
  }
}

function toSummary(item: ClipboardItemV1): QuickPanelClipboardItemSummary {
  return {
    id: item.id,
    preview: item.preview,
    pinned: item.pinned,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    incognito: item.incognito,
    source: item.source,
    label: item.label,
    originUrl: item.originUrl,
    originTitle: item.originTitle,
    byteLength: item.byteLength,
    stored: item.stored,
    copyCount: item.copyCount,
  };
}

function toDetail(item: ClipboardItemV1): QuickPanelClipboardItemDetail {
  return { ...toSummary(item), value: item.value };
}

function matchesQuery(item: ClipboardItemV1, queryLower: string): boolean {
  if (!queryLower) return true;

  const hay = [
    item.preview,
    item.source || '',
    item.label || '',
    item.originUrl || '',
    item.originTitle || '',
    item.value || '',
  ]
    .join(' ')
    .toLowerCase();

  return hay.includes(queryLower);
}

function enforceCaps(items: ClipboardItemV1[]): void {
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;

  // Evict oldest unpinned first until within byte budget.
  let total = items.reduce((sum, it) => sum + estimateStoredBytes(it), 0);
  if (total <= MAX_TOTAL_STORED_BYTES) return;

  for (let i = items.length - 1; i >= 0 && total > MAX_TOTAL_STORED_BYTES; i--) {
    if (items[i]?.pinned) continue;
    total -= estimateStoredBytes(items[i]);
    items.splice(i, 1);
  }

  // If still above budget (e.g., too many pinned or large items), evict from the end.
  for (let i = items.length - 1; i >= 0 && total > MAX_TOTAL_STORED_BYTES; i--) {
    total -= estimateStoredBytes(items[i]);
    items.splice(i, 1);
  }
}

function buildStoredValue(text: string): {
  stored: boolean;
  value: string | null;
  byteLength: number;
  storedByteLength: number;
} {
  const raw = String(text ?? '');

  if (!raw.trim()) {
    return { stored: false, value: null, byteLength: 0, storedByteLength: 0 };
  }

  // Avoid allocating very large buffers for obviously large values.
  if (raw.length > MAX_ITEM_CHARS_FOR_ENCODING) {
    return {
      stored: false,
      value: null,
      byteLength: raw.length, // best-effort
      storedByteLength: 0,
    };
  }

  const bytes = utf8ByteLength(raw);
  if (bytes > MAX_ITEM_STORED_BYTES) {
    return { stored: false, value: null, byteLength: bytes, storedByteLength: 0 };
  }

  return { stored: true, value: raw, byteLength: bytes, storedByteLength: bytes };
}

// ============================================================
// Handlers
// ============================================================

async function handleRecord(
  message: QuickPanelClipboardRecordMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelClipboardRecordResponse> {
  try {
    const text = normalizeString(message.payload?.text);
    if (!text.trim()) return { success: false, error: 'Invalid text' };

    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    return await withStoreLock(async () => {
      const store = await readStore();

      const source = normalizeString(message.payload?.source).trim() || undefined;
      const label = normalizeString(message.payload?.label).trim() || undefined;
      const originUrl = normalizeString(message.payload?.originUrl).trim() || undefined;
      const originTitle = normalizeString(message.payload?.originTitle).trim() || undefined;

      const preview = buildPreview(text);
      const built = buildStoredValue(text);

      // Dedupe only when full value is stored.
      if (built.stored && built.value) {
        const existing = store.items.find(
          (it) => it.incognito === incognito && it.stored === true && it.value === built.value,
        );
        if (existing) {
          existing.updatedAt = now;
          existing.copyCount = clampInt(existing.copyCount + 1, 1, 1, 10_000);
          existing.preview = preview;
          existing.byteLength = built.byteLength;
          existing.storedByteLength = built.storedByteLength;
          existing.source = source ?? existing.source;
          existing.label = label ?? existing.label;
          existing.originUrl = originUrl ?? existing.originUrl;
          existing.originTitle = originTitle ?? existing.originTitle;
        } else {
          store.items.unshift({
            id: createClipboardId(),
            createdAt: now,
            updatedAt: now,
            incognito,
            pinned: false,
            copyCount: 1,
            source,
            label,
            originUrl,
            originTitle,
            preview,
            byteLength: built.byteLength,
            stored: true,
            value: built.value,
            storedByteLength: built.storedByteLength,
          });
        }
      } else {
        // Record metadata + preview even when full value cannot be stored.
        store.items.unshift({
          id: createClipboardId(),
          createdAt: now,
          updatedAt: now,
          incognito,
          pinned: false,
          copyCount: 1,
          source,
          label,
          originUrl,
          originTitle,
          preview,
          byteLength: built.byteLength || utf8ByteLength(preview),
          stored: false,
          value: null,
          storedByteLength: 0,
        });
      }

      // Normalize ordering + caps.
      store.items.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
        return b.createdAt - a.createdAt;
      });

      enforceCaps(store.items);

      store.updatedAt = now;
      await writeStore(store);

      return { success: true };
    });
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to record clipboard entry' };
  }
}

async function handleList(
  message: QuickPanelClipboardListMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelClipboardListResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const rawQuery = normalizeString(message.payload?.query).trim().toLowerCase();
    const maxResults = clampInt(message.payload?.maxResults, 50, 1, 200);

    const store = await readStore();
    const items = store.items
      .filter((it) => it.incognito === incognito)
      .filter((it) => matchesQuery(it, rawQuery))
      .slice(0, maxResults)
      .map(toSummary);

    return { success: true, items };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to list clipboard history' };
  }
}

async function handleGet(
  message: QuickPanelClipboardGetMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelClipboardGetResponse> {
  try {
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const incognito = await resolveSenderIncognito(sender);
    const store = await readStore();
    const item = store.items.find((it) => it.id === id && it.incognito === incognito);
    if (!item) return { success: false, error: 'Clipboard item not found' };

    return { success: true, item: toDetail(item) };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to get clipboard item' };
  }
}

async function handleSetPinned(
  message: QuickPanelClipboardSetPinnedMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelClipboardSetPinnedResponse> {
  try {
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const pinned = normalizeBoolean(message.payload?.pinned);
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    return await withStoreLock(async () => {
      const store = await readStore();
      const item = store.items.find((it) => it.id === id && it.incognito === incognito);
      if (!item) return { success: false, error: 'Clipboard item not found' };

      item.pinned = pinned;
      item.updatedAt = now;

      store.items.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
        return b.createdAt - a.createdAt;
      });

      store.updatedAt = now;
      await writeStore(store);
      return { success: true };
    });
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to update pin state' };
  }
}

async function handleDelete(
  message: QuickPanelClipboardDeleteMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelClipboardDeleteResponse> {
  try {
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    return await withStoreLock(async () => {
      const store = await readStore();
      const before = store.items.length;
      store.items = store.items.filter((it) => !(it.id === id && it.incognito === incognito));
      if (store.items.length === before)
        return { success: false, error: 'Clipboard item not found' };

      store.updatedAt = now;
      await writeStore(store);
      return { success: true };
    });
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to delete clipboard item' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

export function initQuickPanelClipboardHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_RECORD) {
      handleRecord(message as QuickPanelClipboardRecordMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_LIST) {
      handleList(message as QuickPanelClipboardListMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_GET) {
      handleGet(message as QuickPanelClipboardGetMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_SET_PINNED) {
      handleSetPinned(message as QuickPanelClipboardSetPinnedMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_DELETE) {
      handleDelete(message as QuickPanelClipboardDeleteMessage, sender).then(sendResponse);
      return true;
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
