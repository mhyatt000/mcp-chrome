/**
 * Quick Panel Focus Mode Handler
 *
 * Background service worker bridge for Pomodoro / Focus Mode (Phase 15.3).
 *
 * Features:
 * - Focus session state (running/paused/idle) persisted in chrome.storage.local
 * - Timer scheduling via chrome.alarms (MV3-friendly)
 * - Optional site blocking via chrome.declarativeNetRequest session rules
 *
 * Privacy / Isolation:
 * - Enforces incognito boundary: focus state is separated for regular vs incognito senders.
 * - Site blocking uses session-scoped rules. (tabIds/excludedTabIds are only supported for session rules.)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelFocusExtendMessage,
  type QuickPanelFocusExtendResponse,
  type QuickPanelFocusPauseMessage,
  type QuickPanelFocusPauseResponse,
  type QuickPanelFocusResumeMessage,
  type QuickPanelFocusResumeResponse,
  type QuickPanelFocusResumeBlockingMessage,
  type QuickPanelFocusResumeBlockingResponse,
  type QuickPanelFocusSnoozeBlockingMessage,
  type QuickPanelFocusSnoozeBlockingResponse,
  type QuickPanelFocusSetBlocklistMessage,
  type QuickPanelFocusSetBlocklistResponse,
  type QuickPanelFocusSetBlockingEnabledMessage,
  type QuickPanelFocusSetBlockingEnabledResponse,
  type QuickPanelFocusSession,
  type QuickPanelFocusStartMessage,
  type QuickPanelFocusStartResponse,
  type QuickPanelFocusStatus,
  type QuickPanelFocusStatusMessage,
  type QuickPanelFocusStatusResponse,
  type QuickPanelFocusStopMessage,
  type QuickPanelFocusStopResponse,
} from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelFocus]';

// ============================================================
// Storage Schema
// ============================================================

const STORAGE_KEY = 'quick_panel_focus_v1';
const SCHEMA_VERSION = 1 as const;

const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 12 * 60; // 12h guardrail

const MAX_BLOCKLIST_DOMAINS = 200;
const MAX_DOMAIN_LEN = 200;

type FocusPhase = QuickPanelFocusSession['phase'];

interface FocusSessionV1 {
  phase: FocusPhase;
  startedAt: number;
  endsAt: number;
  remainingMs: number;
  durationMs: number;
  updatedAt: number;
}

interface FocusContextV1 {
  session: FocusSessionV1;
  blockingEnabled: boolean;
  blockingSnoozedUntil: number;
  blocklist: string[];
}

interface FocusStoreV1 {
  version: typeof SCHEMA_VERSION;
  updatedAt: number;
  normal: FocusContextV1;
  incognito: FocusContextV1;
}

function createEmptySession(now: number): FocusSessionV1 {
  return {
    phase: 'idle',
    startedAt: 0,
    endsAt: 0,
    remainingMs: 0,
    durationMs: 0,
    updatedAt: now,
  };
}

function createEmptyContext(now: number): FocusContextV1 {
  return {
    session: createEmptySession(now),
    blockingEnabled: false,
    blockingSnoozedUntil: 0,
    blocklist: [],
  };
}

function createEmptyStore(now: number): FocusStoreV1 {
  return {
    version: SCHEMA_VERSION,
    updatedAt: now,
    normal: createEmptyContext(now),
    incognito: createEmptyContext(now),
  };
}

// ============================================================
// DNR (site blocking) - session rules
// ============================================================

type FocusContextKey = 'normal' | 'incognito';

const SESSION_RULE_ID_BASE: Record<FocusContextKey, number> = {
  normal: 915_000,
  incognito: 916_000,
};
const SESSION_RULE_ID_CAP = 800; // reserve < 1000 ids per context

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

function asContextKey(incognito: boolean): FocusContextKey {
  return incognito ? 'incognito' : 'normal';
}

function durationMinutesToMs(minutes: number): number {
  const clamped = clampInt(minutes, 25, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES);
  return clamped * 60_000;
}

function normalizeDomainInput(input: string): string | null {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;

  // Accept either a hostname ("example.com") or a full URL ("https://example.com/path").
  let host = raw;
  try {
    if (raw.includes('://')) {
      host = new URL(raw).hostname.toLowerCase();
    }
  } catch {
    // Fall back to raw string
  }

  host = host.replace(/^\.+/, '').trim();
  if (!host) return null;
  if (host.length > MAX_DOMAIN_LEN) return null;

  // Basic hostname safety: allow ascii letters/digits/dot/hyphen only.
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes('.')) return null;
  if (host.startsWith('-') || host.endsWith('-')) return null;
  if (host.includes('..')) return null;

  return host;
}

function normalizeBlocklist(domains: unknown): string[] {
  const list = Array.isArray(domains) ? domains : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const v of list) {
    const d = normalizeDomainInput(normalizeString(v));
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= MAX_BLOCKLIST_DOMAINS) break;
  }

  return out;
}

async function listIncognitoTabIds(): Promise<number[]> {
  try {
    const tabs = await chrome.tabs.query({});
    const ids = tabs
      .filter((t) => t?.incognito === true && typeof t.id === 'number' && Number.isFinite(t.id))
      .map((t) => t.id as number);
    // Deduplicate and keep stable order.
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

function ruleIdRangeForContext(ctx: FocusContextKey): { min: number; max: number } {
  const base = SESSION_RULE_ID_BASE[ctx];
  return { min: base, max: base + SESSION_RULE_ID_CAP - 1 };
}

function isFocusRuleId(ctx: FocusContextKey, id: number): boolean {
  const { min, max } = ruleIdRangeForContext(ctx);
  return Number.isFinite(id) && id >= min && id <= max;
}

async function clearBlockingRules(ctx: FocusContextKey): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.getSessionRules || !dnr?.updateSessionRules) return;

  try {
    const rules = await Promise.resolve(dnr.getSessionRules());
    const ids = (Array.isArray(rules) ? rules : [])
      .map((r) => r?.id)
      .filter((id): id is number => typeof id === 'number' && isFocusRuleId(ctx, id));
    if (ids.length === 0) return;
    await Promise.resolve(dnr.updateSessionRules({ removeRuleIds: ids }));
  } catch (err) {
    console.debug(`${LOG_PREFIX} Failed to clear blocking rules:`, err);
  }
}

async function applyBlockingRules(options: {
  ctx: FocusContextKey;
  domains: string[];
  incognitoTabIds: number[];
}): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;

  const { ctx, domains, incognitoTabIds } = options;

  // For privacy boundary:
  // - normal session: exclude incognito tabs
  // - incognito session: include only incognito tabs
  // 说明：tabIds/excludedTabIds 目前仅 session rules 支持，因此这里使用 updateSessionRules。
  const tabConstraint =
    ctx === 'incognito'
      ? incognitoTabIds.length > 0
        ? { tabIds: incognitoTabIds }
        : null
      : { excludedTabIds: incognitoTabIds };

  // If we cannot target any tab (incognito session with 0 incognito tabs), keep rules cleared.
  if (ctx === 'incognito' && !tabConstraint) {
    await clearBlockingRules(ctx);
    return;
  }

  // Always clear our previous rules first to avoid stale tab constraints / domains.
  await clearBlockingRules(ctx);

  const { min, max } = ruleIdRangeForContext(ctx);
  const capped = domains.slice(0, SESSION_RULE_ID_CAP);
  const addRules: chrome.declarativeNetRequest.Rule[] = [];

  for (let i = 0; i < capped.length; i++) {
    const id = min + i;
    if (id > max) break;

    const domain = capped[i];
    addRules.push({
      id,
      priority: 1,
      action: { type: 'block' },
      condition: {
        // Domain anchor matching for both domain and subdomains.
        urlFilter: `||${domain}^`,
        resourceTypes: ['main_frame', 'sub_frame'],
        ...(tabConstraint ?? {}),
      },
    });
  }

  if (addRules.length === 0) {
    await clearBlockingRules(ctx);
    return;
  }

  try {
    await Promise.resolve(dnr.updateSessionRules({ addRules }));
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to apply blocking rules:`, err);
  }
}

// ============================================================
// Storage Access
// ============================================================

function parseSession(raw: unknown, now: number): FocusSessionV1 {
  if (!isRecord(raw)) return createEmptySession(now);

  const phaseRaw = normalizeString(raw.phase);
  const phase: FocusPhase =
    phaseRaw === 'running' || phaseRaw === 'paused' || phaseRaw === 'idle'
      ? (phaseRaw as FocusPhase)
      : 'idle';

  const startedAt = Math.max(0, toFiniteNumber(raw.startedAt, 0));
  const endsAt = Math.max(0, toFiniteNumber(raw.endsAt, 0));
  const remainingMs = Math.max(0, toFiniteNumber(raw.remainingMs, 0));
  const durationMs = Math.max(0, toFiniteNumber(raw.durationMs, 0));
  const updatedAt = Math.max(0, toFiniteNumber(raw.updatedAt, now));

  if (phase === 'idle') {
    return { ...createEmptySession(now), updatedAt };
  }

  return {
    phase,
    startedAt,
    endsAt,
    remainingMs,
    durationMs,
    updatedAt,
  };
}

function parseContext(raw: unknown, now: number): FocusContextV1 {
  if (!isRecord(raw)) return createEmptyContext(now);
  const session = parseSession(raw.session, now);
  const blockingEnabled = normalizeBoolean(raw.blockingEnabled);
  const blockingSnoozedUntil = Math.max(0, toFiniteNumber(raw.blockingSnoozedUntil, 0));
  const blocklist = normalizeBlocklist(raw.blocklist);
  return { session, blockingEnabled, blockingSnoozedUntil, blocklist };
}

function parseStore(raw: unknown, now: number): FocusStoreV1 {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION) {
    return createEmptyStore(now);
  }
  const updatedAt = Math.max(0, toFiniteNumber(raw.updatedAt, now));
  return {
    version: SCHEMA_VERSION,
    updatedAt,
    normal: parseContext(raw.normal, now),
    incognito: parseContext(raw.incognito, now),
  };
}

async function readStore(now: number): Promise<FocusStoreV1> {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = (res as Record<string, unknown> | undefined)?.[STORAGE_KEY];
    return parseStore(raw, now);
  } catch {
    return createEmptyStore(now);
  }
}

async function writeStore(store: FocusStoreV1): Promise<void> {
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

// ============================================================
// Incognito boundary
// ============================================================

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

const END_ALARM_PREFIX = 'qp_focus_end_';
const BLOCKING_SNOOZE_ALARM_PREFIX = 'qp_focus_block_snooze_end_';

function endAlarmName(ctx: FocusContextKey): string {
  return `${END_ALARM_PREFIX}${ctx}`;
}

function blockingSnoozeAlarmName(ctx: FocusContextKey): string {
  return `${BLOCKING_SNOOZE_ALARM_PREFIX}${ctx}`;
}

function parseContextFromEndAlarmName(name: string): FocusContextKey | null {
  if (!name?.startsWith(END_ALARM_PREFIX)) return null;
  const suffix = name.slice(END_ALARM_PREFIX.length);
  if (suffix === 'normal' || suffix === 'incognito') return suffix;
  return null;
}

function parseContextFromBlockingSnoozeAlarmName(name: string): FocusContextKey | null {
  if (!name?.startsWith(BLOCKING_SNOOZE_ALARM_PREFIX)) return null;
  const suffix = name.slice(BLOCKING_SNOOZE_ALARM_PREFIX.length);
  if (suffix === 'normal' || suffix === 'incognito') return suffix;
  return null;
}

async function clearAlarm(name: string): Promise<void> {
  if (!chrome.alarms?.clear) return;
  try {
    await Promise.resolve(chrome.alarms.clear(name));
  } catch (err) {
    console.debug(`${LOG_PREFIX} alarms.clear failed:`, err);
  }
}

async function scheduleAlarm(name: string, whenMs: number): Promise<void> {
  if (!chrome.alarms?.create) {
    console.warn(`${LOG_PREFIX} chrome.alarms.create is unavailable`);
    return;
  }
  try {
    await Promise.resolve(chrome.alarms.create(name, { when: whenMs }));
  } catch (err) {
    console.warn(`${LOG_PREFIX} alarms.create failed:`, err);
  }
}

async function clearEndAlarm(ctx: FocusContextKey): Promise<void> {
  await clearAlarm(endAlarmName(ctx));
}

async function scheduleEndAlarm(ctx: FocusContextKey, whenMs: number): Promise<void> {
  await scheduleAlarm(endAlarmName(ctx), whenMs);
}

async function clearBlockingSnoozeAlarm(ctx: FocusContextKey): Promise<void> {
  await clearAlarm(blockingSnoozeAlarmName(ctx));
}

async function scheduleBlockingSnoozeAlarm(ctx: FocusContextKey, whenMs: number): Promise<void> {
  await scheduleAlarm(blockingSnoozeAlarmName(ctx), whenMs);
}

// ============================================================
// Status helpers
// ============================================================

function toQuickPanelSession(session: FocusSessionV1, now: number): QuickPanelFocusSession {
  const phase = session.phase;
  if (phase === 'running') {
    const remainingMs = Math.max(0, (session.endsAt || 0) - now);
    return { ...session, remainingMs };
  }
  if (phase === 'paused') {
    return { ...session, remainingMs: Math.max(0, session.remainingMs || 0) };
  }
  return createEmptySession(now);
}

function toStatus(params: {
  incognito: boolean;
  now: number;
  context: FocusContextV1;
}): QuickPanelFocusStatus {
  const { incognito, now, context } = params;
  const session = toQuickPanelSession(context.session, now);
  const supportsBlocking = context.blockingEnabled === true && context.blocklist.length > 0;
  const blockingSnoozedUntilRaw = Math.max(0, context.blockingSnoozedUntil || 0);
  const blockingSnoozedUntil =
    supportsBlocking && session.phase !== 'idle' && blockingSnoozedUntilRaw > now
      ? blockingSnoozedUntilRaw
      : 0;

  const blockingActive =
    session.phase === 'running' && supportsBlocking && blockingSnoozedUntil === 0;

  return {
    incognito,
    now,
    session,
    blockingEnabled: context.blockingEnabled === true,
    blockingActive,
    blockingSnoozedUntil,
    blocklist: [...context.blocklist],
  };
}

function getContext(store: FocusStoreV1, ctx: FocusContextKey): FocusContextV1 {
  return ctx === 'incognito' ? store.incognito : store.normal;
}

function setContext(store: FocusStoreV1, ctx: FocusContextKey, next: FocusContextV1): void {
  if (ctx === 'incognito') store.incognito = next;
  else store.normal = next;
}

// ============================================================
// Core mutations
// ============================================================

async function syncSideEffects(
  ctx: FocusContextKey,
  context: FocusContextV1,
  now: number,
): Promise<void> {
  // Alarms: keep only when running and endsAt is in the future.
  if (context.session.phase === 'running' && context.session.endsAt > now) {
    await scheduleEndAlarm(ctx, context.session.endsAt);
  } else {
    await clearEndAlarm(ctx);
  }

  const supportsBlocking = context.blockingEnabled === true && context.blocklist.length > 0;
  const snoozedUntil = supportsBlocking ? Math.max(0, context.blockingSnoozedUntil || 0) : 0;
  const isSnoozed = context.session.phase !== 'idle' && snoozedUntil > now;

  // Blocking snooze alarm (re-applies rules when snooze ends).
  if (isSnoozed) {
    await scheduleBlockingSnoozeAlarm(ctx, snoozedUntil);
  } else {
    await clearBlockingSnoozeAlarm(ctx);
  }

  // Site blocking: active only while running and not snoozed.
  if (context.session.phase === 'running' && supportsBlocking && !isSnoozed) {
    const incognitoTabIds = await listIncognitoTabIds();
    await applyBlockingRules({ ctx, domains: context.blocklist, incognitoTabIds });
  } else {
    await clearBlockingRules(ctx);
  }
}

async function reconcileExpiredSessions(): Promise<void> {
  const now = Date.now();
  const { store, changedContexts } = await withStoreLock(async () => {
    const store = await readStore(now);
    const changedContexts = new Set<FocusContextKey>();

    for (const ctx of ['normal', 'incognito'] as const) {
      const context = getContext(store, ctx);

      if (context.session.phase === 'running') {
        const remaining = Math.max(0, (context.session.endsAt || 0) - now);
        if (remaining <= 0) {
          context.session = createEmptySession(now);
          context.blockingSnoozedUntil = 0;
          changedContexts.add(ctx);
        } else {
          const snoozedUntil = Math.max(0, context.blockingSnoozedUntil || 0);
          if (snoozedUntil > 0 && snoozedUntil <= now) {
            context.blockingSnoozedUntil = 0;
            changedContexts.add(ctx);
          }
        }
      } else if (context.session.phase === 'idle') {
        if (context.blockingSnoozedUntil !== 0) {
          context.blockingSnoozedUntil = 0;
          changedContexts.add(ctx);
        }
      } else {
        const snoozedUntil = Math.max(0, context.blockingSnoozedUntil || 0);
        if (snoozedUntil > 0 && snoozedUntil <= now) {
          context.blockingSnoozedUntil = 0;
          changedContexts.add(ctx);
        }
      }

      setContext(store, ctx, context);
    }

    if (changedContexts.size > 0) {
      store.updatedAt = now;
      await writeStore(store);
    }

    return { store, changedContexts: [...changedContexts] };
  });

  // Clear alarms / blocking for any session that was auto-ended.
  for (const ctx of changedContexts) {
    await syncSideEffects(ctx, getContext(store, ctx), now);
  }
}

// ============================================================
// Message handlers
// ============================================================

async function handleStatus(
  _message: QuickPanelFocusStatusMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusStatusResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const now = Date.now();

    await reconcileExpiredSessions();
    const store = await readStore(now);

    const ctx = asContextKey(incognito);
    const status = toStatus({ incognito, now, context: getContext(store, ctx) });
    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to get focus status' };
  }
}

async function handleStart(
  message: QuickPanelFocusStartMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusStartResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const durationMinutes = clampInt(
      message.payload?.durationMinutes,
      25,
      MIN_DURATION_MINUTES,
      MAX_DURATION_MINUTES,
    );
    const durationMs = durationMinutesToMs(durationMinutes);

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);

      context.session = {
        phase: 'running',
        startedAt: now,
        endsAt: now + durationMs,
        remainingMs: durationMs,
        durationMs,
        updatedAt: now,
      };
      context.blockingSnoozedUntil = 0;

      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);

      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to start focus session' };
  }
}

async function handleStop(
  _message: QuickPanelFocusStopMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusStopResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);
      context.session = createEmptySession(now);
      context.blockingSnoozedUntil = 0;
      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to stop focus session' };
  }
}

async function handlePause(
  _message: QuickPanelFocusPauseMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusPauseResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);

      if (context.session.phase === 'idle') {
        throw new Error('No active focus session');
      }
      if (context.session.phase === 'paused') {
        return toStatus({ incognito, now, context });
      }

      const remainingMs = Math.max(0, (context.session.endsAt || 0) - now);
      if (remainingMs <= 0) {
        context.session = createEmptySession(now);
      } else {
        context.session = {
          ...context.session,
          phase: 'paused',
          endsAt: 0,
          remainingMs,
          updatedAt: now,
        };
      }

      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to pause focus session' };
  }
}

async function handleResume(
  _message: QuickPanelFocusResumeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusResumeResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);

      if (context.session.phase === 'idle') {
        throw new Error('No active focus session');
      }
      if (context.session.phase === 'running') {
        return toStatus({ incognito, now, context });
      }

      const remainingMs = Math.max(0, context.session.remainingMs || 0);
      if (remainingMs <= 0) {
        context.session = createEmptySession(now);
      } else {
        context.session = {
          ...context.session,
          phase: 'running',
          endsAt: now + remainingMs,
          updatedAt: now,
        };
      }

      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to resume focus session' };
  }
}

async function handleExtend(
  message: QuickPanelFocusExtendMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusExtendResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const minutes = clampInt(message.payload?.minutes, 5, 1, 180);
    const extendMs = minutes * 60_000;

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);

      if (context.session.phase === 'idle') {
        throw new Error('No active focus session');
      }

      if (context.session.phase === 'running') {
        context.session = {
          ...context.session,
          endsAt: (context.session.endsAt || now) + extendMs,
          durationMs: Math.max(0, context.session.durationMs || 0) + extendMs,
          updatedAt: now,
        };
      } else if (context.session.phase === 'paused') {
        context.session = {
          ...context.session,
          remainingMs: Math.max(0, context.session.remainingMs || 0) + extendMs,
          durationMs: Math.max(0, context.session.durationMs || 0) + extendMs,
          updatedAt: now,
        };
      }

      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to extend focus session' };
  }
}

async function handleSetBlocklist(
  message: QuickPanelFocusSetBlocklistMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusSetBlocklistResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const nextList = normalizeBlocklist(message.payload?.domains);

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);
      context.blocklist = nextList;
      if (context.blocklist.length === 0) context.blockingSnoozedUntil = 0;
      context.session.updatedAt = now;
      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to update blocklist' };
  }
}

async function handleSetBlockingEnabled(
  message: QuickPanelFocusSetBlockingEnabledMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusSetBlockingEnabledResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const enabled = normalizeBoolean(message.payload?.enabled);

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);
      context.blockingEnabled = enabled;
      context.blockingSnoozedUntil = 0;
      context.session.updatedAt = now;
      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to update blocking setting' };
  }
}

async function handleSnoozeBlocking(
  message: QuickPanelFocusSnoozeBlockingMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusSnoozeBlockingResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const minutes = clampInt(message.payload?.minutes, 5, 1, 180);
    const extendMs = minutes * 60_000;

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);

      if (context.session.phase === 'idle') {
        throw new Error('No active focus session');
      }
      if (context.blockingEnabled !== true) {
        throw new Error('Blocking is disabled');
      }
      if (context.blocklist.length === 0) {
        throw new Error('No blocked domains configured');
      }

      const base = Math.max(now, Math.max(0, context.blockingSnoozedUntil || 0));
      context.blockingSnoozedUntil = base + extendMs;
      context.session.updatedAt = now;
      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to snooze blocking' };
  }
}

async function handleResumeBlocking(
  _message: QuickPanelFocusResumeBlockingMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelFocusResumeBlockingResponse> {
  try {
    const incognito = await resolveSenderIncognito(sender);
    const ctx = asContextKey(incognito);
    const now = Date.now();

    const status = await withStoreLock(async () => {
      const store = await readStore(now);
      const context = getContext(store, ctx);
      context.blockingSnoozedUntil = 0;
      context.session.updatedAt = now;
      store.updatedAt = now;
      setContext(store, ctx, context);
      await writeStore(store);
      return toStatus({ incognito, now, context });
    });

    await syncSideEffects(
      ctx,
      {
        session: status.session,
        blockingEnabled: status.blockingEnabled,
        blockingSnoozedUntil: status.blockingSnoozedUntil,
        blocklist: status.blocklist,
      },
      now,
    );

    return { success: true, status };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to resume blocking' };
  }
}

// ============================================================
// Startup + listeners
// ============================================================

async function restoreOnStartup(): Promise<void> {
  const now = Date.now();
  await reconcileExpiredSessions();

  const store = await readStore(now);
  for (const ctx of ['normal', 'incognito'] as const) {
    const context = getContext(store, ctx);
    await syncSideEffects(ctx, context, now);
  }
}

function registerAlarmListener(): void {
  if (!chrome.alarms?.onAlarm?.addListener) return;

  chrome.alarms.onAlarm.addListener((alarm) => {
    const name = alarm?.name ?? '';

    const endCtx = parseContextFromEndAlarmName(name);
    const snoozeCtx = endCtx ? null : parseContextFromBlockingSnoozeAlarmName(name);

    const ctx = endCtx ?? snoozeCtx;
    if (!ctx) return;

    void (async () => {
      const now = Date.now();
      if (endCtx) {
        await withStoreLock(async () => {
          const store = await readStore(now);
          const context = getContext(store, ctx);
          if (context.session.phase === 'running') {
            const remaining = Math.max(0, (context.session.endsAt || 0) - now);
            if (remaining <= 0) {
              context.session = createEmptySession(now);
              context.blockingSnoozedUntil = 0;
              store.updatedAt = now;
              setContext(store, ctx, context);
              await writeStore(store);
            }
          }
        });
      } else if (snoozeCtx) {
        await withStoreLock(async () => {
          const store = await readStore(now);
          const context = getContext(store, ctx);
          const snoozedUntil = Math.max(0, context.blockingSnoozedUntil || 0);
          if (snoozedUntil > 0 && snoozedUntil <= now) {
            context.blockingSnoozedUntil = 0;
            store.updatedAt = now;
            setContext(store, ctx, context);
            await writeStore(store);
          }
        });
      }

      const storeAfter = await readStore(now);
      await syncSideEffects(ctx, getContext(storeAfter, ctx), now);
    })();
  });
}

let tabRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function registerTabListeners(): void {
  if (!chrome.tabs?.onCreated?.addListener || !chrome.tabs?.onRemoved?.addListener) return;

  const scheduleRefresh = () => {
    if (tabRefreshTimer) clearTimeout(tabRefreshTimer);
    tabRefreshTimer = setTimeout(() => {
      tabRefreshTimer = null;
      void (async () => {
        const now = Date.now();
        const store = await readStore(now);

        // Only refresh if any context is actively blocking (running + enabled + non-empty blocklist).
        const needs =
          (store.normal.session.phase === 'running' &&
            store.normal.blockingEnabled &&
            store.normal.blocklist.length > 0) ||
          (store.incognito.session.phase === 'running' &&
            store.incognito.blockingEnabled &&
            store.incognito.blocklist.length > 0);

        if (!needs) return;

        const incognitoTabIds = await listIncognitoTabIds();

        if (
          store.normal.session.phase === 'running' &&
          store.normal.blockingEnabled &&
          store.normal.blocklist.length > 0
        ) {
          await applyBlockingRules({
            ctx: 'normal',
            domains: store.normal.blocklist,
            incognitoTabIds,
          });
        }
        if (
          store.incognito.session.phase === 'running' &&
          store.incognito.blockingEnabled &&
          store.incognito.blocklist.length > 0
        ) {
          await applyBlockingRules({
            ctx: 'incognito',
            domains: store.incognito.blocklist,
            incognitoTabIds,
          });
        }
      })();
    }, 150);
  };

  chrome.tabs.onCreated.addListener(() => scheduleRefresh());
  chrome.tabs.onRemoved.addListener(() => scheduleRefresh());
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

export function initQuickPanelFocusHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS) {
      handleStatus(message as QuickPanelFocusStatusMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_START) {
      handleStart(message as QuickPanelFocusStartMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STOP) {
      handleStop(message as QuickPanelFocusStopMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_PAUSE) {
      handlePause(message as QuickPanelFocusPauseMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME) {
      handleResume(message as QuickPanelFocusResumeMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_EXTEND) {
      handleExtend(message as QuickPanelFocusExtendMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKLIST) {
      handleSetBlocklist(message as QuickPanelFocusSetBlocklistMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKING_ENABLED) {
      handleSetBlockingEnabled(message as QuickPanelFocusSetBlockingEnabledMessage, sender).then(
        sendResponse,
      );
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SNOOZE_BLOCKING) {
      handleSnoozeBlocking(message as QuickPanelFocusSnoozeBlockingMessage, sender).then(
        sendResponse,
      );
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME_BLOCKING) {
      handleResumeBlocking(message as QuickPanelFocusResumeBlockingMessage, sender).then(
        sendResponse,
      );
      return true;
    }
    return false;
  });

  registerAlarmListener();
  registerTabListeners();
  void restoreOnStartup();

  console.debug(`${LOG_PREFIX} Initialized`);
}
