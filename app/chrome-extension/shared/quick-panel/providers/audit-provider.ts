/**
 * Audit Provider (Quick Panel)
 *
 * Exposes a lightweight, local audit log for Agent Mode tool calls.
 *
 * Scope:
 * - Prefix-only scope: `audit `
 * - Not included in 'all' scope (privacy + noise)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelAuditLogClearResponse,
  type QuickPanelAuditLogEntry,
  type QuickPanelAuditLogListResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { computeWeightedTokenScore, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type AuditResultData =
  | { kind: 'entry'; entry: QuickPanelAuditLogEntry }
  | { kind: 'command'; command: 'clear' };

interface AuditClient {
  list: (options: {
    query?: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<QuickPanelAuditLogEntry[]>;
  clear: () => Promise<void>;
}

// ============================================================
// Helpers
// ============================================================

function truncate(text: string, maxChars: number): string {
  const s = typeof text === 'string' ? text : String(text);
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)) + '\u2026';
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

function computeRecencyBoost(ts: number, now: number): number {
  const ageMs = Math.max(0, now - ts);
  const ageHours = ageMs / (1000 * 60 * 60);
  // 0..15 boost over ~24 hours
  return Math.max(0, Math.min(15, 15 - ageHours * 0.6));
}

function buildSubtitle(entry: QuickPanelAuditLogEntry): string {
  const parts: string[] = [];
  parts.push(entry.status);
  parts.push(entry.riskLevel);
  parts.push(formatTime(entry.finishedAt || entry.startedAt));
  return parts.join(' \u00B7 ');
}

function createRuntimeClient(): AuditClient {
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
  }): Promise<QuickPanelAuditLogEntry[]> {
    if (options.signal.aborted) throw new Error('aborted');

    const resp = await send<QuickPanelAuditLogListResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_LIST,
      { query: options.query, maxResults: options.maxResults },
    );

    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to list audit log');
    }

    return Array.isArray(resp.entries) ? resp.entries : [];
  }

  async function clear(): Promise<void> {
    const resp = await send<QuickPanelAuditLogClearResponse>(
      BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_CLEAR,
      {},
    );
    if (!resp || resp.success !== true) {
      const err = (resp as { error?: unknown })?.error;
      throw new Error(typeof err === 'string' ? err : 'Failed to clear audit log');
    }
  }

  return { list, clear };
}

// ============================================================
// Provider Factory
// ============================================================

export function createAuditProvider(): SearchProvider<AuditResultData> {
  const id = 'audit';
  const name = 'Audit';
  const icon = '\uD83E\uDDFE'; // 🧾

  const client = createRuntimeClient();

  function getActions(item: SearchResult<AuditResultData>): Action<AuditResultData>[] {
    const data = item.data;

    if (data.kind === 'command' && data.command === 'clear') {
      return [
        {
          id: 'audit.clear',
          title: 'Clear audit log',
          tone: 'danger',
          hotkeyHint: 'Enter',
          execute: async () => {
            await client.clear();
          },
        },
      ];
    }

    if (data.kind !== 'entry') return [];

    const entry = data.entry;

    const copyJson: Action<AuditResultData> = {
      id: 'audit.copyJson',
      title: 'Copy details (JSON)',
      hotkeyHint: 'Enter',
      execute: async () => {
        await writeToClipboard(JSON.stringify(entry, null, 2), {
          source: 'audit.log.copy.json',
          label: `audit:${entry.toolName}`,
        });
      },
    };

    const copyArgs: Action<AuditResultData> = {
      id: 'audit.copyArgs',
      title: 'Copy args summary',
      execute: async () => {
        await writeToClipboard(entry.argsSummary || '', {
          source: 'audit.log.copy.args',
          label: `args:${entry.toolName}`,
        });
      },
    };

    const copyResult: Action<AuditResultData> = {
      id: 'audit.copyResult',
      title: 'Copy result summary',
      execute: async () => {
        await writeToClipboard(entry.resultSummary || '', {
          source: 'audit.log.copy.result',
          label: `result:${entry.toolName}`,
        });
      },
    };

    return [copyJson, copyArgs, copyResult];
  }

  async function search(ctx: SearchProviderContext): Promise<SearchResult<AuditResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.requestedScope !== 'audit') return [];

    const q = ctx.query.text;
    const tokens = ctx.query.tokens;

    const results: SearchResult<AuditResultData>[] = [];

    // Special command: clear
    const wantsClear = tokens.includes('clear') || tokens.includes('reset');
    if (wantsClear) {
      results.push({
        id: 'audit.clear',
        provider: id,
        title: 'Clear audit log',
        subtitle: 'Delete recent tool action entries for this context',
        icon: '\u26A0\uFE0F', // ⚠️
        data: { kind: 'command', command: 'clear' },
        score: 1000,
      });
    }

    const entries = await client.list({
      query: q,
      maxResults: Math.max(50, ctx.limit),
      signal: ctx.signal,
    });

    for (const entry of entries) {
      const haystack = `${entry.toolName} ${entry.argsSummary} ${entry.resultSummary}`;
      const matchScore =
        tokens.length === 0
          ? 1
          : computeWeightedTokenScore(
              [
                { value: entry.toolName, weight: 0.5, mode: 'text' },
                { value: haystack, weight: 0.5, mode: 'text' },
              ],
              tokens,
            );

      if (tokens.length > 0 && matchScore <= 0) continue;

      const score =
        matchScore * 200 + computeRecencyBoost(entry.finishedAt || entry.startedAt, ctx.now);

      results.push({
        id: `audit.${entry.id}`,
        provider: id,
        title: entry.toolName,
        subtitle:
          buildSubtitle(entry) +
          (entry.resultSummary ? ` \u00B7 ${truncate(entry.resultSummary, 80)}` : ''),
        icon,
        data: { kind: 'entry', entry },
        score,
      });
    }

    // Keep best results
    return results.sort((a, b) => b.score - a.score).slice(0, ctx.limit);
  }

  return {
    id,
    name,
    icon,
    scopes: ['audit'],
    includeInAll: false,
    supportsEmptyQuery: true,
    search,
    getActions,
  };
}
