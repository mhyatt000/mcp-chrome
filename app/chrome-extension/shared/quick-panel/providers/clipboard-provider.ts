/**
 * Clipboard Provider (Quick Panel)
 *
 * Provides clipboard history recorded from Quick Panel copy actions.
 *
 * Scope:
 * - Prefix-only scope: `clip `
 * - Not included in 'all' scope (privacy + noise)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelClipboardDeleteResponse,
  type QuickPanelClipboardGetResponse,
  type QuickPanelClipboardItemSummary,
  type QuickPanelClipboardListResponse,
  type QuickPanelClipboardSetPinnedResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { computeWeightedTokenScore, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type ClipboardResultData =
  | {
      kind: 'clipboard';
      id: string;
      preview: string;
      pinned: boolean;
      createdAt: number;
      updatedAt: number;
      incognito: boolean;
      source?: string;
      label?: string;
      originUrl?: string;
      originTitle?: string;
      byteLength: number;
      stored: boolean;
      copyCount: number;
    }
  | {
      kind: 'empty';
    };

interface ClipboardClient {
  list: (options: {
    query?: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelClipboardItemSummary[]>;
  get: (options: { id: string }) => Promise<{ value: string | null; stored: boolean }>;
  setPinned: (options: { id: string; pinned: boolean }) => Promise<void>;
  delete: (options: { id: string }) => Promise<void>;
}

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
  const n = typeof bytes === 'number' && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round((n / 1024) * 10) / 10}KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10}MB`;
}

function formatHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function computeRecencyScore(updatedAt: number, now: number): number {
  const ageMs = Math.max(0, now - (updatedAt || 0));
  const ageHours = ageMs / (1000 * 60 * 60);
  return Math.max(0, Math.min(20, 20 - ageHours / 24));
}

function buildSubtitle(item: QuickPanelClipboardItemSummary): string {
  const parts: string[] = [];
  if (item.pinned) parts.push('Pinned');
  if (item.source) parts.push(item.source);
  const host = formatHost(item.originUrl);
  if (host) parts.push(host);
  parts.push(formatBytes(item.byteLength));
  if (!item.stored) parts.push('Not stored');
  return parts.filter((p) => p).join(' \u00B7 ');
}

function createRuntimeClient(): ClipboardClient {
  async function send<T>(type: string, payload: unknown): Promise<T> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    return (await chrome.runtime.sendMessage({ type, payload })) as T;
  }

  async function list(options: {
    query?: string;
    maxResults: number;
    signal: AbortSignal;
  }): Promise<QuickPanelClipboardItemSummary[]> {
    if (options.signal.aborted) throw new Error('aborted');

    const resp = await send<QuickPanelClipboardListResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_LIST,
      { query: options.query, maxResults: options.maxResults },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to list clipboard history');
    }

    return Array.isArray(resp.items) ? resp.items : [];
  }

  async function get(options: { id: string }): Promise<{ value: string | null; stored: boolean }> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelClipboardGetResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_GET,
      { id },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to get clipboard item');
    }

    return { value: resp.item.value ?? null, stored: resp.item.stored === true };
  }

  async function setPinned(options: { id: string; pinned: boolean }): Promise<void> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelClipboardSetPinnedResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_SET_PINNED,
      { id, pinned: options.pinned === true },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to update pin state');
    }
  }

  async function del(options: { id: string }): Promise<void> {
    const id = String(options.id ?? '').trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelClipboardDeleteResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_DELETE,
      { id },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to delete clipboard item');
    }
  }

  return { list, get, setPinned, delete: del };
}

// ============================================================
// Provider Factory
// ============================================================

export function createClipboardProvider(): SearchProvider<ClipboardResultData> {
  const id = 'clipboard';
  const name = 'Clipboard';
  const icon = '\uD83D\uDCCB'; // 📋

  const client = createRuntimeClient();

  function getActions(item: SearchResult<ClipboardResultData>): Action<ClipboardResultData>[] {
    const data = item.data;
    if (data.kind !== 'clipboard') return [];

    const primaryCopy: Action<ClipboardResultData> = {
      id: 'clipboard.copy',
      title: 'Copy',
      hotkeyHint: 'Enter',
      execute: async () => {
        const detail = await client.get({ id: data.id });
        if (!detail.stored || !detail.value) {
          throw new Error(
            'This item was not stored (too large). Copy it again from the original source.',
          );
        }
        await writeToClipboard(detail.value, {
          source: 'clipboard.history.copy',
          label: data.label,
        });
      },
    };

    const pinAction: Action<ClipboardResultData> = {
      id: 'clipboard.togglePin',
      title: data.pinned ? 'Unpin' : 'Pin',
      execute: async () => {
        await client.setPinned({ id: data.id, pinned: !data.pinned });
      },
    };

    const deleteAction: Action<ClipboardResultData> = {
      id: 'clipboard.delete',
      title: 'Delete',
      tone: 'danger',
      execute: async () => {
        await client.delete({ id: data.id });
      },
    };

    return [primaryCopy, pinAction, deleteAction];
  }

  async function search(ctx: SearchProviderContext): Promise<SearchResult<ClipboardResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.requestedScope !== 'clipboard') return [];

    const raw = String(ctx.query.raw ?? '');
    const trimmed = raw.trim();
    const tokens = ctx.query.tokens;

    const maxResults = Math.min(200, Math.max(20, ctx.limit * 8));
    const items = await client.list({
      query: trimmed || undefined,
      maxResults,
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) return [];

    const now = ctx.now;
    const results: Array<{ result: SearchResult<ClipboardResultData>; score: number }> = [];

    for (const it of items) {
      const baseScore =
        tokens.length === 0
          ? 200 + computeRecencyScore(it.updatedAt, now) + (it.pinned ? 50 : 0)
          : computeWeightedTokenScore(
              [
                { value: it.preview, weight: 0.8, mode: 'text' },
                { value: it.label || '', weight: 0.15, mode: 'text' },
                { value: it.source || '', weight: 0.05, mode: 'text' },
              ],
              tokens,
            ) + (it.pinned ? 10 : 0);

      if (baseScore <= 0) continue;

      results.push({
        score: baseScore,
        result: {
          id: `clip.${it.id}`,
          provider: id,
          title: it.preview,
          subtitle: buildSubtitle(it),
          icon,
          data: {
            kind: 'clipboard',
            id: it.id,
            preview: it.preview,
            pinned: it.pinned,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
            incognito: it.incognito,
            source: it.source,
            label: it.label,
            originUrl: it.originUrl,
            originTitle: it.originTitle,
            byteLength: it.byteLength,
            stored: it.stored,
            copyCount: it.copyCount,
          },
          score: baseScore,
        },
      });
    }

    results.sort((a, b) => b.score - a.score);

    // Provide a helpful empty state entry for first-time users.
    if (results.length === 0 && tokens.length === 0) {
      results.push({
        score: 1,
        result: {
          id: 'clip.empty',
          provider: id,
          title: 'No clipboard history yet',
          subtitle: 'Copy something via Quick Panel to start building history',
          icon,
          data: { kind: 'empty' },
          score: 1,
        },
      });
    }

    return results.map((r) => r.result).slice(0, ctx.limit);
  }

  return {
    id,
    name,
    icon,
    scopes: ['clipboard'],
    includeInAll: false,
    priority: 5,
    maxResults: 50,
    supportsEmptyQuery: true,
    search,
    getActions,
    dispose: () => {
      // No-op
    },
  };
}
