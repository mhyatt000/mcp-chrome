/**
 * Quick Panel Notes Handler
 *
 * Background service worker bridge for Quick Notes (Phase 15.2).
 *
 * Design:
 * - Uses chrome.storage.local with a versioned schema.
 * - Enforces incognito boundary (no cross-context reads/writes).
 * - Provides list/get/create/delete operations.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelNoteDetail,
  type QuickPanelNoteSummary,
  type QuickPanelNotesCreateMessage,
  type QuickPanelNotesCreateResponse,
  type QuickPanelNotesDeleteMessage,
  type QuickPanelNotesDeleteResponse,
  type QuickPanelNotesGetMessage,
  type QuickPanelNotesGetResponse,
  type QuickPanelNotesListMessage,
  type QuickPanelNotesListResponse,
} from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelNotes]';

// ============================================================
// Storage Schema
// ============================================================

const STORAGE_KEY = 'quick_panel_notes_v1';
const SCHEMA_VERSION = 1 as const;

// Keep caps conservative to reduce risk of hitting storage.local limits.
const MAX_NOTES = 500;
const MAX_NOTE_BYTES = 50_000; // ~50KB per note

const PREVIEW_MAX_LEN = 240;

interface NoteV1 {
  id: string;
  title: string;
  content: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  incognito: boolean;
}

interface NotesStoreV1 {
  version: typeof SCHEMA_VERSION;
  updatedAt: number;
  items: NoteV1[];
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

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(toFiniteNumber(value, fallback));
  return Math.max(min, Math.min(max, n));
}

function utf8ByteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return Math.min(Number.MAX_SAFE_INTEGER, text.length * 2);
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

function createNoteId(): string {
  try {
    const id = crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    // ignore
  }
  return `note_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

function normalizeTitle(value: unknown, fallbackFromContent: string, now: number): string {
  const raw = normalizeString(value).trim().replace(/\s+/g, ' ');
  if (raw) return raw.slice(0, 80);

  const fromContent = buildPreview(fallbackFromContent);
  if (fromContent) return fromContent.slice(0, 80);

  const d = new Date(now);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `Note ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toSummary(note: NoteV1): QuickPanelNoteSummary {
  return {
    id: note.id,
    title: note.title,
    preview: note.preview,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    incognito: note.incognito,
  };
}

function toDetail(note: NoteV1): QuickPanelNoteDetail {
  return { ...toSummary(note), content: note.content };
}

function parseStore(raw: unknown): NotesStoreV1 {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION || !Array.isArray(raw.items)) {
    return { version: SCHEMA_VERSION, updatedAt: 0, items: [] };
  }

  const updatedAt = Math.max(0, toFiniteNumber(raw.updatedAt, 0));
  const items: NoteV1[] = [];
  const seen = new Set<string>();

  for (const v of raw.items) {
    if (!isRecord(v)) continue;
    const id = normalizeString(v.id).trim();
    if (!id || seen.has(id)) continue;

    const title = normalizeString(v.title).trim();
    const content = normalizeString(v.content);
    const preview = buildPreview(normalizeString(v.preview) || content || title);
    if (!title || !preview) continue;

    const createdAt = Math.max(0, toFiniteNumber(v.createdAt, 0));
    const itemUpdatedAt = Math.max(0, toFiniteNumber(v.updatedAt, 0));
    const incognito = v.incognito === true;

    items.push({
      id,
      title: title.slice(0, 80),
      content,
      preview,
      createdAt: createdAt || itemUpdatedAt || updatedAt || Date.now(),
      updatedAt: itemUpdatedAt || createdAt || updatedAt || Date.now(),
      incognito,
    });

    seen.add(id);
    if (items.length >= MAX_NOTES * 2) break;
  }

  items.sort((a, b) => b.updatedAt - a.updatedAt);
  if (items.length > MAX_NOTES) items.length = MAX_NOTES;

  return { version: SCHEMA_VERSION, updatedAt, items };
}

async function readStore(): Promise<NotesStoreV1> {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = (res as Record<string, unknown> | undefined)?.[STORAGE_KEY];
    return parseStore(raw);
  } catch {
    return { version: SCHEMA_VERSION, updatedAt: 0, items: [] };
  }
}

async function writeStore(store: NotesStoreV1): Promise<void> {
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

function matchesQuery(note: NoteV1, queryLower: string): boolean {
  if (!queryLower) return true;
  const hay = `${note.title} ${note.preview} ${note.content}`.toLowerCase();
  return hay.includes(queryLower);
}

// ============================================================
// Handlers
// ============================================================

async function handleList(
  message: QuickPanelNotesListMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelNotesListResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const rawQuery = normalizeString(message.payload?.query).trim().toLowerCase();
    const maxResults = clampInt(message.payload?.maxResults, 50, 1, 200);

    const store = await readStore();
    const items = store.items
      .filter((n) => n.incognito === incognito)
      .filter((n) => matchesQuery(n, rawQuery))
      .slice(0, maxResults)
      .map(toSummary);

    return { success: true, items };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to list notes' };
  }
}

async function handleGet(
  message: QuickPanelNotesGetMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelNotesGetResponse> {
  try {
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const incognito = await resolveSenderIncognito(sender);
    const store = await readStore();
    const note = store.items.find((n) => n.id === id && n.incognito === incognito);
    if (!note) return { success: false, error: 'Note not found' };

    return { success: true, note: toDetail(note) };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to get note' };
  }
}

async function handleCreate(
  message: QuickPanelNotesCreateMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelNotesCreateResponse> {
  try {
    const content = normalizeString(message.payload?.content);
    if (!content.trim()) return { success: false, error: 'Invalid content' };

    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    const bytes = utf8ByteLength(content);
    if (bytes > MAX_NOTE_BYTES) {
      return { success: false, error: `Note is too large (${bytes} bytes).` };
    }

    const title = normalizeTitle(message.payload?.title, content, now);
    const preview = buildPreview(content);

    return await withStoreLock(async () => {
      const store = await readStore();

      const note: NoteV1 = {
        id: createNoteId(),
        title,
        content,
        preview,
        createdAt: now,
        updatedAt: now,
        incognito,
      };

      store.items.unshift(note);
      store.items.sort((a, b) => b.updatedAt - a.updatedAt);
      if (store.items.length > MAX_NOTES) store.items.length = MAX_NOTES;
      store.updatedAt = now;
      await writeStore(store);

      return { success: true, note: toSummary(note) };
    });
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to create note' };
  }
}

async function handleDelete(
  message: QuickPanelNotesDeleteMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelNotesDeleteResponse> {
  try {
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    return await withStoreLock(async () => {
      const store = await readStore();
      const before = store.items.length;
      store.items = store.items.filter((n) => !(n.id === id && n.incognito === incognito));
      if (store.items.length === before) return { success: false, error: 'Note not found' };

      store.updatedAt = now;
      await writeStore(store);
      return { success: true };
    });
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to delete note' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

export function initQuickPanelNotesHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_LIST) {
      handleList(message as QuickPanelNotesListMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_GET) {
      handleGet(message as QuickPanelNotesGetMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_CREATE) {
      handleCreate(message as QuickPanelNotesCreateMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_DELETE) {
      handleDelete(message as QuickPanelNotesDeleteMessage, sender).then(sendResponse);
      return true;
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
