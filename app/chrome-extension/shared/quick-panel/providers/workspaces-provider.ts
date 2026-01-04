/**
 * Workspaces Provider (Quick Panel)
 *
 * Provides session snapshots (tab workspaces) via background bridge.
 *
 * Scope:
 * - Prefix-only scope: `ws `
 * - Not included in 'all' scope (to keep local search noise-free)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelWorkspaceSummary,
  type QuickPanelWorkspacesDeleteResponse,
  type QuickPanelWorkspacesListResponse,
  type QuickPanelWorkspacesOpenResponse,
  type QuickPanelWorkspacesSaveResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { computeWeightedTokenScore } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type WorkspacesResultData =
  | {
      kind: 'workspace';
      workspaceId: string;
      name: string;
      tabCount: number;
      createdAt: number;
      updatedAt: number;
      incognito: boolean;
    }
  | {
      kind: 'save';
      name: string | null;
    };

// ============================================================
// Background Client
// ============================================================

interface WorkspacesClient {
  list: (options: {
    query?: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelWorkspaceSummary[]>;
  save: (options: { name?: string }) => Promise<QuickPanelWorkspaceSummary>;
  open: (options: {
    workspaceId: string;
    target: 'current_window' | 'new_window';
  }) => Promise<void>;
  delete: (options: { workspaceId: string }) => Promise<void>;
}

function createRuntimeWorkspacesClient(): WorkspacesClient {
  async function list(options: {
    query?: string;
    maxResults: number;
    signal: AbortSignal;
  }): Promise<QuickPanelWorkspaceSummary[]> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }
    if (options.signal.aborted) {
      throw new Error('aborted');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_LIST,
      payload: { query: options.query, maxResults: options.maxResults },
    })) as QuickPanelWorkspacesListResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to list workspaces');
    }

    return Array.isArray(resp.items) ? resp.items : [];
  }

  async function save(options: { name?: string }): Promise<QuickPanelWorkspaceSummary> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_SAVE,
      payload: { name: options.name },
    })) as QuickPanelWorkspacesSaveResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to save workspace');
    }

    return resp.workspace;
  }

  async function open(options: {
    workspaceId: string;
    target: 'current_window' | 'new_window';
  }): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const id = String(options.workspaceId ?? '').trim();
    if (!id) throw new Error('workspaceId is required');

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_OPEN,
      payload: { workspaceId: id, target: options.target },
    })) as QuickPanelWorkspacesOpenResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to open workspace');
    }
  }

  async function del(options: { workspaceId: string }): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is not available');
    }

    const id = String(options.workspaceId ?? '').trim();
    if (!id) throw new Error('workspaceId is required');

    const resp = (await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_DELETE,
      payload: { workspaceId: id },
    })) as QuickPanelWorkspacesDeleteResponse;

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to delete workspace');
    }
  }

  return { list, save, open, delete: del };
}

// ============================================================
// Scoring
// ============================================================

function computeWorkspaceScore(
  item: QuickPanelWorkspaceSummary,
  tokens: readonly string[],
  now: number,
): number {
  if (tokens.length === 0) {
    // Empty query: sort by recency (updatedAt) with a baseline to keep it visible.
    const ageMs = Math.max(0, now - (item.updatedAt || item.createdAt || 0));
    const ageHours = ageMs / (1000 * 60 * 60);
    const recencyBoost = Math.max(0, Math.min(20, 20 - ageHours / 24));
    return 50 + recencyBoost;
  }

  const base = computeWeightedTokenScore([{ value: item.name, weight: 1, mode: 'text' }], tokens);
  if (base <= 0) return 0;

  const ageMs = Math.max(0, now - (item.updatedAt || item.createdAt || 0));
  const ageHours = ageMs / (1000 * 60 * 60);
  const recencyBoost = Math.max(0, Math.min(10, 10 - ageHours / 24));
  return base + recencyBoost;
}

// ============================================================
// Provider Factory
// ============================================================

export function createWorkspacesProvider(): SearchProvider<WorkspacesResultData> {
  const id = 'workspaces';
  const name = 'Workspaces';
  const icon = '\uD83D\uDDC3\uFE0F'; // 🗃️

  const client = createRuntimeWorkspacesClient();

  function getActions(item: SearchResult<WorkspacesResultData>): Action<WorkspacesResultData>[] {
    const data = item.data;

    if (data.kind === 'save') {
      const saveName = data.name?.trim() || undefined;
      return [
        {
          id: 'workspaces.save',
          title: saveName ? `Save session as "${saveName}"` : 'Save current session',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.save({ name: saveName });
          },
        },
      ];
    }

    const workspaceId = data.workspaceId;

    return [
      {
        id: 'workspaces.openNewWindow',
        title: 'Open in new window',
        hotkeyHint: 'Enter',
        execute: async (ctx) => {
          // Treat Cmd/Ctrl+Enter as a deliberate "restore into current window".
          const target = ctx.openMode === 'new_tab' ? 'current_window' : 'new_window';
          await client.open({ workspaceId, target });
        },
      },
      {
        id: 'workspaces.openCurrentWindow',
        title: 'Open in current window',
        tone: 'danger',
        hotkeyHint: 'Cmd/Ctrl+Enter',
        execute: async () => {
          await client.open({ workspaceId, target: 'current_window' });
        },
      },
      {
        id: 'workspaces.delete',
        title: 'Delete workspace',
        tone: 'danger',
        execute: async () => {
          await client.delete({ workspaceId });
        },
      },
    ];
  }

  async function search(ctx: SearchProviderContext): Promise<SearchResult<WorkspacesResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.requestedScope !== 'workspaces') return [];

    const raw = String(ctx.query.raw ?? '');
    const trimmed = raw.trim();
    const tokens = ctx.query.tokens;

    const maxResults = Math.min(100, Math.max(10, ctx.limit * 5));
    const items = await client.list({
      query: trimmed || undefined,
      maxResults,
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) return [];

    const results: Array<{ result: SearchResult<WorkspacesResultData>; score: number }> = [];

    const lowerQuery = trimmed.toLowerCase();
    const hasQuery = tokens.length > 0;

    // Virtual save entries
    if (!hasQuery) {
      results.push({
        score: 1000,
        result: {
          id: 'workspaces.saveCurrent',
          provider: id,
          title: 'Save current session',
          subtitle: 'Create a snapshot of tabs in this window',
          icon: '\uD83D\uDCBE', // 💾
          data: { kind: 'save', name: null },
          score: 1000,
        },
      });
    } else {
      const hasExact = items.some((w) => w.name.trim().toLowerCase() === lowerQuery);
      if (!hasExact) {
        results.push({
          score: 1000,
          result: {
            id: `workspaces.saveAs:${encodeURIComponent(trimmed)}`,
            provider: id,
            title: `Save session as "${trimmed}"`,
            subtitle: 'Create a snapshot of tabs in this window',
            icon: '\uD83D\uDCBE', // 💾
            data: { kind: 'save', name: trimmed },
            score: 1000,
          },
        });
      }
    }

    // Workspace snapshots
    for (const w of items) {
      const score = computeWorkspaceScore(w, tokens, ctx.now);
      if (hasQuery && score <= 0) continue;

      const data: WorkspacesResultData = {
        kind: 'workspace',
        workspaceId: w.id,
        name: w.name,
        tabCount: w.tabCount,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        incognito: w.incognito,
      };

      results.push({
        score,
        result: {
          id: w.id,
          provider: id,
          title: w.name,
          subtitle: `${w.tabCount} tabs`,
          icon,
          data,
          score,
        },
      });
    }

    // Sort by score desc, then updatedAt desc, then name.
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aUpdated = a.result.data.kind === 'workspace' ? a.result.data.updatedAt : 0;
      const bUpdated = b.result.data.kind === 'workspace' ? b.result.data.updatedAt : 0;
      if (bUpdated !== aUpdated) return bUpdated - aUpdated;
      return a.result.title.localeCompare(b.result.title);
    });

    return results.map((r) => r.result).slice(0, ctx.limit);
  }

  return {
    id,
    name,
    icon,
    scopes: ['workspaces'],
    includeInAll: false,
    supportsEmptyQuery: true,
    maxResults: 50,
    search,
    getActions,
  };
}
