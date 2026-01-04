import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelAuditLogClearMessage,
  type QuickPanelAuditLogClearResponse,
  type QuickPanelAuditLogEntry,
  type QuickPanelAuditLogListMessage,
  type QuickPanelAuditLogListResponse,
} from '@/common/message-types';
import {
  clearToolActionLog,
  listToolActionLogEntries,
} from '@/entrypoints/background/tools/tool-action-log';

let initialized = false;

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function mapEntry(entry: any): QuickPanelAuditLogEntry {
  return {
    id: entry.id,
    toolName: entry.toolName,
    toolDescription: entry.toolDescription || undefined,
    riskLevel: entry.risk?.level || 'high',
    riskCategories: Array.isArray(entry.risk?.categories) ? entry.risk.categories : [],
    source: entry.source,
    incognito: entry.incognito === true,
    status: entry.status,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    durationMs: entry.durationMs,
    argsSummary: entry.argsSummary,
    resultSummary: entry.resultSummary,
  };
}

async function handleList(
  message: QuickPanelAuditLogListMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelAuditLogListResponse> {
  try {
    // TS types do not currently expose sender.incognito, but Chrome provides it at runtime.
    const incognito = (sender as any)?.incognito === true;
    const query = typeof message.payload?.query === 'string' ? message.payload.query : undefined;
    const maxResults =
      typeof message.payload?.maxResults === 'number' ? message.payload.maxResults : undefined;

    const entries = await listToolActionLogEntries({ incognito, query, maxResults });
    return { success: true, entries: entries.map(mapEntry) };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to list audit log' };
  }
}

async function handleClear(
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelAuditLogClearResponse> {
  try {
    // TS types do not currently expose sender.incognito, but Chrome provides it at runtime.
    const incognito = (sender as any)?.incognito === true;
    await clearToolActionLog({ incognito });
    return { success: true };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to clear audit log' };
  }
}

export function initQuickPanelAuditHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_LIST) {
      handleList(message as QuickPanelAuditLogListMessage, sender).then(sendResponse);
      return true;
    }

    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_CLEAR) {
      handleClear(sender).then(sendResponse);
      return true;
    }

    return false;
  });
}
