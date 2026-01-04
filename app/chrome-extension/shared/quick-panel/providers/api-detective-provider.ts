/**
 * API Detective Provider (Quick Panel)
 *
 * Scope:
 * - Commands-only provider, activated by typing `> api ...` (or `> detective ...`)
 *
 * Features:
 * - Start/stop a short-lived network capture session (background-managed)
 * - List captured requests from the last session
 * - Copy a request as `curl` / `fetch` snippet
 * - Replay a captured request (dangerous: may trigger side effects)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelApiDetectiveBackend,
  type QuickPanelApiDetectiveGetRequestResponse,
  type QuickPanelApiDetectiveListResponse,
  type QuickPanelApiDetectiveReplayRequestResponse,
  type QuickPanelApiDetectiveStartResponse,
  type QuickPanelApiDetectiveStatusResponse,
  type QuickPanelApiDetectiveStopResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { toCurlCommand, toFetchSnippet } from '../core/api-detective-snippets';
import { computeWeightedTokenScore, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type ApiDetectiveResultData =
  | {
      kind: 'command';
      command: 'status' | 'start' | 'start_body' | 'stop';
    }
  | {
      kind: 'request';
      requestId: string;
      method: string;
      url: string;
      type?: string;
      status?: number;
      mimeType?: string;
      backend: QuickPanelApiDetectiveBackend | null;
      capturedAt: number | null;
      tabUrl: string | null;
    };

interface ApiDetectiveClient {
  status: () => Promise<QuickPanelApiDetectiveStatusResponse>;
  start: (options: { needResponseBody: boolean }) => Promise<QuickPanelApiDetectiveStartResponse>;
  stop: () => Promise<QuickPanelApiDetectiveStopResponse>;
  list: (options: {
    query?: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelApiDetectiveListResponse>;
  getRequest: (options: { requestId: string }) => Promise<QuickPanelApiDetectiveGetRequestResponse>;
  replay: (options: { requestId: string }) => Promise<QuickPanelApiDetectiveReplayRequestResponse>;
}

// ============================================================
// Helpers
// ============================================================

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function parseActivation(
  tokens: readonly string[],
  raw: string,
): { active: boolean; query: string; queryTokens: string[] } {
  const first = (tokens[0] || '').toLowerCase();
  if (first !== 'api' && first !== 'detective')
    return { active: false, query: '', queryTokens: [] };

  const trimmed = String(raw ?? '').trim();
  const query = trimmed.replace(/^(api|detective)\b/i, '').trim();
  const queryTokens = tokens.slice(1);
  return { active: true, query, queryTokens };
}

function formatHostPath(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname || '/'}${u.search || ''}`;
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}

function formatStatus(status?: number): string {
  if (typeof status === 'number' && Number.isFinite(status)) return String(status);
  return '';
}

function createRuntimeClient(): ApiDetectiveClient {
  async function send<T>(type: string, payload: unknown): Promise<T> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    return (await chrome.runtime.sendMessage({ type, payload })) as T;
  }

  return {
    status: () =>
      send<QuickPanelApiDetectiveStatusResponse>(
        BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STATUS,
        {},
      ),
    start: (options) =>
      send<QuickPanelApiDetectiveStartResponse>(
        BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_START,
        {
          needResponseBody: options.needResponseBody,
          includeStatic: false,
          maxCaptureTimeMs: 180_000,
        },
      ),
    stop: () =>
      send<QuickPanelApiDetectiveStopResponse>(
        BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STOP,
        {},
      ),
    list: (options) =>
      options.signal.aborted
        ? Promise.reject(new Error('aborted'))
        : send<QuickPanelApiDetectiveListResponse>(
            BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_LIST,
            {
              query: options.query || undefined,
              maxResults: options.maxResults,
            },
          ),
    getRequest: (options) =>
      send<QuickPanelApiDetectiveGetRequestResponse>(
        BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_GET_REQUEST,
        { requestId: options.requestId },
      ),
    replay: (options) =>
      send<QuickPanelApiDetectiveReplayRequestResponse>(
        BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_REPLAY_REQUEST,
        { requestId: options.requestId, timeoutMs: 30_000 },
      ),
  };
}

// ============================================================
// Provider Factory
// ============================================================

export function createApiDetectiveProvider(): SearchProvider<ApiDetectiveResultData> {
  const id = 'api_detective';
  const name = 'API Detective';
  const icon = '\uD83D\uDD75\uFE0F'; // 🕵️

  const client = createRuntimeClient();

  function getActions(
    item: SearchResult<ApiDetectiveResultData>,
  ): Action<ApiDetectiveResultData>[] {
    const data = item.data;

    if (data.kind === 'command') {
      const cmd = data.command;
      if (cmd === 'start') {
        return [
          {
            id: 'api_detective.start',
            title: 'Start capture',
            hotkeyHint: 'Enter',
            execute: async () => {
              const resp = await client.start({ needResponseBody: false });
              if (!resp || resp.success !== true) {
                const err = (resp as any)?.error;
                throw new Error(typeof err === 'string' ? err : 'Failed to start capture');
              }
            },
          },
        ];
      }
      if (cmd === 'start_body') {
        return [
          {
            id: 'api_detective.start_body',
            title: 'Start capture (include response bodies)',
            tone: 'danger',
            hotkeyHint: 'Enter',
            execute: async () => {
              const resp = await client.start({ needResponseBody: true });
              if (!resp || resp.success !== true) {
                const err = (resp as any)?.error;
                throw new Error(typeof err === 'string' ? err : 'Failed to start capture');
              }
            },
          },
        ];
      }
      if (cmd === 'stop') {
        return [
          {
            id: 'api_detective.stop',
            title: 'Stop capture',
            hotkeyHint: 'Enter',
            execute: async () => {
              const resp = await client.stop();
              if (!resp || resp.success !== true) {
                const err = (resp as any)?.error;
                throw new Error(typeof err === 'string' ? err : 'Failed to stop capture');
              }
            },
          },
        ];
      }

      return [
        {
          id: 'api_detective.status',
          title: 'Refresh status',
          hotkeyHint: 'Enter',
          execute: async () => {
            const resp = await client.status();
            if (!resp || resp.success !== true) {
              const err = (resp as any)?.error;
              throw new Error(typeof err === 'string' ? err : 'Failed to get status');
            }
          },
        },
      ];
    }

    const requestId = data.requestId;

    return [
      {
        id: 'api_detective.copy_curl',
        title: 'Copy as curl',
        hotkeyHint: 'Enter',
        execute: async () => {
          const resp = await client.getRequest({ requestId });
          if (!resp || resp.success !== true) {
            const err = (resp as any)?.error;
            throw new Error(typeof err === 'string' ? err : 'Failed to get request details');
          }
          const req = resp.request;
          const curl = toCurlCommand({
            method: req.method,
            url: req.url,
            headers: req.requestHeaders,
            body: req.requestBody,
          });
          await writeToClipboard(curl, {
            source: 'api_detective.copy.curl',
            label: `${req.method} ${req.url}`,
          });
        },
      },
      {
        id: 'api_detective.copy_fetch',
        title: 'Copy as fetch',
        execute: async () => {
          const resp = await client.getRequest({ requestId });
          if (!resp || resp.success !== true) {
            const err = (resp as any)?.error;
            throw new Error(typeof err === 'string' ? err : 'Failed to get request details');
          }
          const req = resp.request;
          const snippet = toFetchSnippet({
            method: req.method,
            url: req.url,
            headers: req.requestHeaders,
            body: req.requestBody,
          });
          await writeToClipboard(snippet, {
            source: 'api_detective.copy.fetch',
            label: `${req.method} ${req.url}`,
          });
        },
      },
      {
        id: 'api_detective.replay',
        title: 'Replay request',
        subtitle: 'May cause side effects on the server',
        tone: 'danger',
        execute: async () => {
          const resp = await client.replay({ requestId });
          if (!resp || resp.success !== true) {
            const err = (resp as any)?.error;
            throw new Error(typeof err === 'string' ? err : 'Request replay failed');
          }
        },
      },
    ];
  }

  async function search(
    ctx: SearchProviderContext,
  ): Promise<SearchResult<ApiDetectiveResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.requestedScope !== 'commands') return [];
    if (ctx.query.tokens.length === 0) return [];

    const activation = parseActivation(ctx.query.tokens, ctx.query.raw);
    if (!activation.active) return [];

    const results: SearchResult<ApiDetectiveResultData>[] = [];

    const [statusOut, listOut] = await Promise.allSettled([
      client.status(),
      client.list({
        query: activation.query || undefined,
        maxResults: Math.max(10, ctx.limit * 5),
        signal: ctx.signal,
      }),
    ]);

    const status =
      statusOut.status === 'fulfilled' && statusOut.value && statusOut.value.success === true
        ? statusOut.value
        : null;
    const list =
      listOut.status === 'fulfilled' && listOut.value && listOut.value.success === true
        ? listOut.value
        : null;

    const active = status?.active === true || list?.active === true;
    const backend = status?.backend ?? list?.backend ?? null;
    const capturedAt = list?.capturedAt ?? status?.lastCaptureAt ?? null;
    const tabUrl = list?.tabUrl ?? null;

    // Status entry (always visible when activated)
    {
      const subtitleParts: string[] = [];
      subtitleParts.push(active ? 'Active' : 'Inactive');
      if (backend) subtitleParts.push(`backend: ${backend}`);
      if (capturedAt) subtitleParts.push(`last: ${new Date(capturedAt).toLocaleTimeString()}`);
      if (status?.lastRequestCount) subtitleParts.push(`${status.lastRequestCount} requests`);

      results.push({
        id: 'api_detective.status',
        provider: id,
        title: 'API Detective',
        subtitle: subtitleParts.join(' \u00B7 '),
        icon,
        data: { kind: 'command', command: 'status' },
        score: 1000,
      });
    }

    // Start/Stop entries
    results.push({
      id: 'api_detective.start',
      provider: id,
      title: 'Start capture',
      subtitle: 'Capture request metadata (no response body)',
      icon: '\u25B6\uFE0F', // ▶️
      data: { kind: 'command', command: 'start' },
      score: active ? 200 : 900,
    });

    results.push({
      id: 'api_detective.start_body',
      provider: id,
      title: 'Start capture (include response bodies)',
      subtitle: 'High risk: uses debugger backend and may capture sensitive data',
      icon: '\u26A0\uFE0F', // ⚠️
      data: { kind: 'command', command: 'start_body' },
      score: active ? 150 : 850,
    });

    results.push({
      id: 'api_detective.stop',
      provider: id,
      title: 'Stop capture',
      subtitle: active ? 'Stop capture and save as last session' : 'No active capture for this tab',
      icon: '\u23F9\uFE0F', // ⏹️
      data: { kind: 'command', command: 'stop' },
      score: active ? 880 : 50,
    });

    // Request list entries (last capture)
    const items = Array.isArray(list?.items) ? list!.items : [];
    const filterTokens = activation.queryTokens;

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const title = `${it.method} ${formatHostPath(it.url)}`;
      const statusText = formatStatus(it.status);
      const subtitleParts = [statusText, it.type || '', it.mimeType || ''].filter((s) => s);
      const subtitle = subtitleParts.join(' \u00B7 ');

      const scoreBase =
        filterTokens.length === 0
          ? 200 - idx
          : computeWeightedTokenScore(
              [
                { value: `${it.method} ${it.url}`, weight: 0.9, mode: 'text' },
                { value: `${it.type || ''} ${it.mimeType || ''}`, weight: 0.1, mode: 'text' },
              ],
              filterTokens,
            );
      if (scoreBase <= 0) continue;

      results.push({
        id: `api_detective.req.${it.requestId}`,
        provider: id,
        title,
        subtitle,
        icon: '\uD83D\uDCE1', // 📡
        data: {
          kind: 'request',
          requestId: it.requestId,
          method: it.method,
          url: it.url,
          type: it.type,
          status: it.status,
          mimeType: it.mimeType,
          backend,
          capturedAt,
          tabUrl,
        },
        score: scoreBase,
      });
    }

    // Surface transport errors as a single result to keep UI discoverable.
    if (statusOut.status === 'rejected' || listOut.status === 'rejected') {
      const err = safeErrorMessage(
        statusOut.status === 'rejected'
          ? statusOut.reason
          : listOut.status === 'rejected'
            ? listOut.reason
            : '',
      );
      results.push({
        id: 'api_detective.error',
        provider: id,
        title: 'API Detective error',
        subtitle: err || 'Failed to communicate with background',
        icon: '\u26A0\uFE0F', // ⚠️
        data: { kind: 'command', command: 'status' },
        score: 1,
      });
    }

    return results.slice(0, ctx.limit);
  }

  return {
    id,
    name,
    icon,
    scopes: ['commands'],
    includeInAll: false,
    priority: 5,
    maxResults: 50,
    supportsEmptyQuery: false,
    search,
    getActions,
  };
}
