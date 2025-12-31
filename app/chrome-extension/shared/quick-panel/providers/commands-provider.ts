/**
 * Commands Search Provider (Quick Panel)
 *
 * Provides static, no-args page/tab commands.
 * Commands are executed via background service worker for tab operations,
 * or directly in content script for clipboard operations.
 *
 * **Important**: Commands are NOT included in 'all' scope.
 * Users must explicitly enter commands mode with '>' prefix.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelPageCommand,
  type QuickPanelPageCommandResponse,
} from '@/common/message-types';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { computeWeightedTokenScore, formatMarkdownLink, writeToClipboard } from './provider-utils';

// ============================================================
// Types
// ============================================================

/**
 * Command identifiers for Quick Panel commands.
 */
export type QuickPanelCommandId =
  | 'page.reload'
  | 'page.back'
  | 'page.forward'
  | 'page.stop'
  | 'tab.close'
  | 'tab.duplicate'
  | 'tab.togglePin'
  | 'tab.toggleMute'
  | 'copy.url'
  | 'copy.markdown'
  | 'window.newTab'
  | 'window.newWindow';

/**
 * Data associated with a command search result.
 */
export interface CommandsSearchResultData {
  commandId: QuickPanelCommandId;
}

// ============================================================
// Command Definitions
// ============================================================

interface CommandDef {
  id: QuickPanelCommandId;
  title: string;
  subtitle: string;
  icon: string;
  keywords: readonly string[];
}

/**
 * Static list of available commands.
 */
const COMMANDS: readonly CommandDef[] = [
  {
    id: 'page.reload',
    title: 'Reload',
    subtitle: 'Reload current page',
    icon: '\uD83D\uDD04', // 🔄
    keywords: ['reload', 'refresh', 'page'],
  },
  {
    id: 'page.back',
    title: 'Back',
    subtitle: 'Go back in history',
    icon: '\u2B05\uFE0F', // ⬅️
    keywords: ['back', 'previous', 'history'],
  },
  {
    id: 'page.forward',
    title: 'Forward',
    subtitle: 'Go forward in history',
    icon: '\u27A1\uFE0F', // ➡️
    keywords: ['forward', 'next', 'history'],
  },
  {
    id: 'page.stop',
    title: 'Stop',
    subtitle: 'Stop loading current page',
    icon: '\u23F9\uFE0F', // ⏹️
    keywords: ['stop', 'cancel', 'loading'],
  },
  {
    id: 'tab.close',
    title: 'Close tab',
    subtitle: 'Close current tab',
    icon: '\u2716', // ✖
    keywords: ['close', 'tab', 'remove'],
  },
  {
    id: 'tab.duplicate',
    title: 'Duplicate tab',
    subtitle: 'Duplicate current tab',
    icon: '\uD83D\uDCC4', // 📄
    keywords: ['duplicate', 'clone', 'copy', 'tab'],
  },
  {
    id: 'tab.togglePin',
    title: 'Toggle pin',
    subtitle: 'Pin or unpin current tab',
    icon: '\uD83D\uDCCC', // 📌
    keywords: ['pin', 'unpin', 'toggle', 'tab'],
  },
  {
    id: 'tab.toggleMute',
    title: 'Toggle mute',
    subtitle: 'Mute or unmute current tab',
    icon: '\uD83D\uDD07', // 🔇
    keywords: ['mute', 'unmute', 'toggle', 'sound', 'audio', 'tab'],
  },
  {
    id: 'copy.url',
    title: 'Copy URL',
    subtitle: 'Copy current page URL to clipboard',
    icon: '\uD83D\uDD17', // 🔗
    keywords: ['copy', 'url', 'link', 'clipboard'],
  },
  {
    id: 'copy.markdown',
    title: 'Copy as Markdown',
    subtitle: 'Copy current page as Markdown link',
    icon: '\uD83D\uDCDD', // 📝
    keywords: ['copy', 'markdown', 'md', 'link', 'clipboard'],
  },
  {
    id: 'window.newTab',
    title: 'New tab',
    subtitle: 'Open a new tab',
    icon: '\u2795', // ➕
    keywords: ['new', 'tab', 'open', 'create'],
  },
  {
    id: 'window.newWindow',
    title: 'New window',
    subtitle: 'Open a new window',
    icon: '\uD83E\uDE9F', // 🪟
    keywords: ['new', 'window', 'open', 'create'],
  },
] as const;

// ============================================================
// Command Execution
// ============================================================

/**
 * Map command ID to background page command.
 */
function toPageCommand(commandId: QuickPanelCommandId): QuickPanelPageCommand | null {
  switch (commandId) {
    case 'page.reload':
      return 'reload';
    case 'page.back':
      return 'back';
    case 'page.forward':
      return 'forward';
    case 'page.stop':
      return 'stop';
    case 'tab.close':
      return 'close_tab';
    case 'tab.duplicate':
      return 'duplicate_tab';
    case 'tab.togglePin':
      return 'toggle_pin';
    case 'tab.toggleMute':
      return 'toggle_mute';
    case 'window.newTab':
      return 'new_tab';
    case 'window.newWindow':
      return 'new_window';
    default:
      return null;
  }
}

/**
 * Execute a page command via background service worker.
 */
async function executePageCommand(command: QuickPanelPageCommand): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('chrome.runtime.sendMessage is not available');
  }

  const resp = (await chrome.runtime.sendMessage({
    type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND,
    payload: { command },
  })) as QuickPanelPageCommandResponse;

  if (!resp || resp.success !== true) {
    const err = (resp as { error?: unknown })?.error;
    throw new Error(typeof err === 'string' ? err : 'Failed to execute command');
  }
}

// ============================================================
// Scoring Helpers
// ============================================================

/**
 * Compute score for a command based on query tokens.
 */
function computeCommandScore(def: CommandDef, tokens: readonly string[]): number {
  // Combine keywords into a single haystack for matching
  const keywordsHaystack = def.keywords.join(' ');

  return computeWeightedTokenScore(
    [
      { value: def.title, weight: 0.75, mode: 'text' },
      { value: keywordsHaystack, weight: 0.25, mode: 'text' },
    ],
    tokens,
  );
}

// ============================================================
// Provider Factory
// ============================================================

/**
 * Create a Commands search provider for Quick Panel.
 *
 * Note: Commands are NOT included in 'all' scope by design.
 * Users must use '>' prefix to search commands.
 *
 * @example
 * ```typescript
 * const commandsProvider = createCommandsProvider();
 * searchEngine.registerProvider(commandsProvider);
 * ```
 */
export function createCommandsProvider(): SearchProvider<CommandsSearchResultData> {
  const id = 'commands';
  const name = 'Commands';
  const icon = '>'; // Command prefix indicator

  /**
   * Get actions available for a command result.
   */
  function getActions(
    item: SearchResult<CommandsSearchResultData>,
  ): Action<CommandsSearchResultData>[] {
    const commandId = item.data.commandId;

    return [
      {
        id: 'commands.run',
        title: 'Run command',
        hotkeyHint: 'Enter',
        execute: async () => {
          // Handle clipboard commands directly in content script
          if (commandId === 'copy.url') {
            const url = window.location.href;
            await writeToClipboard(url);
            return;
          }

          if (commandId === 'copy.markdown') {
            const url = window.location.href;
            const title = document.title || url;
            await writeToClipboard(formatMarkdownLink(title, url));
            return;
          }

          // Execute other commands via background
          const pageCommand = toPageCommand(commandId);
          if (!pageCommand) {
            throw new Error(`Unsupported commandId: ${commandId}`);
          }
          await executePageCommand(pageCommand);
        },
      },
    ];
  }

  /**
   * Search for commands matching the query.
   */
  async function search(
    ctx: SearchProviderContext,
  ): Promise<SearchResult<CommandsSearchResultData>[]> {
    if (ctx.signal.aborted) return [];
    if (ctx.query.tokens.length === 0) return [];

    // Score and filter commands
    const scored = COMMANDS.map((def) => {
      const score = computeCommandScore(def, ctx.query.tokens);
      return { def, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        // Primary: score descending
        if (b.score !== a.score) return b.score - a.score;
        // Tie-breaker: title alphabetically
        return a.def.title.localeCompare(b.def.title);
      })
      .slice(0, ctx.limit);

    // Convert to SearchResult format
    return scored.map(({ def, score }) => {
      const data: CommandsSearchResultData = {
        commandId: def.id,
      };

      return {
        id: def.id,
        provider: id,
        title: def.title,
        subtitle: def.subtitle,
        icon: def.icon || icon,
        data,
        score,
      };
    });
  }

  return {
    id,
    name,
    icon,
    scopes: ['commands'],
    includeInAll: false, // Commands NOT in 'all' scope per product decision
    priority: 0, // Lowest priority
    maxResults: 50,
    supportsEmptyQuery: false,
    search,
    getActions,
  };
}
