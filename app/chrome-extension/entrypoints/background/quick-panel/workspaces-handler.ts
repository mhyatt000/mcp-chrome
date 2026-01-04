/**
 * Quick Panel Workspaces Handler
 *
 * Background service worker bridge for WorkspacesProvider.
 *
 * Features:
 * - Save current window tabs as a named snapshot (workspace)
 * - List saved snapshots (scoped to incognito boundary)
 * - Open a snapshot in current window or a new window
 * - Delete a snapshot
 *
 * Design principles:
 * - Local-only storage (`chrome.storage.local`) with a versioned schema
 * - Incognito boundary enforced (no cross-context restore)
 * - Best-effort operations with safety caps to avoid runaway tab creation
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelWorkspaceSummary,
  type QuickPanelWorkspacesDeleteMessage,
  type QuickPanelWorkspacesDeleteResponse,
  type QuickPanelWorkspacesListMessage,
  type QuickPanelWorkspacesListResponse,
  type QuickPanelWorkspacesOpenMessage,
  type QuickPanelWorkspacesOpenResponse,
  type QuickPanelWorkspacesOpenTarget,
  type QuickPanelWorkspacesSaveMessage,
  type QuickPanelWorkspacesSaveResponse,
} from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelWorkspaces]';

// ============================================================
// Storage Schema
// ============================================================

const STORAGE_KEY = 'quick_panel_workspaces_v1';
const SCHEMA_VERSION = 1 as const;

/** Keep workspaces bounded to avoid unbounded growth. */
const MAX_WORKSPACES = 200;
/** Safety cap to avoid opening/saving extremely large sessions. */
const MAX_TABS_PER_WORKSPACE = 200;

interface WorkspaceTabV1 {
  url: string;
  title: string;
  pinned: boolean;
}

interface WorkspaceSnapshotV1 {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  incognito: boolean;
  activeIndex: number;
  tabs: WorkspaceTabV1[];
}

interface WorkspaceStoreV1 {
  version: typeof SCHEMA_VERSION;
  updatedAt: number;
  items: WorkspaceSnapshotV1[];
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

function createWorkspaceId(): string {
  try {
    const id = crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    // Fallback for environments without crypto.randomUUID
  }
  return `ws_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function defaultWorkspaceName(now: number): string {
  const d = new Date(now);
  return `Session ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function normalizeWorkspaceName(value: unknown, now: number): string {
  const raw = normalizeString(value).trim().replace(/\s+/g, ' ');
  const name = raw || defaultWorkspaceName(now);
  return name.slice(0, 80);
}

function isAllowedWorkspaceUrl(url: string): boolean {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return false;

  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:';
  } catch {
    // Best-effort: reject obvious dangerous schemes.
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('javascript:')) return false;
    if (lower.startsWith('data:')) return false;
    return false;
  }
}

function toSummary(snapshot: WorkspaceSnapshotV1): QuickPanelWorkspaceSummary {
  return {
    id: snapshot.id,
    name: snapshot.name,
    tabCount: snapshot.tabs.length,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    incognito: snapshot.incognito,
  };
}

function parseStore(raw: unknown): WorkspaceStoreV1 {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION || !Array.isArray(raw.items)) {
    return { version: SCHEMA_VERSION, updatedAt: 0, items: [] };
  }

  const updatedAt = Math.max(0, toFiniteNumber(raw.updatedAt, 0));

  const seenIds = new Set<string>();
  const items: WorkspaceSnapshotV1[] = [];

  for (const v of raw.items) {
    if (!isRecord(v)) continue;

    const id = normalizeString(v.id).trim();
    if (!id || seenIds.has(id)) continue;

    const name = normalizeString(v.name).trim().replace(/\s+/g, ' ');
    if (!name) continue;

    const createdAt = Math.max(0, toFiniteNumber(v.createdAt, 0));
    const itemUpdatedAt = Math.max(0, toFiniteNumber(v.updatedAt, 0));
    const incognito = normalizeBoolean(v.incognito);

    const tabsRaw = Array.isArray(v.tabs) ? v.tabs : [];
    const tabs: WorkspaceTabV1[] = [];

    for (const t of tabsRaw) {
      if (!isRecord(t)) continue;
      const url = normalizeString(t.url).trim();
      if (!isAllowedWorkspaceUrl(url)) continue;

      const title = normalizeString(t.title).trim();
      const pinned = normalizeBoolean(t.pinned);

      tabs.push({ url, title, pinned });
      if (tabs.length >= MAX_TABS_PER_WORKSPACE) break;
    }

    if (tabs.length === 0) continue;

    const activeIndex = clampInt(v.activeIndex, 0, 0, Math.max(0, tabs.length - 1));

    seenIds.add(id);
    items.push({
      id,
      name: name.slice(0, 80),
      createdAt: createdAt || itemUpdatedAt || updatedAt || Date.now(),
      updatedAt: itemUpdatedAt || createdAt || updatedAt || Date.now(),
      incognito,
      activeIndex,
      tabs,
    });
  }

  // Sort by updatedAt desc and clamp
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  if (items.length > MAX_WORKSPACES) {
    items.length = MAX_WORKSPACES;
  }

  return { version: SCHEMA_VERSION, updatedAt, items };
}

async function readStore(): Promise<WorkspaceStoreV1> {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = (res as Record<string, unknown> | undefined)?.[STORAGE_KEY];
    return parseStore(raw);
  } catch {
    return { version: SCHEMA_VERSION, updatedAt: 0, items: [] };
  }
}

async function writeStore(store: WorkspaceStoreV1): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      version: store.version,
      updatedAt: store.updatedAt,
      items: store.items,
    },
  });
}

let writeLock: Promise<void> = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release: (() => void) | null = null;
  writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release?.();
  }
}

function isValidTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isValidWindowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeOpenTarget(value: unknown): QuickPanelWorkspacesOpenTarget {
  return value === 'current_window' || value === 'new_window' ? value : 'new_window';
}

// ============================================================
// Message Handlers
// ============================================================

async function handleList(
  message: QuickPanelWorkspacesListMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelWorkspacesListResponse> {
  try {
    if (!sender.tab?.id) {
      return { success: false, error: 'Quick Panel request must originate from a tab.' };
    }

    const incognito = normalizeBoolean(sender.tab.incognito);
    const query = normalizeString(message.payload?.query).trim().toLowerCase();
    const maxResults = clampInt(message.payload?.maxResults, 50, 0, MAX_WORKSPACES);

    const store = await readStore();
    let items = store.items.filter((w) => w.incognito === incognito);

    if (query) {
      items = items.filter((w) => w.name.toLowerCase().includes(query));
    }

    items.sort((a, b) => b.updatedAt - a.updatedAt);
    if (items.length > maxResults) items = items.slice(0, maxResults);

    return { success: true, items: items.map(toSummary) };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error listing workspaces:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to list workspaces' };
  }
}

async function handleSave(
  message: QuickPanelWorkspacesSaveMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelWorkspacesSaveResponse> {
  try {
    const senderTabId = sender.tab?.id;
    const senderWindowId = sender.tab?.windowId;

    if (!isValidTabId(senderTabId) || !isValidWindowId(senderWindowId)) {
      return { success: false, error: 'Quick Panel request must originate from a tab/window.' };
    }

    const now = Date.now();
    const incognito = normalizeBoolean(sender.tab?.incognito);
    const name = normalizeWorkspaceName(message.payload?.name, now);

    const tabs = await chrome.tabs.query({ windowId: senderWindowId });

    const savedTabs: WorkspaceTabV1[] = [];
    let activeIndex = 0;

    for (const t of Array.isArray(tabs) ? tabs : []) {
      const url = normalizeString(t.url).trim();
      if (!isAllowedWorkspaceUrl(url)) continue;

      const title = normalizeString(t.title).trim();
      const pinned = normalizeBoolean(t.pinned);
      const active = normalizeBoolean(t.active);

      if (active) {
        activeIndex = savedTabs.length;
      }

      savedTabs.push({ url, title, pinned });
      if (savedTabs.length >= MAX_TABS_PER_WORKSPACE) break;
    }

    if (savedTabs.length === 0) {
      return { success: false, error: 'No savable tabs found in the current window.' };
    }

    const normalizedNameKey = name.toLowerCase();

    const saved = await withWriteLock(async () => {
      const store = await readStore();

      // Update existing snapshot with the same name (within incognito boundary), otherwise create a new one.
      const existingIdx = store.items.findIndex(
        (w) => w.incognito === incognito && w.name.toLowerCase() === normalizedNameKey,
      );

      let snapshot: WorkspaceSnapshotV1;
      if (existingIdx >= 0) {
        const existing = store.items[existingIdx]!;
        snapshot = {
          ...existing,
          name,
          updatedAt: now,
          tabs: savedTabs,
          activeIndex: clampInt(activeIndex, 0, 0, savedTabs.length - 1),
        };
        store.items.splice(existingIdx, 1);
      } else {
        snapshot = {
          id: createWorkspaceId(),
          name,
          createdAt: now,
          updatedAt: now,
          incognito,
          activeIndex: clampInt(activeIndex, 0, 0, savedTabs.length - 1),
          tabs: savedTabs,
        };
      }

      store.updatedAt = now;
      store.items.unshift(snapshot);

      // Clamp store size by evicting oldest.
      store.items.sort((a, b) => b.updatedAt - a.updatedAt);
      if (store.items.length > MAX_WORKSPACES) {
        store.items.length = MAX_WORKSPACES;
      }

      await writeStore(store);
      return snapshot;
    });

    return { success: true, workspace: toSummary(saved) };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error saving workspace:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to save workspace' };
  }
}

async function handleDelete(
  message: QuickPanelWorkspacesDeleteMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelWorkspacesDeleteResponse> {
  try {
    if (!sender.tab?.id) {
      return { success: false, error: 'Quick Panel request must originate from a tab.' };
    }

    const incognito = normalizeBoolean(sender.tab.incognito);
    const workspaceId = normalizeString(message.payload?.workspaceId).trim();
    if (!workspaceId) {
      return { success: false, error: 'Invalid workspaceId' };
    }

    const removed = await withWriteLock(async () => {
      const store = await readStore();
      const before = store.items.length;
      store.items = store.items.filter((w) => !(w.incognito === incognito && w.id === workspaceId));
      if (store.items.length === before) return false;

      store.updatedAt = Date.now();
      await writeStore(store);
      return true;
    });

    return removed ? { success: true } : { success: false, error: 'Workspace not found' };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error deleting workspace:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to delete workspace' };
  }
}

async function openTabsInWindow(options: {
  windowId: number;
  tabs: WorkspaceTabV1[];
  activeIndex: number;
}): Promise<{ openedCount: number; totalCount: number }> {
  const totalCount = options.tabs.length;
  let openedCount = 0;
  const createdIds: number[] = [];

  for (let i = 0; i < options.tabs.length; i++) {
    const t = options.tabs[i]!;
    try {
      const created = await chrome.tabs.create({
        windowId: options.windowId,
        url: t.url,
        active: false,
        pinned: t.pinned,
      });
      if (isValidTabId(created.id)) {
        createdIds[i] = created.id;
      }
      openedCount += 1;
    } catch {
      // Best-effort: skip failed URLs.
    }
  }

  const idx = clampInt(options.activeIndex, 0, 0, Math.max(0, options.tabs.length - 1));
  const toActivate = createdIds[idx];
  if (isValidTabId(toActivate)) {
    try {
      await chrome.tabs.update(toActivate, { active: true });
    } catch {
      // Best-effort
    }
  }

  return { openedCount, totalCount };
}

async function handleOpen(
  message: QuickPanelWorkspacesOpenMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelWorkspacesOpenResponse> {
  try {
    const senderTabId = sender.tab?.id;
    const senderWindowId = sender.tab?.windowId;

    if (!isValidTabId(senderTabId) || !isValidWindowId(senderWindowId)) {
      return { success: false, error: 'Quick Panel request must originate from a tab/window.' };
    }

    const incognito = normalizeBoolean(sender.tab?.incognito);
    const workspaceId = normalizeString(message.payload?.workspaceId).trim();
    const target = normalizeOpenTarget(message.payload?.target);

    if (!workspaceId) {
      return { success: false, error: 'Invalid workspaceId' };
    }

    const store = await readStore();
    const snapshot = store.items.find((w) => w.id === workspaceId && w.incognito === incognito);
    if (!snapshot) {
      return { success: false, error: 'Workspace not found (or incognito boundary mismatch)' };
    }

    const tabs = snapshot.tabs.slice(0, MAX_TABS_PER_WORKSPACE);
    if (tabs.length === 0) {
      return { success: false, error: 'Workspace has no tabs' };
    }

    if (target === 'current_window') {
      const res = await openTabsInWindow({
        windowId: senderWindowId,
        tabs,
        activeIndex: snapshot.activeIndex,
      });
      return { success: true, openedCount: res.openedCount, totalCount: res.totalCount };
    }

    // new_window
    const firstUrl = tabs[0]?.url;
    if (!firstUrl) {
      return { success: false, error: 'Workspace has no openable tabs' };
    }

    const createdWindow = await chrome.windows.create({
      url: firstUrl,
      focused: true,
      incognito,
    });

    const windowId = createdWindow?.id;
    if (!isValidWindowId(windowId)) {
      return { success: false, error: 'Failed to create target window' };
    }

    // For the rest tabs, open them in the created window.
    const rest = tabs.slice(1);
    const res = await openTabsInWindow({
      windowId,
      tabs: rest,
      activeIndex: Math.max(0, snapshot.activeIndex - 1),
    });

    // Account for the first tab created with the window.
    const totalCount = tabs.length;
    const openedCount = 1 + res.openedCount;

    // Best-effort: pin the first tab if needed and activate correct tab if activeIndex is 0.
    try {
      const firstTabId = createdWindow.tabs?.[0]?.id;
      if (isValidTabId(firstTabId) && tabs[0]?.pinned) {
        await chrome.tabs.update(firstTabId, { pinned: true });
      }
      if (isValidTabId(firstTabId) && snapshot.activeIndex === 0) {
        await chrome.tabs.update(firstTabId, { active: true });
      }
    } catch {
      // Best-effort
    }

    return { success: true, openedCount, totalCount, windowId };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error opening workspace:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to open workspace' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

export function initQuickPanelWorkspacesHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_LIST) {
      handleList(message as QuickPanelWorkspacesListMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_SAVE) {
      handleSave(message as QuickPanelWorkspacesSaveMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_OPEN) {
      handleOpen(message as QuickPanelWorkspacesOpenMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_DELETE) {
      handleDelete(message as QuickPanelWorkspacesDeleteMessage, sender).then(sendResponse);
      return true;
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
