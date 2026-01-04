/**
 * Focus Provider (Quick Panel)
 *
 * Scope:
 * - Prefix-only scope: `focus `
 * - Not included in 'all' scope (noise + privacy)
 *
 * Supports:
 * - Start / stop / pause / resume / extend focus sessions (via background bridge)
 * - Optional site blocking configuration (blocklist + toggle)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelFocusExtendResponse,
  type QuickPanelFocusPauseResponse,
  type QuickPanelFocusResumeBlockingResponse,
  type QuickPanelFocusSession,
  type QuickPanelFocusSnoozeBlockingResponse,
  type QuickPanelFocusSetBlocklistResponse,
  type QuickPanelFocusSetBlockingEnabledResponse,
  type QuickPanelFocusResumeResponse,
  type QuickPanelFocusStartResponse,
  type QuickPanelFocusStatus,
  type QuickPanelFocusStatusResponse,
  type QuickPanelFocusStopResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { computeWeightedTokenScore, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type FocusResultData =
  | { kind: 'status'; status: QuickPanelFocusStatus }
  | { kind: 'start'; minutes: number }
  | { kind: 'stop' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'extend'; minutes: number }
  | { kind: 'snooze_blocking'; minutes: number }
  | { kind: 'resume_blocking' }
  | { kind: 'set_blocklist'; domains: string[] }
  | { kind: 'set_blocking_enabled'; enabled: boolean }
  | { kind: 'blocklist_domain'; domain: string; blocklist: string[] }
  | { kind: 'help' };

interface FocusClient {
  status: (options: { signal: AbortSignal }) => Promise<QuickPanelFocusStatus>;
  start: (options: { minutes: number }) => Promise<QuickPanelFocusStatus>;
  stop: () => Promise<QuickPanelFocusStatus>;
  pause: () => Promise<QuickPanelFocusStatus>;
  resume: () => Promise<QuickPanelFocusStatus>;
  extend: (options: { minutes: number }) => Promise<QuickPanelFocusStatus>;
  snoozeBlocking: (options: { minutes: number }) => Promise<QuickPanelFocusStatus>;
  resumeBlocking: () => Promise<QuickPanelFocusStatus>;
  setBlocklist: (options: { domains: string[] }) => Promise<QuickPanelFocusStatus>;
  setBlockingEnabled: (options: { enabled: boolean }) => Promise<QuickPanelFocusStatus>;
}

// ============================================================
// Helpers
// ============================================================

function parseMinutesToken(token: string | undefined): number | null {
  const raw = String(token ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  const m = raw.match(/^(\d+)(m)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function normalizeDomainToken(token: string): string | null {
  const raw = String(token ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;

  // Split "a.com,b.com" into tokens (provider-side convenience; background is source of truth).
  const first = raw
    .split(',')
    .map((s) => s.trim())
    .find(Boolean);
  if (!first) return null;

  let host = first;
  try {
    if (first.includes('://')) host = new URL(first).hostname.toLowerCase();
  } catch {
    // ignore
  }

  host = host.replace(/^\.+/, '').trim();
  if (!host) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes('.')) return null;
  if (host.includes('..')) return null;
  return host;
}

function formatDuration(ms: number): string {
  const n = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(n / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatSessionTitle(session: QuickPanelFocusSession): string {
  if (session.phase === 'running') return `Focus: ${formatDuration(session.remainingMs)} remaining`;
  if (session.phase === 'paused')
    return `Focus paused: ${formatDuration(session.remainingMs)} remaining`;
  return 'Focus: idle';
}

function buildStatusSubtitle(status: QuickPanelFocusStatus): string {
  const parts: string[] = [];
  const snoozedMs = Math.max(0, (status.blockingSnoozedUntil || 0) - (status.now || 0));
  const isSnoozed = snoozedMs > 0;

  if (status.blockingEnabled && status.blocklist.length > 0) {
    if (isSnoozed) {
      parts.push(`Blocking: snoozed ${formatDuration(snoozedMs)}`);
    } else {
      parts.push(status.blockingActive ? 'Blocking: on' : 'Blocking: off');
    }
    parts.push(`${status.blocklist.length} domains`);
  } else if (status.blockingEnabled) {
    parts.push('Blocking: on (no domains)');
  } else {
    parts.push('Blocking: off');
  }
  if (status.incognito) parts.push('Incognito');
  return parts.join(' \u00B7 ');
}

function formatStatusForClipboard(status: QuickPanelFocusStatus): string {
  const s = status.session;
  if (s.phase === 'running') {
    return `Focus running (${formatDuration(s.remainingMs)} remaining)`;
  }
  if (s.phase === 'paused') {
    return `Focus paused (${formatDuration(s.remainingMs)} remaining)`;
  }
  return 'Focus idle';
}

function createRuntimeClient(): FocusClient {
  async function send<T>(type: string, payload: unknown): Promise<T> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    return (await chrome.runtime.sendMessage({ type, payload })) as T;
  }

  async function status(options: { signal: AbortSignal }): Promise<QuickPanelFocusStatus> {
    if (options.signal.aborted) throw new Error('aborted');

    const resp = await send<QuickPanelFocusStatusResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS,
      {},
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to get focus status');
    }

    return resp.status;
  }

  async function start(options: { minutes: number }): Promise<QuickPanelFocusStatus> {
    const minutes = Math.floor(Number(options.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('minutes must be positive');

    const resp = await send<QuickPanelFocusStartResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_START,
      { durationMinutes: minutes },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to start focus');
    }

    return resp.status;
  }

  async function stop(): Promise<QuickPanelFocusStatus> {
    const resp = await send<QuickPanelFocusStopResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STOP,
      {},
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to stop focus');
    }

    return resp.status;
  }

  async function pause(): Promise<QuickPanelFocusStatus> {
    const resp = await send<QuickPanelFocusPauseResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_PAUSE,
      {},
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to pause focus');
    }

    return resp.status;
  }

  async function resume(): Promise<QuickPanelFocusStatus> {
    const resp = await send<QuickPanelFocusResumeResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME,
      {},
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to resume focus');
    }

    return resp.status;
  }

  async function extend(options: { minutes: number }): Promise<QuickPanelFocusStatus> {
    const minutes = Math.floor(Number(options.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('minutes must be positive');

    const resp = await send<QuickPanelFocusExtendResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_EXTEND,
      { minutes },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to extend focus');
    }

    return resp.status;
  }

  async function snoozeBlocking(options: { minutes: number }): Promise<QuickPanelFocusStatus> {
    const minutes = Math.floor(Number(options.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('minutes must be positive');

    const resp = await send<QuickPanelFocusSnoozeBlockingResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SNOOZE_BLOCKING,
      { minutes },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to snooze blocking');
    }

    return resp.status;
  }

  async function resumeBlocking(): Promise<QuickPanelFocusStatus> {
    const resp = await send<QuickPanelFocusResumeBlockingResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME_BLOCKING,
      {},
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to resume blocking');
    }

    return resp.status;
  }

  async function setBlocklist(options: { domains: string[] }): Promise<QuickPanelFocusStatus> {
    const domains = Array.isArray(options.domains) ? options.domains : [];

    const resp = await send<QuickPanelFocusSetBlocklistResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKLIST,
      { domains },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to update blocklist');
    }

    return resp.status;
  }

  async function setBlockingEnabled(options: { enabled: boolean }): Promise<QuickPanelFocusStatus> {
    const resp = await send<QuickPanelFocusSetBlockingEnabledResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKING_ENABLED,
      { enabled: options.enabled === true },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to update blocking setting');
    }

    return resp.status;
  }

  return {
    status,
    start,
    stop,
    pause,
    resume,
    extend,
    snoozeBlocking,
    resumeBlocking,
    setBlocklist,
    setBlockingEnabled,
  };
}

// ============================================================
// Provider Factory
// ============================================================

export function createFocusProvider(): SearchProvider<FocusResultData> {
  const id = 'focus';
  const name = 'Focus';
  const icon = '\uD83C\uDF45'; // 🍅

  const client = createRuntimeClient();

  function getActions(item: SearchResult<FocusResultData>): Action<FocusResultData>[] {
    const data = item.data;

    if (data.kind === 'status') {
      const phase = data.status.session.phase;
      const actions: Action<FocusResultData>[] = [
        {
          id: 'focus.copyStatus',
          title: 'Copy status',
          hotkeyHint: 'Enter',
          execute: async () => {
            const text = formatStatusForClipboard(data.status);
            await writeToClipboard(text, { source: 'focus.status.copy', label: 'Focus' });
          },
        },
      ];

      if (phase === 'running') {
        actions.push(
          {
            id: 'focus.pause',
            title: 'Pause',
            execute: async () => {
              await client.pause();
            },
          },
          {
            id: 'focus.extend5',
            title: 'Extend +5m',
            execute: async () => {
              await client.extend({ minutes: 5 });
            },
          },
          {
            id: 'focus.stop',
            title: 'Stop',
            tone: 'danger',
            execute: async () => {
              await client.stop();
            },
          },
        );
      } else if (phase === 'paused') {
        actions.push(
          {
            id: 'focus.resume',
            title: 'Resume',
            execute: async () => {
              await client.resume();
            },
          },
          {
            id: 'focus.extend5',
            title: 'Extend +5m',
            execute: async () => {
              await client.extend({ minutes: 5 });
            },
          },
          {
            id: 'focus.stop',
            title: 'Stop',
            tone: 'danger',
            execute: async () => {
              await client.stop();
            },
          },
        );
      } else {
        actions.push({
          id: 'focus.start25',
          title: 'Start 25m',
          execute: async () => {
            await client.start({ minutes: 25 });
          },
        });
      }

      actions.push({
        id: 'focus.toggleBlocking',
        title: data.status.blockingEnabled ? 'Disable blocking' : 'Enable blocking',
        execute: async () => {
          await client.setBlockingEnabled({ enabled: !data.status.blockingEnabled });
        },
      });

      const snoozedMs = Math.max(
        0,
        (data.status.blockingSnoozedUntil || 0) - (data.status.now || 0),
      );
      const isSnoozed = snoozedMs > 0;
      const supportsSnooze = data.status.blockingEnabled && data.status.blocklist.length > 0;

      if (supportsSnooze && isSnoozed) {
        actions.push(
          {
            id: 'focus.blocking.resume',
            title: 'Resume blocking now',
            execute: async () => {
              await client.resumeBlocking();
            },
          },
          {
            id: 'focus.blocking.snooze5',
            title: 'Extend blocking snooze +5m',
            execute: async () => {
              await client.snoozeBlocking({ minutes: 5 });
            },
          },
        );
      } else if (supportsSnooze && phase === 'running' && data.status.blockingActive) {
        actions.push(
          {
            id: 'focus.blocking.snooze5',
            title: 'Snooze blocking 5m',
            execute: async () => {
              await client.snoozeBlocking({ minutes: 5 });
            },
          },
          {
            id: 'focus.blocking.snooze15',
            title: 'Snooze blocking 15m',
            execute: async () => {
              await client.snoozeBlocking({ minutes: 15 });
            },
          },
        );
      }

      return actions;
    }

    if (data.kind === 'start') {
      return [
        {
          id: 'focus.start',
          title: `Start ${data.minutes}m`,
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.start({ minutes: data.minutes });
          },
        },
      ];
    }

    if (data.kind === 'pause') {
      return [
        {
          id: 'focus.pause',
          title: 'Pause focus',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.pause();
          },
        },
      ];
    }

    if (data.kind === 'resume') {
      return [
        {
          id: 'focus.resume',
          title: 'Resume focus',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.resume();
          },
        },
      ];
    }

    if (data.kind === 'extend') {
      return [
        {
          id: 'focus.extend',
          title: `Extend +${data.minutes}m`,
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.extend({ minutes: data.minutes });
          },
        },
      ];
    }

    if (data.kind === 'snooze_blocking') {
      return [
        {
          id: 'focus.blocking.snooze',
          title: `Snooze blocking ${data.minutes}m`,
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.snoozeBlocking({ minutes: data.minutes });
          },
        },
      ];
    }

    if (data.kind === 'resume_blocking') {
      return [
        {
          id: 'focus.blocking.resume',
          title: 'Resume blocking now',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.resumeBlocking();
          },
        },
      ];
    }

    if (data.kind === 'stop') {
      return [
        {
          id: 'focus.stop',
          title: 'Stop focus',
          tone: 'danger',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.stop();
          },
        },
      ];
    }

    if (data.kind === 'set_blocklist') {
      return [
        {
          id: 'focus.setBlocklist',
          title: 'Set blocklist',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.setBlocklist({ domains: data.domains });
          },
        },
      ];
    }

    if (data.kind === 'set_blocking_enabled') {
      return [
        {
          id: 'focus.setBlockingEnabled',
          title: data.enabled ? 'Enable blocking' : 'Disable blocking',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.setBlockingEnabled({ enabled: data.enabled });
          },
        },
      ];
    }

    if (data.kind === 'blocklist_domain') {
      return [
        {
          id: 'focus.blocklist.remove',
          title: 'Remove domain',
          tone: 'danger',
          execute: async () => {
            const next = data.blocklist.filter((d) => d !== data.domain);
            await client.setBlocklist({ domains: next });
          },
        },
        {
          id: 'focus.blocklist.copy',
          title: 'Copy domain',
          execute: async () => {
            await writeToClipboard(data.domain, {
              source: 'focus.blocklist.copy',
              label: 'Focus domain',
            });
          },
        },
      ];
    }

    return [];
  }

  function buildDefaultResults(status: QuickPanelFocusStatus): SearchResult<FocusResultData>[] {
    const results: SearchResult<FocusResultData>[] = [];
    const snoozedMs = Math.max(0, (status.blockingSnoozedUntil || 0) - (status.now || 0));
    const isSnoozed = snoozedMs > 0;
    const supportsSnooze = status.blockingEnabled && status.blocklist.length > 0;

    results.push({
      id: 'focus.status',
      provider: id,
      title: formatSessionTitle(status.session),
      subtitle: buildStatusSubtitle(status),
      icon,
      data: { kind: 'status', status },
      score: 1000,
    });

    const phase = status.session.phase;
    if (phase === 'idle') {
      const presets = [25, 45, 60];
      for (let i = 0; i < presets.length; i++) {
        const m = presets[i];
        results.push({
          id: `focus.start.${m}`,
          provider: id,
          title: `Start focus: ${m}m`,
          subtitle: 'Starts a timer via background alarms',
          icon: '\u25B6\uFE0F', // ▶️
          data: { kind: 'start', minutes: m },
          score: 900 - i,
        });
      }
    } else if (phase === 'running') {
      results.push(
        {
          id: 'focus.pause',
          provider: id,
          title: 'Pause focus',
          subtitle: 'Pauses timer and disables blocking until resumed',
          icon: '\u23F8\uFE0F', // ⏸️
          data: { kind: 'pause' },
          score: 900,
        },
        {
          id: 'focus.extend.5',
          provider: id,
          title: 'Extend focus: +5m',
          subtitle: 'Adds 5 minutes to the current session',
          icon: '\u2795', // ➕
          data: { kind: 'extend', minutes: 5 },
          score: 850,
        },
        {
          id: 'focus.stop',
          provider: id,
          title: 'Stop focus',
          subtitle: 'Stops timer and clears blocking rules',
          icon: '\u23F9\uFE0F', // ⏹️
          data: { kind: 'stop' },
          score: 800,
        },
      );

      if (supportsSnooze && isSnoozed) {
        results.push(
          {
            id: 'focus.blocking.resume',
            provider: id,
            title: 'Resume site blocking now',
            subtitle: `Snoozed ${formatDuration(snoozedMs)} remaining`,
            icon: '\uD83D\uDEE1\uFE0F', // 🛡️
            data: { kind: 'resume_blocking' },
            score: 790,
          },
          {
            id: 'focus.blocking.snooze.5',
            provider: id,
            title: 'Extend blocking snooze: +5m',
            subtitle: 'Adds 5 minutes to the temporary unblock',
            icon: '\u2795', // ➕
            data: { kind: 'snooze_blocking', minutes: 5 },
            score: 780,
          },
        );
      } else if (supportsSnooze && status.blockingActive) {
        results.push(
          {
            id: 'focus.blocking.snooze.5',
            provider: id,
            title: 'Snooze site blocking: 5m',
            subtitle: 'Temporarily allow blocked domains',
            icon: '\u23F8\uFE0F', // ⏸️
            data: { kind: 'snooze_blocking', minutes: 5 },
            score: 790,
          },
          {
            id: 'focus.blocking.snooze.15',
            provider: id,
            title: 'Snooze site blocking: 15m',
            subtitle: 'Temporarily allow blocked domains',
            icon: '\u23F8\uFE0F', // ⏸️
            data: { kind: 'snooze_blocking', minutes: 15 },
            score: 780,
          },
        );
      }
    } else if (phase === 'paused') {
      results.push(
        {
          id: 'focus.resume',
          provider: id,
          title: 'Resume focus',
          subtitle: 'Resumes the paused timer',
          icon: '\u25B6\uFE0F', // ▶️
          data: { kind: 'resume' },
          score: 900,
        },
        {
          id: 'focus.extend.5',
          provider: id,
          title: 'Extend focus: +5m',
          subtitle: 'Adds 5 minutes (while paused)',
          icon: '\u2795', // ➕
          data: { kind: 'extend', minutes: 5 },
          score: 850,
        },
        {
          id: 'focus.stop',
          provider: id,
          title: 'Stop focus',
          subtitle: 'Stops the paused session',
          icon: '\u23F9\uFE0F', // ⏹️
          data: { kind: 'stop' },
          score: 800,
        },
      );
    }

    // Blocking toggle shortcut.
    results.push({
      id: 'focus.blocking.toggle',
      provider: id,
      title: status.blockingEnabled ? 'Disable site blocking' : 'Enable site blocking',
      subtitle:
        status.blocklist.length > 0
          ? `${status.blocklist.length} domains configured`
          : 'No domains configured',
      icon: '\uD83D\uDEAB', // 🚫
      data: { kind: 'set_blocking_enabled', enabled: !status.blockingEnabled },
      score: 700,
    });

    // Blocklist items (best-effort).
    for (const domain of status.blocklist.slice(0, 10)) {
      results.push({
        id: `focus.block.${domain}`,
        provider: id,
        title: domain,
        subtitle: 'Blocked domain',
        icon: '\uD83C\uDF10', // 🌐
        data: { kind: 'blocklist_domain', domain, blocklist: status.blocklist },
        score: 600,
      });
    }

    // Lightweight help hint.
    results.push({
      id: 'focus.help',
      provider: id,
      title:
        'Commands: start 25 | pause | resume | stop | extend 5 | snooze 5 | resume-blocking | block youtube.com twitter.com | blocking on/off',
      subtitle: 'Type after `focus `',
      icon: '\u2139\uFE0F', // ℹ️
      data: { kind: 'help' },
      score: 100,
    });

    return results;
  }

  async function search(ctx: SearchProviderContext): Promise<SearchResult<FocusResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.requestedScope !== 'focus') return [];

    const status = await client.status({ signal: ctx.signal });
    if (ctx.signal.aborted) return [];

    const tokens = ctx.query.tokens;
    if (tokens.length === 0) {
      return buildDefaultResults(status).slice(0, ctx.limit);
    }

    const [t0, ...rest] = tokens;
    const results: SearchResult<FocusResultData>[] = [];

    const directMinutes = parseMinutesToken(t0);
    if (directMinutes) {
      results.push({
        id: `focus.start.${directMinutes}`,
        provider: id,
        title: `Start focus: ${directMinutes}m`,
        subtitle: 'Starts a timer via background alarms',
        icon: '\u25B6\uFE0F',
        data: { kind: 'start', minutes: directMinutes },
        score: 1200,
      });
      results.push({
        id: 'focus.status',
        provider: id,
        title: formatSessionTitle(status.session),
        subtitle: buildStatusSubtitle(status),
        icon,
        data: { kind: 'status', status },
        score: 1000,
      });
      return results.slice(0, ctx.limit);
    }

    const cmd = String(t0 ?? '').toLowerCase();

    if (cmd === 'start') {
      const minutes = parseMinutesToken(rest[0]) ?? 25;
      results.push({
        id: `focus.start.${minutes}`,
        provider: id,
        title: `Start focus: ${minutes}m`,
        subtitle: 'Starts a timer via background alarms',
        icon: '\u25B6\uFE0F',
        data: { kind: 'start', minutes },
        score: 1200,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'stop') {
      results.push({
        id: 'focus.stop',
        provider: id,
        title: 'Stop focus',
        subtitle: 'Stops timer and clears blocking rules',
        icon: '\u23F9\uFE0F',
        data: { kind: 'stop' },
        score: 1200,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'pause') {
      results.push({
        id: 'focus.pause',
        provider: id,
        title: 'Pause focus',
        subtitle: 'Pauses timer and disables blocking until resumed',
        icon: '\u23F8\uFE0F',
        data: { kind: 'pause' },
        score: 1200,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'resume' || cmd === 'continue') {
      results.push({
        id: 'focus.resume',
        provider: id,
        title: 'Resume focus',
        subtitle: 'Resumes the paused timer',
        icon: '\u25B6\uFE0F',
        data: { kind: 'resume' },
        score: 1200,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'extend') {
      const minutes = parseMinutesToken(rest[0]) ?? 5;
      results.push({
        id: `focus.extend.${minutes}`,
        provider: id,
        title: `Extend focus: +${minutes}m`,
        subtitle: 'Adds time to the current session',
        icon: '\u2795',
        data: { kind: 'extend', minutes },
        score: 1200,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'snooze') {
      const minutes = parseMinutesToken(rest[0]) ?? 5;
      results.push({
        id: `focus.blocking.snooze.${minutes}`,
        provider: id,
        title: `Snooze site blocking: ${minutes}m`,
        subtitle: 'Temporarily allow blocked domains',
        icon: '\u23F8\uFE0F', // ⏸️
        data: { kind: 'snooze_blocking', minutes },
        score: 1200,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'resume-blocking' || cmd === 'unsnooze') {
      results.push({
        id: 'focus.blocking.resume',
        provider: id,
        title: 'Resume site blocking now',
        subtitle: 'Re-enables blocking immediately',
        icon: '\uD83D\uDEE1\uFE0F', // 🛡️
        data: { kind: 'resume_blocking' },
        score: 1200,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'blocking') {
      const next = String(rest[0] ?? '').toLowerCase();
      if (next === 'snooze' || next === 'pause') {
        const minutes = parseMinutesToken(rest[1]) ?? 5;
        results.push({
          id: `focus.blocking.snooze.${minutes}`,
          provider: id,
          title: `Snooze site blocking: ${minutes}m`,
          subtitle: 'Temporarily allow blocked domains',
          icon: '\u23F8\uFE0F', // ⏸️
          data: { kind: 'snooze_blocking', minutes },
          score: 1200,
        });
        return results.slice(0, ctx.limit);
      }
      if (next === 'resume' || next === 'now') {
        results.push({
          id: 'focus.blocking.resume',
          provider: id,
          title: 'Resume site blocking now',
          subtitle: 'Re-enables blocking immediately',
          icon: '\uD83D\uDEE1\uFE0F', // 🛡️
          data: { kind: 'resume_blocking' },
          score: 1200,
        });
        return results.slice(0, ctx.limit);
      }
      if (next === 'on' || next === 'true' || next === '1') {
        results.push({
          id: 'focus.blocking.on',
          provider: id,
          title: 'Enable site blocking',
          subtitle: 'Applies blocklist during running sessions',
          icon: '\uD83D\uDEAB',
          data: { kind: 'set_blocking_enabled', enabled: true },
          score: 1200,
        });
        return results.slice(0, ctx.limit);
      }
      if (next === 'off' || next === 'false' || next === '0') {
        results.push({
          id: 'focus.blocking.off',
          provider: id,
          title: 'Disable site blocking',
          subtitle: 'Does not apply blocklist rules',
          icon: '\uD83D\uDEAB',
          data: { kind: 'set_blocking_enabled', enabled: false },
          score: 1200,
        });
        return results.slice(0, ctx.limit);
      }

      results.push({
        id: 'focus.blocking.toggle',
        provider: id,
        title: status.blockingEnabled ? 'Disable site blocking' : 'Enable site blocking',
        subtitle: 'Use: blocking on/off | blocking snooze 5 | blocking resume',
        icon: '\uD83D\uDEAB',
        data: { kind: 'set_blocking_enabled', enabled: !status.blockingEnabled },
        score: 1100,
      });
      return results.slice(0, ctx.limit);
    }

    if (cmd === 'block' || cmd === 'blocklist') {
      const next = String(rest[0] ?? '').toLowerCase();
      if (next === 'clear' || next === 'off' || next === 'none') {
        results.push({
          id: 'focus.blocklist.clear',
          provider: id,
          title: 'Clear blocklist',
          subtitle: 'Removes all blocked domains',
          icon: '\u274C', // ❌
          data: { kind: 'set_blocklist', domains: [] },
          score: 1200,
        });
        return results.slice(0, ctx.limit);
      }

      const domains = rest
        .flatMap((t) => String(t ?? '').split(','))
        .map((t) => normalizeDomainToken(t))
        .filter((d): d is string => typeof d === 'string' && !!d);

      if (domains.length > 0) {
        results.push({
          id: 'focus.blocklist.set',
          provider: id,
          title: `Set blocklist: ${domains.join(', ')}`,
          subtitle: 'Updates stored blocklist (best-effort validation)',
          icon: '\uD83D\uDEAB',
          data: { kind: 'set_blocklist', domains },
          score: 1200,
        });
        return results.slice(0, ctx.limit);
      }

      // No args -> show status + current blocklist
      return buildDefaultResults(status).slice(0, ctx.limit);
    }

    // Fallback: show status + help (token scoring keeps it relevant)
    const helpScore = computeWeightedTokenScore([{ value: cmd, weight: 1, mode: 'text' }], tokens);
    results.push({
      id: 'focus.help',
      provider: id,
      title: 'Unknown focus command',
      subtitle:
        'Try: start 25 | pause | resume | stop | extend 5 | snooze 5 | resume-blocking | block youtube.com twitter.com | blocking on/off',
      icon: '\u2139\uFE0F',
      data: { kind: 'help' },
      score: 500 + helpScore,
    });
    results.push({
      id: 'focus.status',
      provider: id,
      title: formatSessionTitle(status.session),
      subtitle: buildStatusSubtitle(status),
      icon,
      data: { kind: 'status', status },
      score: 400,
    });

    return results.slice(0, ctx.limit);
  }

  return {
    id,
    name,
    icon,
    scopes: ['focus'],
    includeInAll: false,
    supportsEmptyQuery: true,
    search,
    getActions,
  };
}
