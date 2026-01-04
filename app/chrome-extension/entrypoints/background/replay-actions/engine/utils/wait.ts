/**
 * @fileoverview Navigation/network wait utilities
 * @description Shared, event-driven wait helpers for replay execution.
 *
 * These utilities are intentionally version-neutral so both legacy RR-V2 code paths and RR-V3 adapters
 * can share the same behavior without importing each other.
 */

import { TOOL_NAMES } from 'chrome-mcp-shared';

import { handleCallTool } from '@/entrypoints/background/tools';

export async function waitForNetworkIdle(totalTimeoutMs: number, idleThresholdMs: number) {
  const deadline = Date.now() + Math.max(500, totalTimeoutMs);
  const threshold = Math.max(200, idleThresholdMs);
  while (Date.now() < deadline) {
    await handleCallTool({
      name: TOOL_NAMES.BROWSER.NETWORK_CAPTURE_START,
      args: {
        includeStatic: false,
        // Ensure capture remains active until we explicitly stop it
        maxCaptureTime: Math.min(60_000, Math.max(threshold + 500, 2_000)),
        inactivityTimeout: 0,
      },
    });
    await new Promise((r) => setTimeout(r, threshold + 200));
    const stopRes = await handleCallTool({
      name: TOOL_NAMES.BROWSER.NETWORK_CAPTURE_STOP,
      args: {},
    });
    const text = (stopRes as { content?: Array<{ type?: string; text?: string }> })?.content?.find(
      (c) => c.type === 'text',
    )?.text;
    try {
      const json = text ? JSON.parse(text) : null;
      const captureEnd = Number(json?.captureEndTime) || Date.now();
      const reqs: unknown[] = Array.isArray(json?.requests) ? json.requests : [];
      const lastActivity = reqs.reduce(
        (acc: number, r: unknown) => {
          const rec = r as { responseTime?: unknown; requestTime?: unknown };
          const t = Number(rec.responseTime || rec.requestTime || 0);
          return t > acc ? t : acc;
        },
        Number(json?.captureStartTime || 0),
      );
      if (captureEnd - lastActivity >= threshold) return; // idle reached
    } catch {
      // ignore parse errors
    }
    await new Promise((r) => setTimeout(r, Math.min(500, threshold)));
  }
  throw new Error('wait for network idle timed out');
}

/**
 * Event-driven navigation wait helper.
 *
 * Waits for top-frame navigation completion or SPA history updates on the active tab.
 * Falls back to a short network-idle check on timeout.
 */
export async function waitForNavigation(timeoutMs?: number, prevUrl?: string): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs?.[0]?.id;
  if (typeof tabId !== 'number') throw new Error('Active tab not found');
  const timeout = Math.max(1000, Math.min(timeoutMs || 15000, 30000));
  const startedAt = Date.now();

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const cleanup = () => {
      try {
        chrome.webNavigation.onCommitted.removeListener(onCommitted);
      } catch {}
      try {
        chrome.webNavigation.onCompleted.removeListener(onCompleted);
      } catch {}
      try {
        (
          chrome.webNavigation as unknown as { onHistoryStateUpdated?: chrome.events.Event }
        ).onHistoryStateUpdated?.removeListener?.(onHistoryStateUpdated);
      } catch {}
      try {
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
      } catch {}
      if (timer) {
        try {
          clearTimeout(timer);
        } catch {}
      }
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const onCommitted = (details: unknown) => {
      const d = details as { tabId?: unknown; frameId?: unknown; timeStamp?: unknown };
      if (
        d &&
        d.tabId === tabId &&
        d.frameId === 0 &&
        typeof d.timeStamp === 'number' &&
        d.timeStamp >= startedAt
      ) {
        // committed observed; we'll wait for completion or SPA fallback
      }
    };
    const onCompleted = (details: unknown) => {
      const d = details as { tabId?: unknown; frameId?: unknown; timeStamp?: unknown };
      if (
        d &&
        d.tabId === tabId &&
        d.frameId === 0 &&
        typeof d.timeStamp === 'number' &&
        d.timeStamp >= startedAt
      )
        finish();
    };
    const onHistoryStateUpdated = (details: unknown) => {
      const d = details as { tabId?: unknown; frameId?: unknown; timeStamp?: unknown };
      if (
        d &&
        d.tabId === tabId &&
        d.frameId === 0 &&
        typeof d.timeStamp === 'number' &&
        d.timeStamp >= startedAt
      )
        finish();
    };
    const onTabUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') finish();
      if (typeof changeInfo.url === 'string' && (!prevUrl || changeInfo.url !== prevUrl)) finish();
    };
    const onTimeout = async () => {
      cleanup();
      try {
        await waitForNetworkIdle(2000, 800);
        resolve();
      } catch {
        reject(new Error('navigation timeout'));
      }
    };

    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.webNavigation.onCompleted.addListener(onCompleted);
    try {
      (
        chrome.webNavigation as unknown as { onHistoryStateUpdated?: chrome.events.Event }
      ).onHistoryStateUpdated?.addListener?.(onHistoryStateUpdated);
    } catch {}
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    timer = setTimeout(onTimeout, timeout);
  });
}
