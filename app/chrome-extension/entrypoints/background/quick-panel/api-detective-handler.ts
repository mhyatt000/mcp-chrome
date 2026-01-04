/**
 * Quick Panel API Detective Handler
 *
 * Background service worker bridge for "API Detective" diagnostics:
 * - Start/stop a short-lived network capture session
 * - List captured requests and fetch request details
 * - Replay a captured request in the originating tab context
 *
 * Notes:
 * - Uses KeepaliveManager to reduce MV3 service worker eviction during capture sessions.
 * - Stores the last capture in-memory per tab (best-effort). Reopening the browser or SW restart clears it.
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelApiDetectiveBackend,
  type QuickPanelApiDetectiveGetRequestMessage,
  type QuickPanelApiDetectiveGetRequestResponse,
  type QuickPanelApiDetectiveListMessage,
  type QuickPanelApiDetectiveListResponse,
  type QuickPanelApiDetectiveReplayRequestMessage,
  type QuickPanelApiDetectiveReplayRequestResponse,
  type QuickPanelApiDetectiveStartMessage,
  type QuickPanelApiDetectiveStartResponse,
  type QuickPanelApiDetectiveStatusMessage,
  type QuickPanelApiDetectiveStatusResponse,
  type QuickPanelApiDetectiveStopMessage,
  type QuickPanelApiDetectiveStopResponse,
  type QuickPanelApiDetectiveRequestDetail,
  type QuickPanelApiDetectiveRequestSummary,
} from '@/common/message-types';
import { acquireKeepalive } from '@/entrypoints/background/keepalive-manager';
import { getFirstTextContent } from './devtools-export';

const LOG_PREFIX = '[QuickPanelApiDetective]';

// ============================================================
// Types
// ============================================================

interface ApiDetectiveSession {
  backend: QuickPanelApiDetectiveBackend;
  startedAt: number;
  keepaliveRelease: () => void;
}

interface ApiDetectiveCapture {
  backend: QuickPanelApiDetectiveBackend;
  capturedAt: number;
  tabUrl: string;
  items: QuickPanelApiDetectiveRequestSummary[];
  byId: Map<string, QuickPanelApiDetectiveRequestDetail>;
}

// ============================================================
// State (best-effort, in-memory)
// ============================================================

const sessionsByTabId = new Map<number, ApiDetectiveSession>();
const lastCaptureByTabId = new Map<number, ApiDetectiveCapture>();

// ============================================================
// Helpers
// ============================================================

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function getTabIdOrError(
  sender: chrome.runtime.MessageSender,
): { ok: true; tabId: number } | { ok: false; error: string } {
  const tabId = sender.tab?.id;
  if (typeof tabId === 'number' && Number.isFinite(tabId) && tabId > 0) return { ok: true, tabId };
  return { ok: false, error: 'Quick Panel request must originate from a tab.' };
}

function getRequestBodyPreview(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxLen - 1))}\u2026`;
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeString(k).trim();
    const val = normalizeString(v).trim();
    if (!key || !val) continue;
    out[key] = val;
  }
  return out;
}

function parseNetworkCaptureStopPayload(text: string):
  | {
      ok: true;
      backend: QuickPanelApiDetectiveBackend;
      tabUrl: string;
      requests: Array<{
        requestId: string;
        method: string;
        url: string;
        type?: string;
        status?: number;
        mimeType?: string;
        requestBody?: string;
        specificRequestHeaders?: Record<string, string>;
      }>;
    }
  | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text) as any;
    if (parsed?.success !== true) {
      return { ok: false, error: normalizeString(parsed?.message) || 'Network capture failed' };
    }

    const backendRaw = normalizeString(parsed?.backend);
    const backend: QuickPanelApiDetectiveBackend =
      backendRaw === 'debugger' ? 'debugger' : 'webRequest';

    const tabUrl = normalizeString(parsed?.tabUrl) || normalizeString(parsed?.url) || '';

    const requestsRaw = Array.isArray(parsed?.requests) ? parsed.requests : [];
    const requests = requestsRaw
      .map((r: any) => ({
        requestId: normalizeString(r?.requestId),
        method: normalizeString(r?.method).toUpperCase() || 'GET',
        url: normalizeString(r?.url),
        type: normalizeString(r?.type) || undefined,
        status:
          typeof r?.status === 'number' && Number.isFinite(r.status)
            ? r.status
            : typeof r?.statusCode === 'number' && Number.isFinite(r.statusCode)
              ? r.statusCode
              : undefined,
        mimeType: normalizeString(r?.mimeType) || undefined,
        requestBody: typeof r?.requestBody === 'string' ? r.requestBody : undefined,
        specificRequestHeaders: normalizeHeaders(r?.specificRequestHeaders),
      }))
      .filter((r: any) => r.requestId && r.url);

    return { ok: true, backend, tabUrl, requests };
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) || 'Failed to parse network capture output' };
  }
}

// ============================================================
// Handlers
// ============================================================

async function handleStatus(
  _message: QuickPanelApiDetectiveStatusMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelApiDetectiveStatusResponse> {
  const tab = getTabIdOrError(sender);
  if (!tab.ok) return { success: false, error: tab.error };

  const session = sessionsByTabId.get(tab.tabId) ?? null;
  const last = lastCaptureByTabId.get(tab.tabId) ?? null;

  return {
    success: true,
    active: !!session,
    backend: session?.backend ?? null,
    startedAt: session?.startedAt ?? null,
    lastCaptureAt: last?.capturedAt ?? null,
    lastRequestCount: last?.items?.length ?? 0,
  };
}

async function handleStart(
  message: QuickPanelApiDetectiveStartMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelApiDetectiveStartResponse> {
  const tab = getTabIdOrError(sender);
  if (!tab.ok) return { success: false, error: tab.error };

  if (sessionsByTabId.has(tab.tabId)) {
    return { success: false, error: 'API Detective is already active for this tab.' };
  }

  const needResponseBody = normalizeBoolean(message.payload?.needResponseBody);
  const includeStatic = normalizeBoolean(message.payload?.includeStatic);
  const maxCaptureTimeMs = normalizeInt(message.payload?.maxCaptureTimeMs, 180_000, 1_000, 600_000);

  const backend: QuickPanelApiDetectiveBackend = needResponseBody ? 'debugger' : 'webRequest';
  const releaseKeepalive = acquireKeepalive('quick-panel-api-detective');
  const startedAt = Date.now();

  try {
    const { networkCaptureTool } = await import('../tools/browser');

    const res = await networkCaptureTool.execute({
      action: 'start',
      tabId: tab.tabId,
      needResponseBody,
      maxCaptureTime: maxCaptureTimeMs,
      inactivityTimeout: 0,
      includeStatic,
    });

    if (res?.isError === true) {
      releaseKeepalive();
      return { success: false, error: getFirstTextContent(res) || 'Failed to start capture.' };
    }

    sessionsByTabId.set(tab.tabId, { backend, startedAt, keepaliveRelease: releaseKeepalive });

    return { success: true, active: true, backend, startedAt };
  } catch (err) {
    releaseKeepalive();
    return { success: false, error: safeErrorMessage(err) || 'Failed to start capture.' };
  }
}

async function handleStop(
  _message: QuickPanelApiDetectiveStopMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelApiDetectiveStopResponse> {
  const tab = getTabIdOrError(sender);
  if (!tab.ok) return { success: false, error: tab.error };

  const session = sessionsByTabId.get(tab.tabId);
  if (!session) return { success: false, error: 'API Detective is not active for this tab.' };

  const capturedAt = Date.now();

  try {
    const { networkCaptureTool } = await import('../tools/browser');

    const stopRes = await networkCaptureTool.execute({
      action: 'stop',
      tabId: tab.tabId,
      needResponseBody: session.backend === 'debugger',
    });

    if (stopRes?.isError === true) {
      return { success: false, error: getFirstTextContent(stopRes) || 'Failed to stop capture.' };
    }

    const text = getFirstTextContent(stopRes);
    if (!text) return { success: false, error: 'Network capture returned no output.' };

    const parsed = parseNetworkCaptureStopPayload(text);
    if (!parsed.ok) return { success: false, error: parsed.error };

    const items: QuickPanelApiDetectiveRequestSummary[] = [];
    const byId = new Map<string, QuickPanelApiDetectiveRequestDetail>();

    for (const req of parsed.requests) {
      const requestId = req.requestId;
      const summary: QuickPanelApiDetectiveRequestSummary = {
        requestId,
        method: req.method,
        url: req.url,
        type: req.type,
        status: req.status,
        mimeType: req.mimeType,
        requestBodyPreview: getRequestBodyPreview(req.requestBody, 160),
      };
      items.push(summary);
      byId.set(requestId, {
        requestId,
        method: req.method,
        url: req.url,
        type: req.type,
        status: req.status,
        mimeType: req.mimeType,
        requestHeaders: req.specificRequestHeaders ?? {},
        requestBody: req.requestBody,
      });
    }

    lastCaptureByTabId.set(tab.tabId, {
      backend: session.backend,
      capturedAt,
      tabUrl: parsed.tabUrl,
      items,
      byId,
    });

    return {
      success: true,
      active: false,
      backend: session.backend,
      capturedAt,
      requestCount: items.length,
    };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to stop capture.' };
  } finally {
    try {
      session.keepaliveRelease();
    } catch {
      // Best-effort
    }
    sessionsByTabId.delete(tab.tabId);
  }
}

async function handleList(
  message: QuickPanelApiDetectiveListMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelApiDetectiveListResponse> {
  const tab = getTabIdOrError(sender);
  if (!tab.ok) return { success: false, error: tab.error };

  const session = sessionsByTabId.get(tab.tabId) ?? null;
  const last = lastCaptureByTabId.get(tab.tabId) ?? null;

  const active = !!session;
  const backend = session?.backend ?? last?.backend ?? null;
  const capturedAt = last?.capturedAt ?? null;
  const tabUrl = last?.tabUrl ?? null;

  const rawQuery = normalizeString(message.payload?.query).trim().toLowerCase();
  const maxResults = normalizeInt(message.payload?.maxResults, 50, 1, 200);

  let items = last?.items ?? [];
  if (rawQuery) {
    items = items.filter((it) => {
      const haystack = `${it.method} ${it.url} ${it.type || ''} ${it.mimeType || ''}`.toLowerCase();
      return haystack.includes(rawQuery);
    });
  }

  return {
    success: true,
    active,
    backend,
    capturedAt,
    tabUrl,
    items: items.slice(0, maxResults),
  };
}

async function handleGetRequest(
  message: QuickPanelApiDetectiveGetRequestMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelApiDetectiveGetRequestResponse> {
  const tab = getTabIdOrError(sender);
  if (!tab.ok) return { success: false, error: tab.error };

  const requestId = normalizeString(message.payload?.requestId).trim();
  if (!requestId) return { success: false, error: 'Invalid requestId' };

  const last = lastCaptureByTabId.get(tab.tabId);
  if (!last) return { success: false, error: 'No captured requests found for this tab.' };

  const req = last.byId.get(requestId);
  if (!req) return { success: false, error: 'Request not found in last capture.' };

  return { success: true, request: req };
}

async function handleReplayRequest(
  message: QuickPanelApiDetectiveReplayRequestMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelApiDetectiveReplayRequestResponse> {
  const tab = getTabIdOrError(sender);
  if (!tab.ok) return { success: false, error: tab.error };

  const requestId = normalizeString(message.payload?.requestId).trim();
  if (!requestId) return { success: false, error: 'Invalid requestId' };

  const last = lastCaptureByTabId.get(tab.tabId);
  if (!last) return { success: false, error: 'No captured requests found for this tab.' };

  const req = last.byId.get(requestId);
  if (!req) return { success: false, error: 'Request not found in last capture.' };

  try {
    const timeoutMs = normalizeInt(message.payload?.timeoutMs, 30_000, 1_000, 120_000);
    const { networkRequestTool } = await import('../tools/browser');

    const res = await networkRequestTool.execute({
      tabId: tab.tabId,
      url: req.url,
      method: req.method,
      headers: req.requestHeaders,
      body: req.requestBody,
      timeout: timeoutMs,
    });

    if (res?.isError === true) {
      return { success: false, error: getFirstTextContent(res) || 'Request replay failed.' };
    }

    const text = getFirstTextContent(res);
    if (!text) return { success: true, result: null };

    try {
      return { success: true, result: JSON.parse(text) };
    } catch {
      return { success: true, result: text };
    }
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Request replay failed.' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

export function initQuickPanelApiDetectiveHandler(): void {
  if (initialized) return;
  initialized = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STATUS) {
      handleStatus(message as QuickPanelApiDetectiveStatusMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_START) {
      handleStart(message as QuickPanelApiDetectiveStartMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STOP) {
      handleStop(message as QuickPanelApiDetectiveStopMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_LIST) {
      handleList(message as QuickPanelApiDetectiveListMessage, sender).then(sendResponse);
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_GET_REQUEST) {
      handleGetRequest(message as QuickPanelApiDetectiveGetRequestMessage, sender).then(
        sendResponse,
      );
      return true;
    }
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_REPLAY_REQUEST) {
      handleReplayRequest(message as QuickPanelApiDetectiveReplayRequestMessage, sender).then(
        sendResponse,
      );
      return true;
    }
    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
