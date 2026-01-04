/**
 * Web Monitor / Price Track Provider (Quick Panel)
 *
 * Scope:
 * - Prefix-only scope: `mon `
 * - Not included in 'all' scope (privacy + noise)
 *
 * Notes:
 * - This provider is UI-only. All scheduling and extraction happens in the background handler.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelMonitorAlert,
  type QuickPanelMonitorAlertDeleteResponse,
  type QuickPanelMonitorAlertMarkReadResponse,
  type QuickPanelMonitorCreateResponse,
  type QuickPanelMonitorListResponse,
  type QuickPanelMonitorSetEnabledResponse,
  type QuickPanelMonitorSummary,
  type QuickPanelMonitorCheckNowResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { openUrl, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type MonitorResultData =
  | { kind: 'summary'; unreadCount: number; monitorCount: number; alertCount: number }
  | { kind: 'monitor'; monitor: QuickPanelMonitorSummary }
  | { kind: 'alert'; alert: QuickPanelMonitorAlert }
  | { kind: 'create'; url: string; selector: string }
  | { kind: 'empty' }
  | { kind: 'help' };

interface MonitorClient {
  list: (options: {
    query?: string;
    maxMonitors: number;
    maxAlerts: number;
    signal: AbortSignal;
  }) => Promise<{
    monitors: QuickPanelMonitorSummary[];
    alerts: QuickPanelMonitorAlert[];
    unreadCount: number;
  }>;
  create: (options: {
    url: string;
    selector: string;
    intervalMinutes: number;
  }) => Promise<QuickPanelMonitorSummary>;
  delete: (options: { id: string }) => Promise<void>;
  setEnabled: (options: { id: string; enabled: boolean }) => Promise<QuickPanelMonitorSummary>;
  checkNow: (options: {
    id: string;
  }) => Promise<{ monitor: QuickPanelMonitorSummary; alertCreated?: QuickPanelMonitorAlert }>;
  alertMarkRead: (options: { id: string; read: boolean }) => Promise<number>;
  alertDelete: (options: { id: string }) => Promise<number>;
}

// ============================================================
// Helpers
// ============================================================

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function normalizeUrlInput(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    if (!raw.includes('.') || raw.includes(' ')) return null;
    try {
      const u = new URL(`https://${raw}`);
      u.hash = '';
      return u.toString();
    } catch {
      return null;
    }
  }
}

function formatHost(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function formatTime(ts: number): string | null {
  const n = typeof ts === 'number' && Number.isFinite(ts) ? ts : 0;
  if (n <= 0) return null;
  try {
    return new Date(n).toLocaleString();
  } catch {
    return null;
  }
}

function buildMonitorSubtitle(m: QuickPanelMonitorSummary): string {
  const parts: string[] = [];
  parts.push(`${m.intervalMinutes}m`);
  parts.push(m.enabled ? 'Enabled' : 'Paused');
  if (m.unreadAlerts > 0) parts.push(`${m.unreadAlerts} unread`);
  const last = formatTime(m.lastCheckedAt);
  if (last) parts.push(`Checked: ${last}`);
  if (m.lastError) parts.push(`Error: ${m.lastError}`);
  return parts.join(' \u00B7 ');
}

function buildAlertTitle(a: QuickPanelMonitorAlert): string {
  const host = formatHost(a.url);
  return a.read ? `Change (read): ${host}` : `Change: ${host}`;
}

function buildAlertSubtitle(a: QuickPanelMonitorAlert): string {
  const parts: string[] = [];
  parts.push(a.selector);
  const when = formatTime(a.createdAt);
  if (when) parts.push(when);
  if (!a.read) parts.push('Unread');
  return parts.join(' \u00B7 ');
}

function createRuntimeClient(): MonitorClient {
  async function send<T>(type: string, payload: unknown): Promise<T> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    return (await chrome.runtime.sendMessage({ type, payload })) as T;
  }

  async function list(options: {
    query?: string;
    maxMonitors: number;
    maxAlerts: number;
    signal: AbortSignal;
  }): Promise<{
    monitors: QuickPanelMonitorSummary[];
    alerts: QuickPanelMonitorAlert[];
    unreadCount: number;
  }> {
    if (options.signal.aborted) throw new Error('aborted');

    const resp = await send<QuickPanelMonitorListResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_LIST,
      {
        query: options.query,
        maxMonitors: options.maxMonitors,
        maxAlerts: options.maxAlerts,
      },
    );

    if (!resp || resp.success !== true) {
      throw new Error((resp as any)?.error || 'Failed to list monitors');
    }

    return {
      monitors: Array.isArray(resp.monitors) ? resp.monitors : [],
      alerts: Array.isArray(resp.alerts) ? resp.alerts : [],
      unreadCount: typeof resp.unreadCount === 'number' ? resp.unreadCount : 0,
    };
  }

  async function create(options: {
    url: string;
    selector: string;
    intervalMinutes: number;
  }): Promise<QuickPanelMonitorSummary> {
    const resp = await send<QuickPanelMonitorCreateResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CREATE,
      {
        url: options.url,
        selector: options.selector,
        intervalMinutes: options.intervalMinutes,
        fetchNow: true,
      },
    );

    if (!resp || resp.success !== true) {
      throw new Error((resp as any)?.error || 'Failed to create monitor');
    }
    return resp.monitor;
  }

  async function del(options: { id: string }): Promise<void> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<{ success: boolean; error?: string }>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_DELETE,
      { id },
    );
    if (!resp || resp.success !== true) {
      throw new Error((resp as any)?.error || 'Failed to delete monitor');
    }
  }

  async function setEnabled(options: {
    id: string;
    enabled: boolean;
  }): Promise<QuickPanelMonitorSummary> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelMonitorSetEnabledResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_SET_ENABLED,
      { id, enabled: options.enabled === true },
    );
    if (!resp || resp.success !== true) {
      throw new Error((resp as any)?.error || 'Failed to update monitor');
    }
    return resp.monitor;
  }

  async function checkNow(options: {
    id: string;
  }): Promise<{ monitor: QuickPanelMonitorSummary; alertCreated?: QuickPanelMonitorAlert }> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelMonitorCheckNowResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CHECK_NOW,
      { id },
    );
    if (!resp || resp.success !== true) {
      throw new Error((resp as any)?.error || 'Failed to check monitor');
    }
    return { monitor: resp.monitor, alertCreated: resp.alertCreated };
  }

  async function alertMarkRead(options: { id: string; read: boolean }): Promise<number> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelMonitorAlertMarkReadResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_MARK_READ,
      { id, read: options.read === true },
    );
    if (!resp || resp.success !== true) {
      throw new Error((resp as any)?.error || 'Failed to update alert');
    }
    return typeof resp.unreadCount === 'number' ? resp.unreadCount : 0;
  }

  async function alertDelete(options: { id: string }): Promise<number> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelMonitorAlertDeleteResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_DELETE,
      { id },
    );
    if (!resp || resp.success !== true) {
      throw new Error((resp as any)?.error || 'Failed to delete alert');
    }
    return typeof resp.unreadCount === 'number' ? resp.unreadCount : 0;
  }

  return { list, create, delete: del, setEnabled, checkNow, alertMarkRead, alertDelete };
}

// ============================================================
// Provider Factory
// ============================================================

export function createMonitorProvider(): SearchProvider<MonitorResultData> {
  const id = 'monitor';
  const name = 'Monitor';
  const icon = '\uD83D\uDC40'; // 👀

  const client = createRuntimeClient();

  function getActions(item: SearchResult<MonitorResultData>): Action<MonitorResultData>[] {
    const data = item.data;

    if (data.kind === 'create') {
      const presets = [15, 60, 24 * 60];
      return presets.map((minutes, idx) => ({
        id: `monitor.create.${minutes}`,
        title: idx === 0 ? `Create monitor (${minutes}m)` : `Create (${minutes}m)`,
        hotkeyHint: idx === 0 ? 'Enter' : undefined,
        execute: async () => {
          await client.create({ url: data.url, selector: data.selector, intervalMinutes: minutes });
        },
      }));
    }

    if (data.kind === 'monitor') {
      const monitor = data.monitor;
      return [
        {
          id: 'monitor.checkNow',
          title: 'Check now',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.checkNow({ id: monitor.id });
          },
        },
        {
          id: 'monitor.open',
          title: 'Open page',
          execute: async (ctx) => {
            await openUrl({ url: monitor.url, disposition: ctx.openMode ?? 'current_tab' });
          },
        },
        {
          id: 'monitor.toggleEnabled',
          title: monitor.enabled ? 'Pause' : 'Resume',
          execute: async () => {
            await client.setEnabled({ id: monitor.id, enabled: !monitor.enabled });
          },
        },
        {
          id: 'monitor.copySelector',
          title: 'Copy selector',
          execute: async () => {
            await writeToClipboard(monitor.selector, {
              source: 'monitor.copy.selector',
              label: 'Monitor selector',
            });
          },
        },
        {
          id: 'monitor.delete',
          title: 'Delete monitor',
          tone: 'danger',
          execute: async () => {
            await client.delete({ id: monitor.id });
          },
        },
      ];
    }

    if (data.kind === 'alert') {
      const alert = data.alert;
      return [
        {
          id: 'monitor.alert.open',
          title: 'Open page',
          hotkeyHint: 'Enter',
          execute: async (ctx) => {
            await openUrl({ url: alert.url, disposition: ctx.openMode ?? 'current_tab' });
          },
        },
        {
          id: 'monitor.alert.markRead',
          title: alert.read ? 'Mark as unread' : 'Mark as read',
          execute: async () => {
            await client.alertMarkRead({ id: alert.id, read: !alert.read });
          },
        },
        {
          id: 'monitor.alert.copyNew',
          title: 'Copy new value',
          execute: async () => {
            await writeToClipboard(alert.newValue ?? '', {
              source: 'monitor.alert.copy.new',
              label: 'Monitor value',
            });
          },
        },
        {
          id: 'monitor.alert.delete',
          title: 'Delete alert',
          tone: 'danger',
          execute: async () => {
            await client.alertDelete({ id: alert.id });
          },
        },
      ];
    }

    return [];
  }

  async function search(ctx: SearchProviderContext): Promise<SearchResult<MonitorResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.requestedScope !== 'monitor') return [];

    const raw = String(ctx.query.raw ?? '').trim();

    const maxMonitors = Math.min(120, Math.max(20, ctx.limit * 6));
    const maxAlerts = Math.min(120, Math.max(20, ctx.limit * 6));

    const list = await client.list({
      query: raw || undefined,
      maxMonitors,
      maxAlerts,
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) return [];

    const results: SearchResult<MonitorResultData>[] = [];

    results.push({
      id: 'monitor.summary',
      provider: id,
      title: list.unreadCount > 0 ? `Monitor alerts: ${list.unreadCount} unread` : 'Monitor',
      subtitle: `${list.monitors.length} monitors \u00B7 ${list.alerts.length} recent alerts`,
      icon,
      data: {
        kind: 'summary',
        unreadCount: list.unreadCount,
        monitorCount: list.monitors.length,
        alertCount: list.alerts.length,
      },
      score: 1000,
    });

    // Virtual create entry from `add <url> <selector>` or `<url> <selector>`.
    const createRaw =
      raw.toLowerCase().startsWith('add ') || raw.toLowerCase().startsWith('create ')
        ? raw.split(/\s+/).slice(1).join(' ').trim()
        : raw;

    if (createRaw) {
      const first = createRaw.split(/\s+/)[0] || '';
      const url = normalizeUrlInput(first);
      const selector = createRaw.slice(first.length).trimStart();
      if (url && selector) {
        results.push({
          id: `monitor.create.${url}`,
          provider: id,
          title: `Create monitor: ${formatHost(url)}`,
          subtitle: selector,
          icon: '\u2795', // ➕
          data: { kind: 'create', url, selector },
          score: 990,
        });
      }
    }

    // Alerts first (unread boosted).
    for (const alert of list.alerts) {
      results.push({
        id: `monitor.alert.${alert.id}`,
        provider: id,
        title: buildAlertTitle(alert),
        subtitle: buildAlertSubtitle(alert),
        icon: alert.read ? '\uD83D\uDCE9' : '\uD83D\uDCE8', // 📩/📨
        data: { kind: 'alert', alert },
        score: alert.read ? 700 : 900,
      });
    }

    // Monitors.
    for (const monitor of list.monitors) {
      results.push({
        id: `monitor.${monitor.id}`,
        provider: id,
        title: `${formatHost(monitor.url)} \u2192 ${monitor.selector}`,
        subtitle: buildMonitorSubtitle(monitor),
        icon: monitor.enabled ? '\uD83D\uDFE2' : '\u23F8\uFE0F', // 🟢 / ⏸️
        data: { kind: 'monitor', monitor },
        score: monitor.unreadAlerts > 0 ? 850 : 600,
      });
    }

    if (results.length === 1 && !raw) {
      results.push({
        id: 'monitor.empty',
        provider: id,
        title: 'No monitors yet',
        subtitle: 'Create one: `mon https://example.com .price`',
        icon: '\u2139\uFE0F',
        data: { kind: 'empty' },
        score: 500,
      });
    }

    if (raw) {
      results.push({
        id: 'monitor.help',
        provider: id,
        title: 'Create: `mon <url> <selector>`  (example: `mon https://example.com .price`)',
        subtitle: 'Actions: Tab to manage monitors and alerts',
        icon: '\u2139\uFE0F',
        data: { kind: 'help' },
        score: 100,
      });
    }

    return results.slice(0, Math.max(5, ctx.limit));
  }

  return {
    id,
    name,
    icon,
    scopes: ['monitor'],
    includeInAll: false,
    supportsEmptyQuery: true,
    search,
    getActions,
  };
}
