/**
 * Quick Panel Debug Bundle
 *
 * Orchestrates a "one-click" diagnostic bundle collection for the current tab.
 *
 * Output format:
 * - A Downloads folder: `quick_panel_debug_bundle_<timestamp>/`
 * - Individual artifacts (screenshot/console/network/performance/read_page)
 * - A `manifest.json` describing steps, errors, and saved filenames
 *
 * Notes:
 * - Uses KeepaliveManager to reduce MV3 service worker eviction during the run.
 * - Implements cancellation via `AbortController` keyed by tabId.
 */

import { acquireKeepalive } from '@/entrypoints/background/keepalive-manager';
import {
  getFirstTextContent,
  saveBase64ToDownloadsPath,
  saveTextToDownloadsPath,
  type QuickPanelDownloadInfo,
} from './devtools-export';

const LOG_PREFIX = '[QuickPanelDebugBundle]';

const NETWORK_CAPTURE_DURATION_MS = 10_000;
const PERFORMANCE_TRACE_DURATION_MS = 5_000;
const PERFORMANCE_TRACE_STOP_BUFFER_MS = 500;

class DebugBundleCancelledError extends Error {
  constructor(message = 'Debug bundle cancelled') {
    super(message);
    this.name = 'DebugBundleCancelledError';
  }
}

interface DebugBundleStepRecord {
  name: string;
  success: boolean;
  startedAt: number;
  endedAt: number;
  error?: string;
  download?: QuickPanelDownloadInfo;
}

interface DebugBundleSession {
  abortController: AbortController;
  startedAt: number;
  folder: string;
  keepaliveRelease: () => void;
}

const sessionsByTabId = new Map<number, DebugBundleSession>();

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function createFolderName(now: number): string {
  const ts = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `quick_panel_debug_bundle_${ts}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DebugBundleCancelledError();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (n === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DebugBundleCancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, n);

    if (signal.aborted) {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DebugBundleCancelledError());
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function guessImageExtension(mimeType: string): 'png' | 'jpg' | 'webp' | 'bin' {
  const mt = mimeType.toLowerCase();
  if (mt.includes('png')) return 'png';
  if (mt.includes('jpeg') || mt.includes('jpg')) return 'jpg';
  if (mt.includes('webp')) return 'webp';
  return 'bin';
}

function parseScreenshotBase64(text: string): { base64Data: string; mimeType: string } | null {
  try {
    const parsed = JSON.parse(text) as { base64Data?: unknown; mimeType?: unknown };
    const base64Data = normalizeString(parsed?.base64Data).trim();
    const mimeType = normalizeString(parsed?.mimeType).trim() || 'image/jpeg';
    if (!base64Data) return null;
    return { base64Data, mimeType };
  } catch {
    return null;
  }
}

function parsePerformanceStopDownload(text: string): QuickPanelDownloadInfo | null {
  try {
    const parsed = JSON.parse(text) as {
      success?: unknown;
      message?: unknown;
      saved?: { downloadId?: unknown; filename?: unknown; fullPath?: unknown };
    };

    if (parsed?.success !== true) return null;
    if (!parsed?.saved) return null;

    return {
      downloadId: typeof parsed.saved.downloadId === 'number' ? parsed.saved.downloadId : undefined,
      filename: typeof parsed.saved.filename === 'string' ? parsed.saved.filename : undefined,
      fullPath: typeof parsed.saved.fullPath === 'string' ? parsed.saved.fullPath : undefined,
    };
  } catch {
    return null;
  }
}

export function cancelQuickPanelDebugBundle(
  tabId: number,
): { success: true } | { success: false; error: string } {
  const session = sessionsByTabId.get(tabId);
  if (!session) return { success: false, error: 'No active debug bundle for this tab.' };
  try {
    session.abortController.abort();
    return { success: true };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) || 'Failed to cancel debug bundle.' };
  }
}

export async function createQuickPanelDebugBundle(tab: {
  tabId: number;
  tabUrl: string;
  tabTitle: string;
}): Promise<{
  folder: string;
  manifest: QuickPanelDownloadInfo;
  steps: DebugBundleStepRecord[];
}> {
  const existing = sessionsByTabId.get(tab.tabId);
  if (existing) {
    throw new Error('A debug bundle is already running for this tab.');
  }

  const startedAt = Date.now();
  const folder = createFolderName(startedAt);
  const keepaliveRelease = acquireKeepalive('quick-panel-debug-bundle');
  const abortController = new AbortController();

  sessionsByTabId.set(tab.tabId, { abortController, startedAt, folder, keepaliveRelease });

  const steps: DebugBundleStepRecord[] = [];
  let networkStarted = false;
  let perfStarted = false;
  let networkCaptureStartedAt: number | null = null;
  let perfStartedAt: number | null = null;

  try {
    const signal = abortController.signal;

    // Allow the Quick Panel overlay to close before collecting UI-dependent artifacts.
    await sleep(0, signal);
    throwIfAborted(signal);

    const {
      consoleTool,
      networkCaptureTool,
      performanceStartTraceTool,
      performanceStopTraceTool,
      readPageTool,
      screenshotTool,
    } = await import('../tools/browser');

    // 1) Start network capture (webRequest backend).
    {
      const step: DebugBundleStepRecord = {
        name: 'network_capture_start',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        const res = await networkCaptureTool.execute({
          action: 'start',
          tabId: tab.tabId,
          needResponseBody: false,
          maxCaptureTime: 0,
          inactivityTimeout: 0,
          includeStatic: false,
        });

        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to start network capture.');
        }

        networkStarted = true;
        networkCaptureStartedAt = Date.now();
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to start network capture.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 2) Start performance trace (auto-stop).
    {
      const step: DebugBundleStepRecord = {
        name: 'performance_trace_start',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        const res = await performanceStartTraceTool.execute({
          tabId: tab.tabId,
          autoStop: true,
          durationMs: PERFORMANCE_TRACE_DURATION_MS,
        });
        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to start performance trace.');
        }

        const text = getFirstTextContent(res);
        if (!text) {
          throw new Error('Performance trace start returned no output.');
        }
        try {
          const parsed = JSON.parse(text) as { success?: unknown; message?: unknown };
          if (parsed?.success !== true) {
            throw new Error(
              typeof parsed?.message === 'string'
                ? parsed.message
                : 'Failed to start performance trace.',
            );
          }
        } catch (err) {
          throw err instanceof Error ? err : new Error(text);
        }

        perfStarted = true;
        perfStartedAt = Date.now();
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to start performance trace.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 3) Screenshot (base64) -> Downloads.
    {
      const step: DebugBundleStepRecord = {
        name: 'screenshot',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        throwIfAborted(signal);

        const res = await screenshotTool.execute({
          tabId: tab.tabId,
          fullPage: false,
          savePng: false,
          storeBase64: true,
          background: false,
        });

        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to capture screenshot.');
        }

        const text = getFirstTextContent(res);
        if (!text) throw new Error('Screenshot returned no output.');

        const parsed = parseScreenshotBase64(text);
        if (!parsed) throw new Error('Failed to parse screenshot output.');

        const ext = guessImageExtension(parsed.mimeType);
        const download = await saveBase64ToDownloadsPath({
          base64Data: parsed.base64Data,
          filename: `${folder}/screenshot.${ext}`,
          mimeType: parsed.mimeType,
        });

        step.download = download;
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to capture screenshot.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 4) Console snapshot -> Downloads.
    {
      const step: DebugBundleStepRecord = {
        name: 'console_snapshot',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        throwIfAborted(signal);

        const res = await consoleTool.execute({
          tabId: tab.tabId,
          mode: 'snapshot',
          includeExceptions: true,
          maxMessages: 200,
        });

        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to capture console snapshot.');
        }

        const text = getFirstTextContent(res);
        if (!text) throw new Error('Console tool returned no output.');

        const download = await saveTextToDownloadsPath({
          text,
          filename: `${folder}/console_snapshot.json`,
          mimeType: 'application/json',
        });

        step.download = download;
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to capture console snapshot.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 5) Console errors -> Downloads.
    {
      const step: DebugBundleStepRecord = {
        name: 'console_errors',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        throwIfAborted(signal);

        const res = await consoleTool.execute({
          tabId: tab.tabId,
          mode: 'snapshot',
          includeExceptions: true,
          maxMessages: 200,
          onlyErrors: true,
        });

        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to capture console errors.');
        }

        const text = getFirstTextContent(res);
        if (!text) throw new Error('Console tool returned no output.');

        const download = await saveTextToDownloadsPath({
          text,
          filename: `${folder}/console_errors.json`,
          mimeType: 'application/json',
        });

        step.download = download;
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to capture console errors.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 6) read_page (interactive) -> Downloads.
    {
      const step: DebugBundleStepRecord = {
        name: 'read_page_interactive',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        throwIfAborted(signal);

        const res = await readPageTool.execute({ tabId: tab.tabId, filter: 'interactive' });
        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to read page.');
        }

        const text = getFirstTextContent(res);
        if (!text) throw new Error('read_page returned no output.');

        const download = await saveTextToDownloadsPath({
          text,
          filename: `${folder}/read_page.json`,
          mimeType: 'application/json',
        });

        step.download = download;
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to read page.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 7) Wait for performance auto-stop window, then stop+save trace to Downloads.
    {
      const step: DebugBundleStepRecord = {
        name: 'performance_trace_stop',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        if (!perfStarted || perfStartedAt === null) {
          throw new Error('Skipped: performance trace was not started.');
        }

        const elapsed = Date.now() - perfStartedAt;
        const minWait = PERFORMANCE_TRACE_DURATION_MS + PERFORMANCE_TRACE_STOP_BUFFER_MS;
        if (elapsed < minWait) await sleep(minWait - elapsed, signal);
        throwIfAborted(signal);

        const res = await performanceStopTraceTool.execute({
          tabId: tab.tabId,
          saveToDownloads: true,
          filenamePrefix: `${folder}/performance_trace`,
        });

        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to stop performance trace.');
        }

        const text = getFirstTextContent(res);
        if (!text) throw new Error('Performance trace stop returned no output.');

        const download = parsePerformanceStopDownload(text);
        if (download) step.download = download;

        perfStarted = false;
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to stop performance trace.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 8) Wait for network capture duration, then stop+save.
    {
      const step: DebugBundleStepRecord = {
        name: 'network_capture_stop',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        if (!networkStarted || networkCaptureStartedAt === null) {
          throw new Error('Skipped: network capture was not started.');
        }

        const elapsed = Date.now() - networkCaptureStartedAt;
        if (elapsed < NETWORK_CAPTURE_DURATION_MS)
          await sleep(NETWORK_CAPTURE_DURATION_MS - elapsed, signal);
        throwIfAborted(signal);

        const res = await networkCaptureTool.execute({
          action: 'stop',
          tabId: tab.tabId,
          needResponseBody: false,
        });

        if (res?.isError === true) {
          throw new Error(getFirstTextContent(res) || 'Failed to stop network capture.');
        }

        const text = getFirstTextContent(res);
        if (!text) throw new Error('Network capture returned no output.');

        const download = await saveTextToDownloadsPath({
          text,
          filename: `${folder}/network_capture.json`,
          mimeType: 'application/json',
        });

        networkStarted = false;
        step.download = download;
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to stop network capture.';
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    // 9) Save manifest as the entry point to the bundle.
    {
      const step: DebugBundleStepRecord = {
        name: 'manifest',
        success: false,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      try {
        throwIfAborted(signal);

        const manifest = {
          schemaVersion: 1,
          createdAt: startedAt,
          folder,
          tabId: tab.tabId,
          tabUrl: tab.tabUrl,
          tabTitle: tab.tabTitle,
          extensionVersion: chrome.runtime?.getManifest?.()?.version,
          steps,
        };

        const text = JSON.stringify(manifest, null, 2);
        const download = await saveTextToDownloadsPath({
          text,
          filename: `${folder}/manifest.json`,
          mimeType: 'application/json',
        });

        step.download = download;
        step.success = true;
      } catch (err) {
        step.error = safeErrorMessage(err) || 'Failed to save manifest.';
        throw err;
      } finally {
        step.endedAt = Date.now();
        steps.push(step);
      }
    }

    let manifestStep: DebugBundleStepRecord | undefined;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i]?.name === 'manifest') {
        manifestStep = steps[i];
        break;
      }
    }
    if (!manifestStep?.download) {
      throw new Error('Debug bundle completed but manifest download is missing.');
    }

    return { folder, manifest: manifestStep.download, steps };
  } catch (err) {
    if (err instanceof DebugBundleCancelledError) {
      console.warn(`${LOG_PREFIX} Cancelled for tab ${tab.tabId}`);
      throw err;
    }
    console.warn(`${LOG_PREFIX} Failed for tab ${tab.tabId}:`, err);
    throw err;
  } finally {
    const session = sessionsByTabId.get(tab.tabId);
    sessionsByTabId.delete(tab.tabId);

    // Best-effort cleanup of long-lived captures.
    try {
      const { networkCaptureTool } = await import('../tools/browser');
      if (networkStarted) {
        await networkCaptureTool.execute({
          action: 'stop',
          tabId: tab.tabId,
          needResponseBody: false,
        });
      }
    } catch {
      // Best-effort
    }

    try {
      const { performanceStopTraceTool } = await import('../tools/browser');
      if (perfStarted) {
        await performanceStopTraceTool.execute({
          tabId: tab.tabId,
          saveToDownloads: false,
          filenamePrefix: `${folder}/performance_trace`,
        });
      }
    } catch {
      // Best-effort
    }

    try {
      session?.keepaliveRelease?.();
    } catch {
      // Best-effort
    }
  }
}
