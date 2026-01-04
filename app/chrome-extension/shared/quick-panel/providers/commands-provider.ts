/**
 * Commands Search Provider (Quick Panel)
 *
 * Provides static page/tab commands and argument-based toolbox utilities.
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
import { cleanUrl } from '../core/clean-url';
import {
  base64DecodeUtf8,
  base64EncodeUtf8,
  convertUnixTimestamp,
  decodeJwt,
  formatJson,
  generateUuidV4,
  urlDecode,
  urlEncode,
} from '../core/toolbox';
import {
  computeWeightedTokenScore,
  formatMarkdownLink,
  openUrl,
  writeToClipboard,
} from './provider-utils';

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
  | 'page.screenshot'
  | 'dev.consoleSnapshot'
  | 'dev.consoleErrors'
  | 'dev.readPage'
  | 'dev.networkCapture10s'
  | 'dev.performanceTrace5s'
  | 'dev.debugBundle'
  | 'dev.debugBundleCancel'
  | 'page.readerMode'
  | 'page.zenMode'
  | 'page.forceDark'
  | 'page.allowCopy'
  | 'page.privacyCurtain'
  | 'page.cleanUrl'
  | 'page.pictureInPicture'
  | 'page.skinVscode'
  | 'page.skinTerminal'
  | 'page.skinRetro'
  | 'page.skinPaper'
  | 'page.skinOff'
  | 'tab.close'
  | 'tab.duplicate'
  | 'tab.togglePin'
  | 'tab.toggleMute'
  | 'tab.closeOtherTabs'
  | 'tab.closeTabsToRight'
  | 'tab.discardInactiveTabs'
  | 'copy.url'
  | 'copy.markdown'
  | 'window.newTab'
  | 'window.newWindow'
  | 'window.newIncognitoWindow'
  | 'window.mergeAllWindows';

/**
 * Data associated with a command search result.
 */
export type CommandsSearchResultData =
  | { commandId: QuickPanelCommandId | string }
  | ToolboxSearchResultData;

export type ToolboxToolId = 'json' | 'base64' | 'url' | 'ts' | 'uuid' | 'jwt';

export interface ToolboxOutputItem {
  id: string;
  title: string;
  value: string;
  hotkeyHint?: string;
}

export interface ToolboxSearchResultData {
  kind: 'toolbox';
  tool: ToolboxToolId;
  outputs: ToolboxOutputItem[];
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
    id: 'page.screenshot',
    title: 'Screenshot',
    subtitle: 'Capture visible page to Downloads',
    icon: '\uD83D\uDCF8', // 📸
    keywords: ['screenshot', 'capture', 'screen', 'image', 'png'],
  },
  {
    id: 'dev.consoleSnapshot',
    title: 'Export console (snapshot)',
    subtitle: 'Capture console logs and save JSON to Downloads',
    icon: '\uD83D\uDCDC', // 📜
    keywords: ['dev', 'developer', 'console', 'logs', 'export', 'download', 'json'],
  },
  {
    id: 'dev.consoleErrors',
    title: 'Export console (errors)',
    subtitle: 'Capture console errors and save JSON to Downloads',
    icon: '\uD83D\uDEA8', // 🚨
    keywords: ['dev', 'developer', 'console', 'errors', 'export', 'download', 'json'],
  },
  {
    id: 'dev.readPage',
    title: 'Export read_page (interactive)',
    subtitle: 'Export visible interactive elements (accessibility tree) to Downloads',
    icon: '\u267F\uFE0F', // ♿️
    keywords: [
      'dev',
      'developer',
      'read',
      'page',
      'accessibility',
      'interactive',
      'export',
      'download',
    ],
  },
  {
    id: 'dev.networkCapture10s',
    title: 'Network capture (10s)',
    subtitle: 'Capture network requests for 10 seconds and export JSON to Downloads',
    icon: '\uD83D\uDCE1', // 📡
    keywords: ['dev', 'developer', 'network', 'capture', 'requests', 'export', 'download', 'json'],
  },
  {
    id: 'dev.performanceTrace5s',
    title: 'Performance trace (5s)',
    subtitle: 'Record a 5-second performance trace and save JSON to Downloads',
    icon: '\u23F1\uFE0F', // ⏱️
    keywords: [
      'dev',
      'developer',
      'performance',
      'trace',
      'profiling',
      'export',
      'download',
      'json',
    ],
  },
  {
    id: 'dev.debugBundle',
    title: 'Debug bundle',
    subtitle: 'Collect screenshot/console/network/performance into a Downloads folder',
    icon: '\uD83D\uDC1B', // 🐛
    keywords: ['dev', 'developer', 'debug', 'bundle', 'bug', 'report', 'diagnostics'],
  },
  {
    id: 'dev.debugBundleCancel',
    title: 'Cancel debug bundle',
    subtitle: 'Cancel active debug bundle collection for this tab',
    icon: '\u270B', // ✋
    keywords: ['dev', 'developer', 'debug', 'bundle', 'cancel', 'stop'],
  },
  {
    id: 'page.readerMode',
    title: 'Reader mode',
    subtitle: 'Open a distraction-free reader overlay (Esc to close)',
    icon: '\uD83D\uDCD6', // 📖
    keywords: ['reader', 'readability', 'article', 'reading', 'mode'],
  },
  {
    id: 'page.zenMode',
    title: 'Zen mode',
    subtitle: 'Hide common distractions (best-effort)',
    icon: '\uD83E\uDDD8', // 🧘
    keywords: ['zen', 'focus', 'minimal', 'distraction', 'hide'],
  },
  {
    id: 'page.forceDark',
    title: 'Force dark',
    subtitle: 'Apply a simple dark filter (best-effort)',
    icon: '\uD83C\uDF19', // 🌙
    keywords: ['dark', 'night', 'theme', 'invert', 'contrast'],
  },
  {
    id: 'page.allowCopy',
    title: 'Allow copy',
    subtitle: 'Enable selection and copy on this page (best-effort)',
    icon: '\uD83D\uDCCB', // 📋
    keywords: ['copy', 'select', 'selection', 'text', 'contextmenu'],
  },
  {
    id: 'page.privacyCurtain',
    title: 'Privacy curtain',
    subtitle: 'Mask page content for screen sharing (Esc to hide)',
    icon: '\uD83D\uDEE1\uFE0F', // 🛡️
    keywords: ['privacy', 'curtain', 'mask', 'blur', 'screen', 'share'],
  },
  {
    id: 'page.cleanUrl',
    title: 'Clean URL',
    subtitle: 'Remove tracking params and copy/open the cleaned URL',
    icon: '\uD83E\uDDFC', // 🧼
    keywords: ['clean', 'url', 'utm', 'tracking', 'share', 'sanitize'],
  },
  {
    id: 'page.pictureInPicture',
    title: 'Picture-in-Picture',
    subtitle: 'Toggle Picture-in-Picture for the current page video',
    icon: '\uD83D\uDCFA', // 📺
    keywords: ['pip', 'picture', 'video', 'floating', 'player'],
  },
  {
    id: 'page.skinVscode',
    title: 'Skin: VS Code',
    subtitle: 'Apply VS Code-inspired page skin (shows "Skin mode")',
    icon: '\uD83C\uDFA8', // 🎨
    keywords: ['skin', 'theme', 'style', 'vscode', 'code', 'editor'],
  },
  {
    id: 'page.skinTerminal',
    title: 'Skin: Terminal',
    subtitle: 'Apply terminal-inspired page skin (shows "Skin mode")',
    icon: '\uD83C\uDFA8', // 🎨
    keywords: ['skin', 'theme', 'style', 'terminal', 'console', 'green'],
  },
  {
    id: 'page.skinRetro',
    title: 'Skin: Retro',
    subtitle: 'Apply retro page skin (shows "Skin mode")',
    icon: '\uD83C\uDFA8', // 🎨
    keywords: ['skin', 'theme', 'style', 'retro', 'crt', 'nostalgia'],
  },
  {
    id: 'page.skinPaper',
    title: 'Skin: Paper',
    subtitle: 'Apply paper page skin (shows "Skin mode")',
    icon: '\uD83C\uDFA8', // 🎨
    keywords: ['skin', 'theme', 'style', 'paper', 'serif', 'reading'],
  },
  {
    id: 'page.skinOff',
    title: 'Skin: Off',
    subtitle: 'Remove page skin',
    icon: '\uD83D\uDEAB', // 🚫
    keywords: ['skin', 'theme', 'style', 'off', 'disable', 'clear', 'remove', 'reset'],
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
    id: 'tab.closeOtherTabs',
    title: 'Close other tabs',
    subtitle: 'Close all other unpinned tabs in current window',
    icon: '\uD83E\uDDF9', // 🧹
    keywords: ['close', 'other', 'tabs', 'window', 'cleanup'],
  },
  {
    id: 'tab.closeTabsToRight',
    title: 'Close tabs to the right',
    subtitle: 'Close unpinned tabs to the right in current window',
    icon: '\u27A1\uFE0F\u2716', // ➡️✖
    keywords: ['close', 'tabs', 'right', 'window', 'cleanup'],
  },
  {
    id: 'tab.discardInactiveTabs',
    title: 'Discard inactive tabs',
    subtitle: 'Discard inactive unpinned tabs in current window',
    icon: '\uD83D\uDCA4', // 💤
    keywords: ['discard', 'sleep', 'unload', 'tabs', 'inactive', 'window', 'memory'],
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
  {
    id: 'window.newIncognitoWindow',
    title: 'New incognito window',
    subtitle: 'Open a new incognito window',
    icon: '\uD83D\uDD76\uFE0F', // 🕶️
    keywords: ['incognito', 'private', 'window', 'new'],
  },
  {
    id: 'window.mergeAllWindows',
    title: 'Merge all windows',
    subtitle: 'Move tabs from other windows into current window',
    icon: '\uD83E\uDDF2', // 🧲
    keywords: ['merge', 'combine', 'windows', 'tabs', 'move'],
  },
] as const;

// ============================================================
// Toolbox (Argument Commands)
// ============================================================

const TOOLBOX_SCORE = 1000;
const TOOLBOX_MAX_INPUT_CHARS = 100_000;

function formatPreview(value: string, maxLen: number): string {
  const oneLine = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxLen - 1))}\u2026`;
}

function splitInvocation(rawQuery: string): { tool: string; args: string } | null {
  const raw = String(rawQuery ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const m = /^(\S+)\s*(.*)$/.exec(trimmed);
  if (!m) return null;

  const tool = String(m[1] ?? '').toLowerCase();
  const args = String(m[2] ?? '');
  return tool ? { tool, args } : null;
}

function isToolboxToolId(value: string): value is ToolboxToolId {
  return (
    value === 'json' ||
    value === 'base64' ||
    value === 'url' ||
    value === 'ts' ||
    value === 'uuid' ||
    value === 'jwt'
  );
}

function parseLeadingFlag(
  args: string,
  flagPatterns: readonly RegExp[],
): { hasFlag: boolean; rest: string } {
  const raw = String(args ?? '');
  const trimmed = raw.trimStart();
  for (const pattern of flagPatterns) {
    const m = pattern.exec(trimmed);
    if (!m) continue;
    const rest = trimmed.slice(m[0].length).trimStart();
    return { hasFlag: true, rest };
  }
  return { hasFlag: false, rest: trimmed };
}

function createToolboxResult(options: {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  tool: ToolboxToolId;
  outputs: ToolboxOutputItem[];
  score?: number;
}): SearchResult<CommandsSearchResultData> {
  return {
    id: options.id,
    provider: 'commands',
    title: options.title,
    subtitle: options.subtitle,
    icon: options.icon,
    data: { kind: 'toolbox', tool: options.tool, outputs: options.outputs },
    score: options.score ?? TOOLBOX_SCORE,
  };
}

function createToolboxErrorResult(options: {
  id: string;
  title: string;
  icon: string;
  tool: ToolboxToolId;
  error: string;
}): SearchResult<CommandsSearchResultData> {
  const error = String(options.error ?? 'Unknown error');
  return createToolboxResult({
    id: options.id,
    title: options.title,
    subtitle: error,
    icon: options.icon,
    tool: options.tool,
    outputs: [{ id: 'copyError', title: 'Copy error', value: error, hotkeyHint: 'Enter' }],
  });
}

function createToolboxResults(rawQuery: string): SearchResult<CommandsSearchResultData>[] {
  const invocation = splitInvocation(rawQuery);
  if (!invocation) return [];

  const rawArgs = invocation.args ?? '';
  if (rawArgs.length > TOOLBOX_MAX_INPUT_CHARS) {
    const tool = isToolboxToolId(invocation.tool) ? invocation.tool : 'json';
    return [
      createToolboxErrorResult({
        id: `toolbox.${tool}.error.inputTooLarge`,
        title: 'Toolbox',
        icon: '\u26A0\uFE0F', // ⚠️
        tool,
        error: `Input too large (>${TOOLBOX_MAX_INPUT_CHARS} chars)`,
      }),
    ];
  }

  switch (invocation.tool) {
    case 'json': {
      const input = rawArgs.trimStart();
      if (!input) return [];

      const res = formatJson(input);
      if (!res.ok) {
        return [
          createToolboxErrorResult({
            id: 'toolbox.json.error',
            title: 'JSON',
            icon: '\uD83D\uDCDD', // 📝
            tool: 'json',
            error: res.error,
          }),
        ];
      }

      return [
        createToolboxResult({
          id: 'toolbox.json',
          title: 'JSON',
          subtitle: formatPreview(res.value.pretty, 120),
          icon: '\uD83D\uDCDD', // 📝
          tool: 'json',
          outputs: [
            {
              id: 'copyPretty',
              title: 'Copy pretty JSON',
              value: res.value.pretty,
              hotkeyHint: 'Enter',
            },
            { id: 'copyMinified', title: 'Copy minified JSON', value: res.value.minified },
          ],
        }),
      ];
    }

    case 'base64': {
      const { hasFlag: decode, rest } = parseLeadingFlag(rawArgs, [
        /^-d\b/i,
        /^--decode\b/i,
        /^decode\b/i,
      ]);

      const input = rest;
      if (!input) return [];

      if (decode) {
        const res = base64DecodeUtf8(input);
        if (!res.ok) {
          return [
            createToolboxErrorResult({
              id: 'toolbox.base64.decode.error',
              title: 'Base64 decode',
              icon: '\uD83D\uDD13', // 🔓
              tool: 'base64',
              error: res.error,
            }),
          ];
        }

        return [
          createToolboxResult({
            id: 'toolbox.base64.decode',
            title: 'Base64 decode',
            subtitle: formatPreview(res.value, 120),
            icon: '\uD83D\uDD13', // 🔓
            tool: 'base64',
            outputs: [
              {
                id: 'copyDecoded',
                title: 'Copy decoded text',
                value: res.value,
                hotkeyHint: 'Enter',
              },
            ],
          }),
        ];
      }

      const res = base64EncodeUtf8(input);
      if (!res.ok) {
        return [
          createToolboxErrorResult({
            id: 'toolbox.base64.encode.error',
            title: 'Base64 encode',
            icon: '\uD83D\uDD12', // 🔒
            tool: 'base64',
            error: res.error,
          }),
        ];
      }

      return [
        createToolboxResult({
          id: 'toolbox.base64.encode',
          title: 'Base64 encode',
          subtitle: formatPreview(res.value, 120),
          icon: '\uD83D\uDD12', // 🔒
          tool: 'base64',
          outputs: [
            { id: 'copyEncoded', title: 'Copy Base64', value: res.value, hotkeyHint: 'Enter' },
          ],
        }),
      ];
    }

    case 'url': {
      const { hasFlag: decode, rest } = parseLeadingFlag(rawArgs, [
        /^-d\b/i,
        /^--decode\b/i,
        /^decode\b/i,
      ]);
      const input = rest;
      if (!input) return [];

      if (decode) {
        const res = urlDecode(input);
        if (!res.ok) {
          return [
            createToolboxErrorResult({
              id: 'toolbox.url.decode.error',
              title: 'URL decode',
              icon: '\uD83E\uDDE9', // 🧩
              tool: 'url',
              error: res.error,
            }),
          ];
        }

        return [
          createToolboxResult({
            id: 'toolbox.url.decode',
            title: 'URL decode',
            subtitle: formatPreview(res.value, 120),
            icon: '\uD83E\uDDE9', // 🧩
            tool: 'url',
            outputs: [
              {
                id: 'copyDecoded',
                title: 'Copy decoded text',
                value: res.value,
                hotkeyHint: 'Enter',
              },
            ],
          }),
        ];
      }

      const res = urlEncode(input);
      if (!res.ok) {
        return [
          createToolboxErrorResult({
            id: 'toolbox.url.encode.error',
            title: 'URL encode',
            icon: '\uD83E\uDDE9', // 🧩
            tool: 'url',
            error: res.error,
          }),
        ];
      }

      return [
        createToolboxResult({
          id: 'toolbox.url.encode',
          title: 'URL encode',
          subtitle: formatPreview(res.value, 120),
          icon: '\uD83E\uDDE9', // 🧩
          tool: 'url',
          outputs: [
            {
              id: 'copyEncoded',
              title: 'Copy encoded text',
              value: res.value,
              hotkeyHint: 'Enter',
            },
          ],
        }),
      ];
    }

    case 'ts': {
      const input = rawArgs.trim();
      const res = convertUnixTimestamp(input || String(Date.now()));
      if (!res.ok) {
        return [
          createToolboxErrorResult({
            id: 'toolbox.ts.error',
            title: 'Timestamp',
            icon: '\u23F1\uFE0F', // ⏱️
            tool: 'ts',
            error: res.error,
          }),
        ];
      }

      return [
        createToolboxResult({
          id: 'toolbox.ts',
          title: 'Timestamp',
          subtitle: res.value.iso,
          icon: '\u23F1\uFE0F', // ⏱️
          tool: 'ts',
          outputs: [
            { id: 'copyIso', title: 'Copy ISO', value: res.value.iso, hotkeyHint: 'Enter' },
            { id: 'copySeconds', title: 'Copy seconds', value: String(res.value.seconds) },
            {
              id: 'copyMilliseconds',
              title: 'Copy milliseconds',
              value: String(res.value.milliseconds),
            },
          ],
        }),
      ];
    }

    case 'uuid': {
      const uuid = generateUuidV4();
      return [
        createToolboxResult({
          id: 'toolbox.uuid',
          title: 'UUID v4',
          subtitle: uuid,
          icon: '\uD83C\uDD94', // 🆔
          tool: 'uuid',
          outputs: [{ id: 'copyUuid', title: 'Copy UUID', value: uuid, hotkeyHint: 'Enter' }],
        }),
      ];
    }

    case 'jwt': {
      const token = rawArgs.trim();
      if (!token) return [];

      const res = decodeJwt(token);
      if (!res.ok) {
        return [
          createToolboxErrorResult({
            id: 'toolbox.jwt.error',
            title: 'JWT decode',
            icon: '\uD83D\uDD11', // 🔑
            tool: 'jwt',
            error: res.error,
          }),
        ];
      }

      const header = JSON.stringify(res.value.header, null, 2);
      const payload = JSON.stringify(res.value.payload, null, 2);

      return [
        createToolboxResult({
          id: 'toolbox.jwt.header',
          title: 'JWT header',
          subtitle: formatPreview(header, 120),
          icon: '\uD83D\uDD11', // 🔑
          tool: 'jwt',
          outputs: [
            { id: 'copyHeader', title: 'Copy header JSON', value: header, hotkeyHint: 'Enter' },
          ],
        }),
        createToolboxResult({
          id: 'toolbox.jwt.payload',
          title: 'JWT payload',
          subtitle: formatPreview(payload, 120),
          icon: '\uD83D\uDD11', // 🔑
          tool: 'jwt',
          outputs: [
            { id: 'copyPayload', title: 'Copy payload JSON', value: payload, hotkeyHint: 'Enter' },
          ],
        }),
      ];
    }

    default:
      return [];
  }
}

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
    case 'page.screenshot':
      return 'screenshot';
    case 'dev.consoleSnapshot':
      return 'dev_console_snapshot_export';
    case 'dev.consoleErrors':
      return 'dev_console_errors_export';
    case 'dev.readPage':
      return 'dev_read_page_export';
    case 'dev.networkCapture10s':
      return 'dev_network_capture_10s_export';
    case 'dev.performanceTrace5s':
      return 'dev_performance_trace_5s_export';
    case 'dev.debugBundle':
      return 'dev_debug_bundle_create';
    case 'dev.debugBundleCancel':
      return 'dev_debug_bundle_cancel';
    case 'page.readerMode':
      return 'reader_mode_toggle';
    case 'page.zenMode':
      return 'zen_mode_toggle';
    case 'page.forceDark':
      return 'force_dark_toggle';
    case 'page.allowCopy':
      return 'allow_copy_toggle';
    case 'page.privacyCurtain':
      return 'privacy_curtain_toggle';
    case 'page.skinVscode':
      return 'skin_vscode';
    case 'page.skinTerminal':
      return 'skin_terminal';
    case 'page.skinRetro':
      return 'skin_retro';
    case 'page.skinPaper':
      return 'skin_paper';
    case 'page.skinOff':
      return 'skin_off';
    case 'tab.close':
      return 'close_tab';
    case 'tab.duplicate':
      return 'duplicate_tab';
    case 'tab.togglePin':
      return 'toggle_pin';
    case 'tab.toggleMute':
      return 'toggle_mute';
    case 'tab.closeOtherTabs':
      return 'close_other_tabs';
    case 'tab.closeTabsToRight':
      return 'close_tabs_to_right';
    case 'tab.discardInactiveTabs':
      return 'discard_inactive_tabs';
    case 'window.newTab':
      return 'new_tab';
    case 'window.newWindow':
      return 'new_window';
    case 'window.newIncognitoWindow':
      return 'new_incognito_window';
    case 'window.mergeAllWindows':
      return 'merge_all_windows';
    default:
      return null;
  }
}

function pickBestVideoElement(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  if (videos.length === 0) return null;

  let best: { el: HTMLVideoElement; area: number } | null = null;
  for (const el of videos) {
    try {
      const rect = el.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (area <= 0) continue;
      // Prefer videos with data loaded.
      const ready = typeof el.readyState === 'number' ? el.readyState : 0;
      const score = area + (ready >= 2 ? 10_000 : 0);
      if (!best || score > best.area) best = { el, area: score };
    } catch {
      // Ignore and keep scanning.
    }
  }

  return best?.el ?? videos[0] ?? null;
}

function togglePictureInPicture(): Promise<void> {
  const anyDoc = document as unknown as {
    pictureInPictureElement?: Element | null;
    exitPictureInPicture?: () => Promise<void>;
  };

  if (anyDoc.pictureInPictureElement && typeof anyDoc.exitPictureInPicture === 'function') {
    return anyDoc.exitPictureInPicture();
  }

  const video = pickBestVideoElement();
  if (!video || typeof (video as any).requestPictureInPicture !== 'function') {
    return Promise.reject(new Error('No Picture-in-Picture compatible video found'));
  }

  return (video as any).requestPictureInPicture().then(() => undefined);
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
    const data = item.data as unknown;

    // Toolbox results: local-only copy actions (no background bridge).
    if (typeof data === 'object' && data !== null && (data as any).kind === 'toolbox') {
      const outputs = Array.isArray((data as ToolboxSearchResultData).outputs)
        ? (data as ToolboxSearchResultData).outputs
        : [];

      return outputs.map((o, idx) => ({
        id: `toolbox.${String((data as ToolboxSearchResultData).tool)}.${o.id}`,
        title: o.title,
        hotkeyHint: idx === 0 ? 'Enter' : o.hotkeyHint,
        execute: async () => {
          const tool = String((data as ToolboxSearchResultData).tool);
          await writeToClipboard(o.value, { source: `toolbox.${tool}.${o.id}`, label: o.title });
        },
      }));
    }

    const commandId = (data as { commandId?: unknown })?.commandId;
    const normalized = typeof commandId === 'string' ? commandId.trim() : '';

    const isDangerous =
      normalized === 'tab.close' ||
      normalized === 'tab.closeOtherTabs' ||
      normalized === 'tab.closeTabsToRight';

    return [
      {
        id: 'commands.run',
        title: 'Run command',
        tone: isDangerous ? 'danger' : 'default',
        hotkeyHint: 'Enter',
        execute: async (ctx) => {
          // Page tools executed in content script (need access to current URL / user gesture).
          if (normalized === 'page.cleanUrl') {
            const currentUrl = window.location.href;
            const cleaned = cleanUrl(currentUrl).cleaned || currentUrl;

            // Enter -> copy (safe default), Cmd/Ctrl+Enter -> open in new tab.
            if (ctx.openMode === 'new_tab' || ctx.openMode === 'background_tab') {
              await openUrl({ url: cleaned, disposition: ctx.openMode });
              return;
            }

            await writeToClipboard(cleaned, {
              source: 'commands.clean_url',
              label: document.title || cleaned,
            });
            return;
          }

          // Best-effort: PiP often requires a user gesture. Avoid extra awaits before calling it.
          if (normalized === 'page.pictureInPicture') {
            return togglePictureInPicture();
          }

          // Handle clipboard commands directly in content script
          if (normalized === 'copy.url') {
            const url = window.location.href;
            await writeToClipboard(url, {
              source: 'commands.copy.url',
              label: document.title || url,
            });
            return;
          }

          if (normalized === 'copy.markdown') {
            const url = window.location.href;
            const title = document.title || url;
            await writeToClipboard(formatMarkdownLink(title, url), {
              source: 'commands.copy.markdown',
              label: title,
            });
            return;
          }

          // Screenshot should run after the panel is closed to avoid capturing the overlay.
          if (normalized === 'page.screenshot' || normalized === 'dev.debugBundle') {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }

          // Execute other commands via background
          const pageCommand = toPageCommand(normalized as QuickPanelCommandId);
          if (!pageCommand) {
            throw new Error(`Unsupported commandId: ${normalized}`);
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

    const toolboxResults = createToolboxResults(ctx.query.raw);

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
    const commandResults = scored.map(({ def, score }) => {
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

    const combined = [...toolboxResults, ...commandResults];
    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, ctx.limit);
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
