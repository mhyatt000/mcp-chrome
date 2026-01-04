import { BACKGROUND_MESSAGE_TYPES, TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { BaseBrowserToolExecutor } from './base-browser';
import type { ToolRiskAssessment } from './tool-risk';

export interface ToolApprovalRequest {
  toolName: string;
  toolDescription?: string | null;
  risk: ToolRiskAssessment;
  argsSummary: string;
  tabId?: number;
  windowId?: number;
  timeoutMs?: number;
}

export interface ToolApprovalResult {
  approved: boolean;
  reason: 'approved' | 'denied' | 'timeout' | 'ui_unavailable';
}

interface ToolApprovalUiEventMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.TOOL_APPROVAL_UI_EVENT;
  sessionId: string;
  event: 'approve' | 'deny';
}

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MIN_TIMEOUT_MS = 5 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeTimeoutMs(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(n), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function createSessionId(): string {
  return `ta_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

class ToolApprovalHelper extends BaseBrowserToolExecutor {
  name = 'tool_approval';
  // Not used; required by abstract base.
  async execute(): Promise<any> {
    throw new Error('Not implemented');
  }

  tryGetTabPublic(tabId?: number): Promise<chrome.tabs.Tab | null> {
    return this.tryGetTab(tabId);
  }

  getActiveTabOrThrowInWindowPublic(windowId?: number): Promise<chrome.tabs.Tab> {
    return this.getActiveTabOrThrowInWindow(windowId);
  }

  ensureFocusPublic(
    tab: chrome.tabs.Tab,
    options: { activate?: boolean; focusWindow?: boolean },
  ): Promise<void> {
    return this.ensureFocus(tab, options);
  }

  injectContentScriptPublic(
    tabId: number,
    files: string[],
    injectImmediately = false,
    world: 'MAIN' | 'ISOLATED' = 'ISOLATED',
  ): Promise<void> {
    return this.injectContentScript(tabId, files, injectImmediately, world);
  }

  sendMessageToTabPublic(tabId: number, message: any, frameId?: number): Promise<any> {
    return this.sendMessageToTab(tabId, message, frameId);
  }
}

const helper = new ToolApprovalHelper();

// Serialize approvals to avoid multiple overlapping prompts.
let approvalQueue: Promise<unknown> = Promise.resolve();

async function resolveTab(tabId?: number, windowId?: number): Promise<chrome.tabs.Tab> {
  const explicit = await helper.tryGetTabPublic(tabId);
  if (explicit && explicit.id) return explicit;
  return await helper.getActiveTabOrThrowInWindowPublic(windowId);
}

async function showPrompt(
  tab: chrome.tabs.Tab,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!tab.id) return false;
  try {
    await helper.injectContentScriptPublic(
      tab.id,
      ['inject-scripts/tool-approval.js'],
      false,
      'ISOLATED',
    );
    await helper.sendMessageToTabPublic(
      tab.id,
      {
        action: TOOL_MESSAGE_TYPES.TOOL_APPROVAL_SHOW,
        ...payload,
      },
      0,
    );
    return true;
  } catch {
    return false;
  }
}

async function hidePrompt(tab: chrome.tabs.Tab, sessionId: string): Promise<void> {
  if (!tab.id) return;
  try {
    await helper.sendMessageToTabPublic(
      tab.id,
      {
        action: TOOL_MESSAGE_TYPES.TOOL_APPROVAL_HIDE,
        sessionId,
      },
      0,
    );
  } catch {
    // Best-effort
  }
}

async function requestToolApprovalImpl(req: ToolApprovalRequest): Promise<ToolApprovalResult> {
  const sessionId = createSessionId();
  const timeoutMs = normalizeTimeoutMs(req.timeoutMs);
  const deadlineTs = Date.now() + timeoutMs;

  let tab: chrome.tabs.Tab;
  try {
    tab = await resolveTab(req.tabId, req.windowId);
  } catch (err) {
    console.warn('[ToolApproval] Failed to resolve tab:', safeErrorMessage(err));
    return { approved: false, reason: 'ui_unavailable' };
  }

  // Best-effort: focus the target tab so the user can see the prompt.
  try {
    await helper.ensureFocusPublic(tab, { activate: true, focusWindow: true });
  } catch {
    // Ignore focus errors
  }

  const ok = await showPrompt(tab, {
    sessionId,
    deadlineTs,
    toolName: req.toolName,
    toolDescription: req.toolDescription || undefined,
    risk: {
      level: req.risk.level,
      categories: req.risk.categories,
      reasons: req.risk.reasons,
    },
    argsSummary: req.argsSummary,
  });

  if (!ok) {
    return { approved: false, reason: 'ui_unavailable' };
  }

  return await new Promise<ToolApprovalResult>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      void hidePrompt(tab, sessionId);
      resolve({ approved: false, reason: 'timeout' });
    }, timeoutMs);

    const onMessage = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const msg = message as Partial<ToolApprovalUiEventMessage> | undefined;
      if (!msg || msg.type !== BACKGROUND_MESSAGE_TYPES.TOOL_APPROVAL_UI_EVENT) return;
      if (msg.sessionId !== sessionId) return;
      if (sender?.tab?.id !== tab.id) return;

      sendResponse({ success: true });

      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      void hidePrompt(tab, sessionId);

      const approved = msg.event === 'approve';
      resolve({ approved, reason: approved ? 'approved' : 'denied' });
    };

    chrome.runtime.onMessage.addListener(onMessage);
  });
}

export async function requestToolApproval(req: ToolApprovalRequest): Promise<ToolApprovalResult> {
  const run = async () => requestToolApprovalImpl(req);
  const chained = approvalQueue.then(run, run);
  approvalQueue = chained.then(
    () => undefined,
    () => undefined,
  );
  return chained;
}
