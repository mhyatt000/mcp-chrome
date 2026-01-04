/**
 * Quick Panel Web Monitor / Price Track Handler (optional)
 *
 * Background bridge that manages periodic checks for a (url, selector) target.
 *
 * Design:
 * - Uses chrome.storage.local with a versioned schema.
 * - Uses chrome.alarms (periodInMinutes) to schedule checks per monitor.
 * - Uses an offscreen document to run fetch + DOMParser extraction.
 * - Enforces incognito boundary (no cross-context list/read/write).
 * - Surfaces changes as stored alerts (no notifications permission).
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  MessageTarget,
  OFFSCREEN_MESSAGE_TYPES,
  type QuickPanelMonitorAlert,
  type QuickPanelMonitorAlertDeleteMessage,
  type QuickPanelMonitorAlertDeleteResponse,
  type QuickPanelMonitorAlertMarkReadMessage,
  type QuickPanelMonitorAlertMarkReadResponse,
  type QuickPanelMonitorCreateMessage,
  type QuickPanelMonitorCreateResponse,
  type QuickPanelMonitorExtractorKind,
  type QuickPanelMonitorCheckNowMessage,
  type QuickPanelMonitorCheckNowResponse,
  type QuickPanelMonitorDeleteMessage,
  type QuickPanelMonitorDeleteResponse,
  type QuickPanelMonitorListMessage,
  type QuickPanelMonitorListResponse,
  type QuickPanelMonitorSetEnabledMessage,
  type QuickPanelMonitorSetEnabledResponse,
  type QuickPanelMonitorSummary,
} from '@/common/message-types';
import { offscreenManager } from '@/utils/offscreen-manager';

const LOG_PREFIX = '[QuickPanelMonitor]';

// ============================================================
// Storage Schema
// ============================================================

const STORAGE_KEY = 'quick_panel_monitor_v1';
const SCHEMA_VERSION = 1 as const;

const MAX_MONITORS = 120;
const MAX_ALERTS = 600;

const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60; // 7 days guardrail

const MAX_URL_LEN = 2000;
const MAX_SELECTOR_LEN = 500;
const MAX_VALUE_LEN = 50_000;
const PREVIEW_MAX_LEN = 220;

interface MonitorV1 {
  id: string;
  url: string;
  extractor: QuickPanelMonitorExtractorKind;
  selector: string;
  attribute?: string;
  intervalMinutes: number;
  enabled: boolean;
  incognito: boolean;
  createdAt: number;
  updatedAt: number;

  lastCheckedAt: number;
  lastChangedAt: number;
  lastValue: string | null;
  lastError: string | null;
}

interface AlertV1 {
  id: string;
  monitorId: string;
  incognito: boolean;
  createdAt: number;
  url: string;
  selector: string;
  oldValue: string | null;
  newValue: string | null;
  read: boolean;
}

interface MonitorStoreV1 {
  version: typeof SCHEMA_VERSION;
  updatedAt: number;
  monitors: MonitorV1[];
  alerts: AlertV1[];
}

function createEmptyStore(now: number): MonitorStoreV1 {
  return { version: SCHEMA_VERSION, updatedAt: now, monitors: [], alerts: [] };
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

function createId(prefix: string): string {
  try {
    const id = crypto?.randomUUID?.();
    if (id) return `${prefix}_${id}`;
  } catch {
    // ignore
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeUrl(input: unknown): string {
  const raw = normalizeString(input).trim();
  if (!raw) throw new Error('url is required');
  if (raw.length > MAX_URL_LEN) throw new Error('url is too long');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Allow hostname without scheme.
    url = new URL(`https://${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported');
  }

  url.hash = '';
  return url.toString();
}

function normalizeSelector(input: unknown): string {
  const selector = normalizeString(input).trim();
  if (!selector) throw new Error('selector is required');
  if (selector.length > MAX_SELECTOR_LEN) throw new Error('selector is too long');
  return selector;
}

function normalizeExtractor(input: unknown): QuickPanelMonitorExtractorKind {
  return input === 'selector_attr' ? 'selector_attr' : 'selector_text';
}

function normalizeAttribute(input: unknown): string | undefined {
  const attr = normalizeString(input).trim();
  if (!attr) return undefined;
  if (attr.length > 100) throw new Error('attribute is too long');
  return attr;
}

function normalizeIntervalMinutes(input: unknown): number {
  return clampInt(input, 15, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
}

function collapseWhitespace(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPreview(text: string): string {
  const oneLine = collapseWhitespace(text);
  if (!oneLine) return '';
  if (oneLine.length <= PREVIEW_MAX_LEN) return oneLine;
  return `${oneLine.slice(0, Math.max(0, PREVIEW_MAX_LEN - 1))}\u2026`;
}

function parseStore(raw: unknown, now: number): MonitorStoreV1 {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION) return createEmptyStore(now);
  const updatedAt = Math.max(0, toFiniteNumber(raw.updatedAt, now));

  const monitors: MonitorV1[] = [];
  const alerts: AlertV1[] = [];

  const rawMonitors = Array.isArray(raw.monitors) ? raw.monitors : [];
  const seenMonitors = new Set<string>();
  for (const m of rawMonitors) {
    if (!isRecord(m)) continue;
    const id = normalizeString(m.id).trim();
    if (!id || seenMonitors.has(id)) continue;

    const url = normalizeString(m.url).trim();
    const selector = normalizeString(m.selector).trim();
    if (!url || !selector) continue;

    const extractor = normalizeExtractor(m.extractor);
    const attributeRaw = normalizeString(m.attribute).trim();
    const attribute = attributeRaw && attributeRaw.length <= 100 ? attributeRaw : undefined;
    if (extractor === 'selector_attr' && !attribute) continue;
    const intervalMinutes = normalizeIntervalMinutes(m.intervalMinutes);
    const enabled = normalizeBoolean(m.enabled);
    const incognito = normalizeBoolean(m.incognito);

    const createdAt = Math.max(0, toFiniteNumber(m.createdAt, 0)) || updatedAt || now;
    const itemUpdatedAt = Math.max(0, toFiniteNumber(m.updatedAt, 0)) || createdAt;
    const lastCheckedAt = Math.max(0, toFiniteNumber(m.lastCheckedAt, 0));
    const lastChangedAt = Math.max(0, toFiniteNumber(m.lastChangedAt, 0));

    const lastValueRaw = normalizeString(m.lastValue);
    const lastValue = lastValueRaw ? lastValueRaw.slice(0, MAX_VALUE_LEN) : null;
    const lastErrorRaw = normalizeString(m.lastError);
    const lastError = lastErrorRaw ? lastErrorRaw.slice(0, 500) : null;

    monitors.push({
      id,
      url,
      extractor,
      selector,
      attribute,
      intervalMinutes,
      enabled,
      incognito,
      createdAt,
      updatedAt: itemUpdatedAt,
      lastCheckedAt,
      lastChangedAt,
      lastValue,
      lastError,
    });

    seenMonitors.add(id);
    if (monitors.length >= MAX_MONITORS * 2) break;
  }

  const rawAlerts = Array.isArray(raw.alerts) ? raw.alerts : [];
  const seenAlerts = new Set<string>();
  for (const a of rawAlerts) {
    if (!isRecord(a)) continue;
    const id = normalizeString(a.id).trim();
    if (!id || seenAlerts.has(id)) continue;

    const monitorId = normalizeString(a.monitorId).trim();
    const url = normalizeString(a.url).trim();
    const selector = normalizeString(a.selector).trim();
    if (!monitorId || !url || !selector) continue;

    const incognito = normalizeBoolean(a.incognito);
    const createdAt = Math.max(0, toFiniteNumber(a.createdAt, 0)) || updatedAt || now;

    const oldValue = normalizeString(a.oldValue).slice(0, MAX_VALUE_LEN) || null;
    const newValue = normalizeString(a.newValue).slice(0, MAX_VALUE_LEN) || null;
    const read = normalizeBoolean(a.read);

    alerts.push({
      id,
      monitorId,
      incognito,
      createdAt,
      url,
      selector,
      oldValue,
      newValue,
      read,
    });

    seenAlerts.add(id);
    if (alerts.length >= MAX_ALERTS * 2) break;
  }

  // Trim to caps (keep newest alerts)
  alerts.sort((a, b) => b.createdAt - a.createdAt);
  if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;

  // Keep monitors stable ordering by updatedAt desc.
  monitors.sort((a, b) => b.updatedAt - a.updatedAt);
  if (monitors.length > MAX_MONITORS) monitors.length = MAX_MONITORS;

  return { version: SCHEMA_VERSION, updatedAt, monitors, alerts };
}

async function readStore(now: number): Promise<MonitorStoreV1> {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = (res as Record<string, unknown> | undefined)?.[STORAGE_KEY];
    return parseStore(raw, now);
  } catch {
    return createEmptyStore(now);
  }
}

async function writeStore(store: MonitorStoreV1): Promise<void> {
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

function computeUnreadCount(alerts: AlertV1[], incognito: boolean): number {
  return alerts.filter((a) => a.incognito === incognito && a.read !== true).length;
}

function computeMonitorUnread(alerts: AlertV1[], monitorId: string, incognito: boolean): number {
  let count = 0;
  for (const a of alerts) {
    if (a.incognito !== incognito) continue;
    if (a.monitorId !== monitorId) continue;
    if (a.read !== true) count++;
  }
  return count;
}

function toAlert(alert: AlertV1): QuickPanelMonitorAlert {
  return {
    id: alert.id,
    monitorId: alert.monitorId,
    incognito: alert.incognito,
    createdAt: alert.createdAt,
    url: alert.url,
    selector: alert.selector,
    oldValue: alert.oldValue,
    newValue: alert.newValue,
    read: alert.read === true,
  };
}

function toMonitorSummary(store: MonitorStoreV1, monitor: MonitorV1): QuickPanelMonitorSummary {
  const preview = monitor.lastValue ? buildPreview(monitor.lastValue) : undefined;
  const unreadAlerts = computeMonitorUnread(store.alerts, monitor.id, monitor.incognito);
  return {
    id: monitor.id,
    url: monitor.url,
    extractor: monitor.extractor,
    selector: monitor.selector,
    attribute: monitor.attribute,
    intervalMinutes: monitor.intervalMinutes,
    enabled: monitor.enabled === true,
    incognito: monitor.incognito === true,
    createdAt: monitor.createdAt,
    updatedAt: monitor.updatedAt,
    lastCheckedAt: monitor.lastCheckedAt,
    lastChangedAt: monitor.lastChangedAt,
    lastValuePreview: preview,
    lastError: monitor.lastError || undefined,
    unreadAlerts,
  };
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

// ============================================================
// Alarms
// ============================================================

const ALARM_PREFIX = 'qp_monitor_';

function alarmName(monitorId: string): string {
  return `${ALARM_PREFIX}${monitorId}`;
}

function parseMonitorIdFromAlarm(name: string): string | null {
  if (!name?.startsWith(ALARM_PREFIX)) return null;
  const id = name.slice(ALARM_PREFIX.length);
  return id ? id : null;
}

async function scheduleMonitorAlarm(monitor: MonitorV1): Promise<void> {
  if (!chrome.alarms?.create) return;
  if (!monitor.enabled) return;

  const periodInMinutes = normalizeIntervalMinutes(monitor.intervalMinutes);
  try {
    await Promise.resolve(
      chrome.alarms.create(alarmName(monitor.id), {
        delayInMinutes: periodInMinutes,
        periodInMinutes,
      }),
    );
  } catch (err) {
    console.warn(`${LOG_PREFIX} alarms.create failed:`, err);
  }
}

async function clearMonitorAlarm(monitorId: string): Promise<void> {
  if (!chrome.alarms?.clear) return;
  try {
    await Promise.resolve(chrome.alarms.clear(alarmName(monitorId)));
  } catch {
    // Best-effort
  }
}

async function clearStaleMonitorAlarms(validIds: Set<string>): Promise<void> {
  if (!chrome.alarms?.getAll || !chrome.alarms?.clear) return;
  try {
    const alarms = await Promise.resolve(chrome.alarms.getAll());
    const list = Array.isArray(alarms) ? alarms : [];
    await Promise.all(
      list
        .filter((a) => typeof a?.name === 'string' && a.name.startsWith(ALARM_PREFIX))
        .map(async (a) => {
          const id = parseMonitorIdFromAlarm(a.name);
          if (!id) return;
          if (validIds.has(id)) return;
          await clearMonitorAlarm(id);
        }),
    );
  } catch {
    // Best-effort
  }
}

// ============================================================
// Offscreen extraction
// ============================================================

interface OffscreenExtractResponse {
  success: boolean;
  error?: string;
  extracted?: string | null;
  title?: string | null;
  url?: string;
  status?: number;
  byteLength?: number;
}

async function sendToOffscreen(payload: {
  url: string;
  extractor: QuickPanelMonitorExtractorKind;
  selector: string;
  attribute?: string;
}): Promise<OffscreenExtractResponse> {
  await offscreenManager.ensureOffscreenDocument();

  const resp = (await chrome.runtime.sendMessage({
    target: MessageTarget.Offscreen,
    type: OFFSCREEN_MESSAGE_TYPES.WEB_MONITOR_FETCH_EXTRACT,
    url: payload.url,
    extractor: payload.extractor,
    selector: payload.selector,
    attribute: payload.attribute,
    timeoutMs: 12_000,
    maxBytes: 2_000_000,
  })) as OffscreenExtractResponse | undefined;

  return resp ?? { success: false, error: 'No response from offscreen document' };
}

// ============================================================
// Badge (best-effort, non-incognito only)
// ============================================================

async function updateBadgeFromStore(store: MonitorStoreV1): Promise<void> {
  if (!chrome.action?.setBadgeText) return;

  const unread = store.alerts.filter((a) => a.incognito !== true && a.read !== true).length;

  try {
    await Promise.resolve(chrome.action.setBadgeBackgroundColor?.({ color: '#DC2626' }));
  } catch {
    // ignore
  }

  try {
    await Promise.resolve(chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' }));
  } catch {
    // ignore
  }
}

// ============================================================
// Check execution (de-duped)
// ============================================================

type CheckOutcome = { monitor: QuickPanelMonitorSummary; alertCreated?: QuickPanelMonitorAlert };

const inFlightChecks = new Map<string, Promise<CheckOutcome>>();

async function runMonitorCheck(monitorId: string): Promise<CheckOutcome> {
  const existing = inFlightChecks.get(monitorId);
  if (existing) return existing;

  const promise = (async (): Promise<CheckOutcome> => {
    const now = Date.now();

    const snapshot = await withStoreLock(async () => {
      const store = await readStore(now);
      const monitor = store.monitors.find((m) => m.id === monitorId);
      if (!monitor) throw new Error('Monitor not found');
      if (!monitor.enabled) throw new Error('Monitor is disabled');

      return {
        url: monitor.url,
        extractor: monitor.extractor,
        selector: monitor.selector,
        attribute: monitor.attribute,
        incognito: monitor.incognito,
        previous: monitor.lastValue,
      };
    });

    const extractedResp = await sendToOffscreen({
      url: snapshot.url,
      extractor: snapshot.extractor,
      selector: snapshot.selector,
      attribute: snapshot.attribute,
    });

    const updated = await withStoreLock(async () => {
      const store = await readStore(now);
      const monitor = store.monitors.find((m) => m.id === monitorId);
      if (!monitor) throw new Error('Monitor not found');
      if (!monitor.enabled) throw new Error('Monitor is disabled');

      monitor.lastCheckedAt = now;
      monitor.updatedAt = now;

      let alertCreated: AlertV1 | null = null;

      if (!extractedResp.success) {
        monitor.lastError = extractedResp.error || 'Fetch/extract failed';
      } else {
        const raw = normalizeString(extractedResp.extracted);
        const value = raw ? collapseWhitespace(raw).slice(0, MAX_VALUE_LEN) : '';
        if (!value) {
          monitor.lastError = 'Extracted value is empty';
        } else {
          monitor.lastError = null;
          const prev = monitor.lastValue;

          if (prev === null) {
            // Baseline.
            monitor.lastValue = value;
          } else if (prev !== value) {
            // Changed.
            monitor.lastValue = value;
            monitor.lastChangedAt = now;
            alertCreated = {
              id: createId('mon_alert'),
              monitorId: monitor.id,
              incognito: monitor.incognito,
              createdAt: now,
              url: monitor.url,
              selector: monitor.selector,
              oldValue: prev,
              newValue: value,
              read: false,
            };
            store.alerts.unshift(alertCreated);
          }
        }
      }

      // Enforce caps (keep newest alerts).
      if (store.alerts.length > MAX_ALERTS) store.alerts.length = MAX_ALERTS;

      store.updatedAt = now;
      await writeStore(store);

      await updateBadgeFromStore(store);

      return { store, monitor, alertCreated };
    });

    return {
      monitor: toMonitorSummary(updated.store, updated.monitor),
      alertCreated: updated.alertCreated ? toAlert(updated.alertCreated) : undefined,
    };
  })().finally(() => {
    inFlightChecks.delete(monitorId);
  });

  inFlightChecks.set(monitorId, promise);
  return promise;
}

// ============================================================
// Message Handlers
// ============================================================

async function handleList(
  message: QuickPanelMonitorListMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelMonitorListResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    const query = normalizeString(message.payload?.query).trim().toLowerCase();
    const maxMonitors = clampInt(message.payload?.maxMonitors, 50, 1, 200);
    const maxAlerts = clampInt(message.payload?.maxAlerts, 50, 0, 200);

    const store = await readStore(now);

    const monitors = store.monitors
      .filter((m) => m.incognito === incognito)
      .filter((m) => {
        if (!query) return true;
        const hay = `${m.url} ${m.selector} ${m.attribute || ''}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, maxMonitors)
      .map((m) => toMonitorSummary(store, m));

    const alerts = store.alerts
      .filter((a) => a.incognito === incognito)
      .filter((a) => {
        if (!query) return true;
        const hay = `${a.url} ${a.selector} ${(a.newValue || '').slice(0, 200)}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return b.createdAt - a.createdAt;
      })
      .slice(0, maxAlerts)
      .map(toAlert);

    const unreadCount = computeUnreadCount(store.alerts, incognito);

    return { success: true, monitors, alerts, unreadCount };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to list monitors' };
  }
}

async function handleCreate(
  message: QuickPanelMonitorCreateMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelMonitorCreateResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    const url = normalizeUrl(message.payload?.url);
    const selector = normalizeSelector(message.payload?.selector);
    const extractor = normalizeExtractor(message.payload?.extractor);
    const attribute = normalizeAttribute(message.payload?.attribute);
    const intervalMinutes = normalizeIntervalMinutes(message.payload?.intervalMinutes);
    const fetchNow = message.payload?.fetchNow !== false;

    if (extractor === 'selector_attr' && !attribute) {
      throw new Error('attribute is required for selector_attr');
    }

    const monitor: MonitorV1 = {
      id: createId('mon'),
      url,
      extractor,
      selector,
      attribute,
      intervalMinutes,
      enabled: true,
      incognito,
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: 0,
      lastChangedAt: 0,
      lastValue: null,
      lastError: null,
    };

    await withStoreLock(async () => {
      const store = await readStore(now);

      // Prevent duplicates within the same context.
      const exists = store.monitors.some(
        (m) =>
          m.incognito === incognito &&
          m.url === monitor.url &&
          m.selector === monitor.selector &&
          m.extractor === monitor.extractor &&
          (m.attribute || '') === (monitor.attribute || ''),
      );
      if (exists) {
        throw new Error('Monitor already exists for this target');
      }

      if (store.monitors.length >= MAX_MONITORS) {
        throw new Error('Too many monitors (limit reached)');
      }

      store.monitors.unshift(monitor);
      store.updatedAt = now;
      await writeStore(store);

      await scheduleMonitorAlarm(monitor);
    });

    // Optional baseline fetch.
    let createdSummary: QuickPanelMonitorSummary;
    if (fetchNow) {
      createdSummary = (await runMonitorCheck(monitor.id)).monitor;
    } else {
      const store = await readStore(now);
      createdSummary = toMonitorSummary(store, monitor);
    }

    return { success: true, monitor: createdSummary };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to create monitor' };
  }
}

async function handleDelete(
  message: QuickPanelMonitorDeleteMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelMonitorDeleteResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    await withStoreLock(async () => {
      const store = await readStore(now);
      const before = store.monitors.length;
      store.monitors = store.monitors.filter((m) => !(m.id === id && m.incognito === incognito));
      if (store.monitors.length === before) throw new Error('Monitor not found');

      store.alerts = store.alerts.filter((a) => !(a.monitorId === id && a.incognito === incognito));
      store.updatedAt = now;
      await writeStore(store);
      await updateBadgeFromStore(store);
    });

    await clearMonitorAlarm(id);

    return { success: true };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to delete monitor' };
  }
}

async function handleSetEnabled(
  message: QuickPanelMonitorSetEnabledMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelMonitorSetEnabledResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const enabled = normalizeBoolean(message.payload?.enabled);

    const { monitor } = await withStoreLock(async () => {
      const store = await readStore(now);
      const monitor = store.monitors.find((m) => m.id === id && m.incognito === incognito);
      if (!monitor) throw new Error('Monitor not found');

      monitor.enabled = enabled;
      monitor.updatedAt = now;
      store.updatedAt = now;
      await writeStore(store);
      await updateBadgeFromStore(store);

      return { monitor };
    });

    if (enabled) {
      await scheduleMonitorAlarm(monitor);
    } else {
      await clearMonitorAlarm(id);
    }

    const storeAfter = await readStore(now);
    const updatedMonitor = storeAfter.monitors.find(
      (m) => m.id === id && m.incognito === incognito,
    );
    if (!updatedMonitor) throw new Error('Monitor not found');

    return { success: true, monitor: toMonitorSummary(storeAfter, updatedMonitor) };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to update monitor' };
  }
}

async function handleCheckNow(
  message: QuickPanelMonitorCheckNowMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelMonitorCheckNowResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    // Ensure the monitor exists in the same incognito context before running.
    await withStoreLock(async () => {
      const store = await readStore(Date.now());
      const found = store.monitors.some((m) => m.id === id && m.incognito === incognito);
      if (!found) throw new Error('Monitor not found');
    });

    const outcome = await runMonitorCheck(id);
    return { success: true, monitor: outcome.monitor, alertCreated: outcome.alertCreated };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to check monitor' };
  }
}

async function handleAlertMarkRead(
  message: QuickPanelMonitorAlertMarkReadMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelMonitorAlertMarkReadResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const read = normalizeBoolean(message.payload?.read);

    const unreadCount = await withStoreLock(async () => {
      const store = await readStore(now);
      const alert = store.alerts.find((a) => a.id === id && a.incognito === incognito);
      if (!alert) throw new Error('Alert not found');

      alert.read = read;
      store.updatedAt = now;
      await writeStore(store);
      await updateBadgeFromStore(store);
      return computeUnreadCount(store.alerts, incognito);
    });

    return { success: true, unreadCount };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to update alert' };
  }
}

async function handleAlertDelete(
  message: QuickPanelMonitorAlertDeleteMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelMonitorAlertDeleteResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();
    const id = normalizeString(message.payload?.id).trim();
    if (!id) return { success: false, error: 'Invalid id' };

    const unreadCount = await withStoreLock(async () => {
      const store = await readStore(now);
      const before = store.alerts.length;
      store.alerts = store.alerts.filter((a) => !(a.id === id && a.incognito === incognito));
      if (store.alerts.length === before) throw new Error('Alert not found');

      store.updatedAt = now;
      await writeStore(store);
      await updateBadgeFromStore(store);
      return computeUnreadCount(store.alerts, incognito);
    });

    return { success: true, unreadCount };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to delete alert' };
  }
}

// ============================================================
// Startup restore
// ============================================================

async function restoreOnStartup(): Promise<void> {
  const now = Date.now();
  const store = await readStore(now);

  const enabledIds = new Set<string>();
  for (const m of store.monitors) {
    if (!m.enabled) continue;
    enabledIds.add(m.id);
    await scheduleMonitorAlarm(m);
  }

  await clearStaleMonitorAlarms(enabledIds);
  await updateBadgeFromStore(store);
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

export function initQuickPanelMonitorHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_LIST) {
      handleList(message as QuickPanelMonitorListMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CREATE) {
      handleCreate(message as QuickPanelMonitorCreateMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_DELETE) {
      handleDelete(message as QuickPanelMonitorDeleteMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_SET_ENABLED) {
      handleSetEnabled(message as QuickPanelMonitorSetEnabledMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CHECK_NOW) {
      handleCheckNow(message as QuickPanelMonitorCheckNowMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_MARK_READ) {
      handleAlertMarkRead(message as QuickPanelMonitorAlertMarkReadMessage, sender).then(
        sendResponse,
      );
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_DELETE) {
      handleAlertDelete(message as QuickPanelMonitorAlertDeleteMessage, sender).then(sendResponse);
      return true;
    }
    return false;
  });

  if (chrome.alarms?.onAlarm?.addListener) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      const monitorId = parseMonitorIdFromAlarm(alarm?.name ?? '');
      if (!monitorId) return;
      void runMonitorCheck(monitorId).catch((err) => {
        console.debug(`${LOG_PREFIX} monitor check failed:`, err);
      });
    });
  }

  void restoreOnStartup();
  console.debug(`${LOG_PREFIX} Initialized`);
}
