/**
 * Notes Provider (Quick Panel)
 *
 * Provides local-first quick notes via background storage bridge.
 *
 * Scope:
 * - Prefix-only scope: `note `
 * - Not included in 'all' scope (privacy + noise)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelNoteSummary,
  type QuickPanelNotesCreateResponse,
  type QuickPanelNotesDeleteResponse,
  type QuickPanelNotesGetResponse,
  type QuickPanelNotesListResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { computeWeightedTokenScore, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type NotesResultData =
  | {
      kind: 'note';
      id: string;
      title: string;
      preview: string;
      createdAt: number;
      updatedAt: number;
      incognito: boolean;
    }
  | {
      kind: 'create';
      content: string;
    }
  | { kind: 'empty' };

interface NotesClient {
  list: (options: {
    query?: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelNoteSummary[]>;
  get: (options: { id: string }) => Promise<string>;
  create: (options: { content: string }) => Promise<QuickPanelNoteSummary>;
  delete: (options: { id: string }) => Promise<void>;
}

// ============================================================
// Helpers
// ============================================================

function formatTime(ts: number): string | null {
  const n = typeof ts === 'number' && Number.isFinite(ts) ? ts : 0;
  if (n <= 0) return null;
  try {
    return new Date(n).toLocaleString();
  } catch {
    return null;
  }
}

function buildSubtitle(note: QuickPanelNoteSummary): string {
  const parts: string[] = [];
  if (note.preview && note.preview !== note.title) parts.push(note.preview);
  const time = formatTime(note.updatedAt);
  if (time) parts.push(time);
  return parts.filter((p) => p).join(' \u00B7 ');
}

function computeRecencyScore(updatedAt: number, now: number): number {
  const ageMs = Math.max(0, now - (updatedAt || 0));
  const ageHours = ageMs / (1000 * 60 * 60);
  return Math.max(0, Math.min(20, 20 - ageHours / 24));
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function createRuntimeClient(): NotesClient {
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
  }): Promise<QuickPanelNoteSummary[]> {
    if (options.signal.aborted) throw new Error('aborted');

    const resp = await send<QuickPanelNotesListResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_LIST,
      { query: options.query, maxResults: options.maxResults },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to list notes');
    }

    return Array.isArray(resp.items) ? resp.items : [];
  }

  async function get(options: { id: string }): Promise<string> {
    const id = normalizeString(options.id).trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelNotesGetResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_GET,
      { id },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to get note');
    }

    return normalizeString(resp.note.content);
  }

  async function create(options: { content: string }): Promise<QuickPanelNoteSummary> {
    const content = normalizeString(options.content);
    if (!content.trim()) throw new Error('content is required');

    const resp = await send<QuickPanelNotesCreateResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_CREATE,
      { content },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to create note');
    }

    return resp.note;
  }

  async function del(options: { id: string }): Promise<void> {
    const id = normalizeString(options.id).trim();
    if (!id) throw new Error('id is required');

    const resp = await send<QuickPanelNotesDeleteResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_DELETE,
      { id },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to delete note');
    }
  }

  return { list, get, create, delete: del };
}

// ============================================================
// Provider Factory
// ============================================================

export function createNotesProvider(): SearchProvider<NotesResultData> {
  const id = 'notes';
  const name = 'Notes';
  const icon = '\uD83D\uDCDD'; // 📝

  const client = createRuntimeClient();

  function getActions(item: SearchResult<NotesResultData>): Action<NotesResultData>[] {
    const data = item.data;

    if (data.kind === 'create') {
      return [
        {
          id: 'notes.create',
          title: 'Create note',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.create({ content: data.content });
          },
        },
      ];
    }

    if (data.kind !== 'note') return [];

    return [
      {
        id: 'notes.copy',
        title: 'Copy note',
        hotkeyHint: 'Enter',
        execute: async () => {
          const content = await client.get({ id: data.id });
          await writeToClipboard(content, { source: 'notes.copy', label: data.title });
        },
      },
      {
        id: 'notes.delete',
        title: 'Delete note',
        tone: 'danger',
        execute: async () => {
          await client.delete({ id: data.id });
        },
      },
    ];
  }

  async function search(ctx: SearchProviderContext): Promise<SearchResult<NotesResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.requestedScope !== 'notes') return [];

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
    const results: Array<{ result: SearchResult<NotesResultData>; score: number }> = [];

    // Virtual create entry when user typed a note content.
    if (trimmed) {
      const title = trimmed.length > 80 ? `${trimmed.slice(0, 79)}\u2026` : trimmed;
      results.push({
        score: 1000,
        result: {
          id: 'notes.create',
          provider: id,
          title: `Create note: ${title}`,
          subtitle: 'Saves to local storage',
          icon: '\u2795', // ➕
          data: { kind: 'create', content: trimmed },
          score: 1000,
        },
      });
    }

    for (const it of items) {
      const base =
        tokens.length === 0
          ? 200 + computeRecencyScore(it.updatedAt, now)
          : computeWeightedTokenScore(
              [
                { value: it.title, weight: 0.7, mode: 'text' },
                { value: it.preview, weight: 0.3, mode: 'text' },
              ],
              tokens,
            );
      if (base <= 0) continue;

      results.push({
        score: base,
        result: {
          id: `note.${it.id}`,
          provider: id,
          title: it.title,
          subtitle: buildSubtitle(it),
          icon,
          data: {
            kind: 'note',
            id: it.id,
            title: it.title,
            preview: it.preview,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
            incognito: it.incognito,
          },
          score: base,
        },
      });
    }

    results.sort((a, b) => b.score - a.score);

    if (results.length === 0) {
      results.push({
        score: 1,
        result: {
          id: 'notes.empty',
          provider: id,
          title: 'No notes yet',
          subtitle: 'Type `note ...` to create a new note',
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
    scopes: ['notes'],
    includeInAll: false,
    priority: 5,
    maxResults: 50,
    supportsEmptyQuery: true,
    search,
    getActions,
  };
}
