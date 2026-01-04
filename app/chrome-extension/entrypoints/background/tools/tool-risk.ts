import { TOOL_NAMES, TOOL_SCHEMAS } from 'chrome-mcp-shared';

export type ToolRiskCategory =
  | 'read'
  | 'write'
  | 'destructive'
  | 'external_network'
  | 'local_file'
  | 'debugger'
  | 'code_execution';

export type ToolRiskLevel = 'low' | 'medium' | 'high';

export interface ToolRiskAssessment {
  level: ToolRiskLevel;
  categories: ToolRiskCategory[];
  reasons: string[];
  requiresConfirmation: boolean;
}

function uniq<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function normalizeToolName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getToolDescription(toolName: string): string | null {
  const name = normalizeToolName(toolName);
  if (!name) return null;
  const schema = TOOL_SCHEMAS.find((t) => t.name === name);
  const desc = schema?.description;
  return typeof desc === 'string' && desc.trim() ? desc.trim() : null;
}

function hasTruthyFlag(args: unknown, key: string): boolean {
  if (!args || typeof args !== 'object') return false;
  return (args as Record<string, unknown>)[key] === true;
}

function normalizeHttpMethod(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/**
 * Assess risk level for a tool call.
 *
 * Notes:
 * - This is used for extension-side "Agent Mode" safeguards (Phase 14).
 * - Risk categories are best-effort and intentionally conservative for unknown tools.
 */
export function assessToolRisk(toolName: string, args: unknown): ToolRiskAssessment {
  const name = normalizeToolName(toolName);

  // Default: unknown tool is treated as high risk.
  if (!name) {
    return {
      level: 'high',
      categories: ['code_execution'],
      reasons: ['Unknown tool name'],
      requiresConfirmation: true,
    };
  }

  // ----------------------------
  // Read-only / low risk
  // ----------------------------
  if (
    name === TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS ||
    name === TOOL_NAMES.BROWSER.SEARCH_TABS_CONTENT ||
    name === TOOL_NAMES.BROWSER.HISTORY ||
    name === TOOL_NAMES.BROWSER.BOOKMARK_SEARCH ||
    name === TOOL_NAMES.BROWSER.READ_PAGE
  ) {
    return {
      level: 'low',
      categories: ['read'],
      reasons: [],
      requiresConfirmation: false,
    };
  }

  // Web content fetcher may navigate when url is provided and not open.
  if (name === TOOL_NAMES.BROWSER.WEB_FETCHER) {
    const url = typeof (args as any)?.url === 'string' ? String((args as any).url).trim() : '';
    if (url) {
      return {
        level: 'medium',
        categories: ['read', 'external_network', 'write'],
        reasons: ['May open a URL in a new tab'],
        requiresConfirmation: true,
      };
    }
    return {
      level: 'low',
      categories: ['read'],
      reasons: [],
      requiresConfirmation: false,
    };
  }

  // ----------------------------
  // Medium / high risk (requires confirmation)
  // ----------------------------

  if (name === TOOL_NAMES.BROWSER.NETWORK_REQUEST) {
    const method = normalizeHttpMethod((args as any)?.method) || 'GET';
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    return {
      level: isWrite ? 'high' : 'medium',
      categories: uniq(['external_network', isWrite ? 'destructive' : 'write']),
      reasons: ['Sends an outbound network request'],
      requiresConfirmation: true,
    };
  }

  if (name === TOOL_NAMES.BROWSER.NETWORK_CAPTURE) {
    const needResponseBody = hasTruthyFlag(args, 'needResponseBody');
    return needResponseBody
      ? {
          level: 'high',
          categories: ['read', 'debugger'],
          reasons: ['Captures response bodies via debugger backend'],
          requiresConfirmation: true,
        }
      : {
          level: 'medium',
          categories: ['read'],
          reasons: ['Captures network request metadata'],
          requiresConfirmation: true,
        };
  }

  if (
    name === TOOL_NAMES.BROWSER.SCREENSHOT ||
    name === TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE ||
    name === TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE ||
    name === TOOL_NAMES.BROWSER.PERFORMANCE_ANALYZE_INSIGHT ||
    name === TOOL_NAMES.BROWSER.GIF_RECORDER
  ) {
    // Most of these tools either write artifacts (downloads) or capture sensitive data.
    return {
      level: 'medium',
      categories: ['read', 'local_file'],
      reasons: ['May capture and/or export diagnostic artifacts'],
      requiresConfirmation: true,
    };
  }

  if (
    name === TOOL_NAMES.BROWSER.JAVASCRIPT ||
    name === TOOL_NAMES.BROWSER.INJECT_SCRIPT ||
    name === TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT ||
    name === TOOL_NAMES.BROWSER.USERSCRIPT
  ) {
    return {
      level: 'high',
      categories: ['code_execution', 'write'],
      reasons: ['Executes or injects code into a page'],
      requiresConfirmation: true,
    };
  }

  if (name === TOOL_NAMES.BROWSER.FILE_UPLOAD) {
    return {
      level: 'high',
      categories: ['local_file', 'write'],
      reasons: ['Uploads local or remote files into a page'],
      requiresConfirmation: true,
    };
  }

  if (
    name === TOOL_NAMES.BROWSER.CLICK ||
    name === TOOL_NAMES.BROWSER.FILL ||
    name === TOOL_NAMES.BROWSER.KEYBOARD ||
    name === TOOL_NAMES.BROWSER.COMPUTER ||
    name === TOOL_NAMES.BROWSER.NAVIGATE ||
    name === TOOL_NAMES.BROWSER.CLOSE_TABS ||
    name === TOOL_NAMES.BROWSER.SWITCH_TAB ||
    name === TOOL_NAMES.BROWSER.HANDLE_DIALOG
  ) {
    return {
      level: name === TOOL_NAMES.BROWSER.CLOSE_TABS ? 'high' : 'medium',
      categories: name === TOOL_NAMES.BROWSER.CLOSE_TABS ? ['destructive', 'write'] : ['write'],
      reasons: ['Directly changes browser or page state'],
      requiresConfirmation: true,
    };
  }

  if (name === TOOL_NAMES.BROWSER.BOOKMARK_ADD || name === TOOL_NAMES.BROWSER.BOOKMARK_DELETE) {
    return {
      level: 'high',
      categories: ['destructive', 'write'],
      reasons: ['Modifies bookmarks'],
      requiresConfirmation: true,
    };
  }

  if (name === TOOL_NAMES.RECORD_REPLAY.FLOW_RUN) {
    return {
      level: 'high',
      categories: ['write', 'code_execution'],
      reasons: ['Runs an automated flow that may change page state'],
      requiresConfirmation: true,
    };
  }

  if (name === TOOL_NAMES.RECORD_REPLAY.LIST_PUBLISHED) {
    return {
      level: 'low',
      categories: ['read'],
      reasons: [],
      requiresConfirmation: false,
    };
  }

  // Default fallback: treat as high risk and require confirmation.
  return {
    level: 'high',
    categories: ['code_execution'],
    reasons: ['Unclassified tool'],
    requiresConfirmation: true,
  };
}
