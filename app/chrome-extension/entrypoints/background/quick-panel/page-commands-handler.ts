/**
 * Quick Panel Page Commands Handler
 *
 * Background service worker bridge for:
 * - QUICK_PANEL_OPEN_URL (Bookmarks/History providers)
 * - QUICK_PANEL_PAGE_COMMAND (Commands provider)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelOpenUrlDisposition,
  type QuickPanelOpenUrlMessage,
  type QuickPanelOpenUrlResponse,
  type QuickPanelPageCommand,
  type QuickPanelPageCommandMessage,
  type QuickPanelPageCommandResponse,
} from '@/common/message-types';
import { getFirstTextContent, saveTextToDownloads } from './devtools-export';
import {
  applyQuickPanelPageSkin,
  clearQuickPanelPageSkin,
  initQuickPanelPageSkinsLifecycle,
} from './page-skins';
import {
  toggleQuickPanelAllowCopy,
  toggleQuickPanelForceDark,
  toggleQuickPanelPrivacyCurtain,
  toggleQuickPanelReaderMode,
  toggleQuickPanelZenMode,
} from './page-tools';

const LOG_PREFIX = '[QuickPanelPageCommands]';

// ============================================================
// Helpers
// ============================================================

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function isValidTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isValidWindowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeDisposition(value: unknown): QuickPanelOpenUrlDisposition {
  if (value === 'new_tab' || value === 'background_tab' || value === 'current_tab') return value;
  return 'current_tab';
}

function delay(ms: number): Promise<void> {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return new Promise((resolve) => setTimeout(resolve, n));
}

/**
 * Validate URL scheme for security.
 * Only allows safe schemes: http, https, chrome, chrome-extension, file.
 * Rejects dangerous schemes: javascript, data, vbscript, etc.
 */
function isAllowedUrlScheme(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const scheme = urlObj.protocol.toLowerCase();
    // Allow only safe schemes
    return ['http:', 'https:', 'chrome:', 'chrome-extension:', 'file:'].includes(scheme);
  } catch {
    // Invalid URL format - let Chrome handle it
    // May be a relative URL or search query that Chrome will resolve
    return !url.toLowerCase().startsWith('javascript:') && !url.toLowerCase().startsWith('data:');
  }
}

// ============================================================
// Open URL Handler
// ============================================================

async function handleOpenUrl(
  message: QuickPanelOpenUrlMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelOpenUrlResponse> {
  try {
    const senderTabId = sender.tab?.id;
    const senderWindowId = sender.tab?.windowId;

    if (!isValidTabId(senderTabId)) {
      return { success: false, error: 'Quick Panel request must originate from a tab.' };
    }

    const url = normalizeString(message.payload?.url).trim();
    const disposition = normalizeDisposition(message.payload?.disposition);

    if (!url) {
      return { success: false, error: 'Invalid url' };
    }

    // Security: validate URL scheme
    if (!isAllowedUrlScheme(url)) {
      return { success: false, error: 'URL scheme not allowed' };
    }

    if (disposition === 'current_tab') {
      // Navigate in current tab
      await chrome.tabs.update(senderTabId, { url });
      return { success: true };
    }

    if (disposition === 'new_tab') {
      // Open in new foreground tab
      await chrome.tabs.create({
        url,
        active: true,
        windowId: isValidWindowId(senderWindowId) ? senderWindowId : undefined,
      });
      return { success: true };
    }

    // background_tab: Open in new background tab
    await chrome.tabs.create({
      url,
      active: false,
      windowId: isValidWindowId(senderWindowId) ? senderWindowId : undefined,
    });
    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error opening url:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to open url' };
  }
}

// ============================================================
// Page Command Handler
// ============================================================

async function handlePageCommand(
  message: QuickPanelPageCommandMessage,
  sender: chrome.runtime.MessageSender,
): Promise<QuickPanelPageCommandResponse> {
  try {
    const command = message.payload?.command as QuickPanelPageCommand | undefined;
    if (!command) {
      return { success: false, error: 'Invalid command' };
    }

    const senderTabId = sender.tab?.id;
    const senderWindowId = sender.tab?.windowId;

    // Commands that don't require a sender tab
    if (command === 'new_tab') {
      await chrome.tabs.create({
        windowId: isValidWindowId(senderWindowId) ? senderWindowId : undefined,
      });
      return { success: true };
    }

    if (command === 'new_window') {
      await chrome.windows.create({});
      return { success: true };
    }

    if (command === 'new_incognito_window') {
      await chrome.windows.create({ incognito: true });
      return { success: true };
    }

    // Commands that require a sender tab
    if (!isValidTabId(senderTabId)) {
      return { success: false, error: 'Quick Panel request must originate from a tab.' };
    }

    switch (command) {
      case 'reload':
        await chrome.tabs.reload(senderTabId);
        return { success: true };

      case 'back':
        await chrome.tabs.goBack(senderTabId);
        return { success: true };

      case 'forward':
        await chrome.tabs.goForward(senderTabId);
        return { success: true };

      case 'stop':
        // Note: chrome.tabs.stop is not available in manifest v3
        // Using discard as a workaround is not ideal, so we'll try to inject script
        try {
          await chrome.scripting.executeScript({
            target: { tabId: senderTabId },
            func: () => window.stop(),
          });
        } catch {
          // Fallback: just return success since some pages may not allow scripting
        }
        return { success: true };

      case 'screenshot': {
        try {
          const { screenshotTool } = await import('../tools/browser');

          const res = await screenshotTool.execute({
            name: 'quick_panel',
            tabId: senderTabId,
            fullPage: false,
            savePng: true,
            storeBase64: false,
            background: false,
          });

          if (res?.isError === true) {
            const text = (res as any)?.content?.[0]?.text;
            const msg =
              typeof text === 'string' && text.trim() ? text : 'Failed to capture screenshot';
            return { success: false, error: msg };
          }

          return { success: true };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error capturing screenshot:`, err);
          return { success: false, error: safeErrorMessage(err) || 'Failed to capture screenshot' };
        }
      }

      case 'dev_console_snapshot_export': {
        try {
          const { consoleTool } = await import('../tools/browser');

          const res = await consoleTool.execute({
            tabId: senderTabId,
            mode: 'snapshot',
            includeExceptions: true,
            maxMessages: 200,
          });

          if (res?.isError === true) {
            return {
              success: false,
              error: getFirstTextContent(res) || 'Failed to capture console.',
            };
          }

          const text = getFirstTextContent(res);
          if (!text) return { success: false, error: 'Console tool returned no output.' };

          const download = await saveTextToDownloads({
            text,
            filenamePrefix: 'quick_panel_console_snapshot',
            extension: 'json',
            mimeType: 'application/json',
          });

          return {
            success: true,
            info: { message: 'Console snapshot exported to Downloads.', download },
          };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error exporting console snapshot:`, err);
          return { success: false, error: safeErrorMessage(err) || 'Failed to export console.' };
        }
      }

      case 'dev_console_errors_export': {
        try {
          const { consoleTool } = await import('../tools/browser');

          const res = await consoleTool.execute({
            tabId: senderTabId,
            mode: 'snapshot',
            includeExceptions: true,
            maxMessages: 200,
            onlyErrors: true,
          });

          if (res?.isError === true) {
            return {
              success: false,
              error: getFirstTextContent(res) || 'Failed to capture console errors.',
            };
          }

          const text = getFirstTextContent(res);
          if (!text) return { success: false, error: 'Console tool returned no output.' };

          const download = await saveTextToDownloads({
            text,
            filenamePrefix: 'quick_panel_console_errors',
            extension: 'json',
            mimeType: 'application/json',
          });

          return {
            success: true,
            info: { message: 'Console errors exported to Downloads.', download },
          };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error exporting console errors:`, err);
          return {
            success: false,
            error: safeErrorMessage(err) || 'Failed to export console errors.',
          };
        }
      }

      case 'dev_read_page_export': {
        try {
          const { readPageTool } = await import('../tools/browser');

          const res = await readPageTool.execute({ tabId: senderTabId, filter: 'interactive' });
          if (res?.isError === true) {
            return { success: false, error: getFirstTextContent(res) || 'Failed to read page.' };
          }

          const text = getFirstTextContent(res);
          if (!text) return { success: false, error: 'read_page returned no output.' };

          const download = await saveTextToDownloads({
            text,
            filenamePrefix: 'quick_panel_read_page',
            extension: 'json',
            mimeType: 'application/json',
          });

          return {
            success: true,
            info: { message: 'read_page exported to Downloads.', download },
          };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error exporting read_page:`, err);
          return { success: false, error: safeErrorMessage(err) || 'Failed to export read_page.' };
        }
      }

      case 'dev_network_capture_10s_export': {
        let started = false;
        try {
          const { networkCaptureTool } = await import('../tools/browser');

          const startRes = await networkCaptureTool.execute({
            action: 'start',
            needResponseBody: false,
            maxCaptureTime: 0,
            inactivityTimeout: 0,
            includeStatic: false,
          });

          if (startRes?.isError === true) {
            return {
              success: false,
              error: getFirstTextContent(startRes) || 'Failed to start network capture.',
            };
          }
          started = true;

          await delay(10_000);

          const stopRes = await networkCaptureTool.execute({
            action: 'stop',
            needResponseBody: false,
          });
          started = false;

          if (stopRes?.isError === true) {
            return {
              success: false,
              error: getFirstTextContent(stopRes) || 'Failed to stop network capture.',
            };
          }

          const text = getFirstTextContent(stopRes);
          if (!text) return { success: false, error: 'Network capture returned no output.' };

          const download = await saveTextToDownloads({
            text,
            filenamePrefix: 'quick_panel_network_capture',
            extension: 'json',
            mimeType: 'application/json',
          });

          return {
            success: true,
            info: { message: 'Network capture exported to Downloads.', download },
          };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error exporting network capture:`, err);
          return {
            success: false,
            error: safeErrorMessage(err) || 'Failed to export network capture.',
          };
        } finally {
          if (started) {
            try {
              const { networkCaptureTool } = await import('../tools/browser');
              await networkCaptureTool.execute({ action: 'stop', needResponseBody: false });
            } catch {
              // Best-effort cleanup.
            }
          }
        }
      }

      case 'dev_performance_trace_5s_export': {
        let started = false;
        try {
          const { performanceStartTraceTool, performanceStopTraceTool } =
            await import('../tools/browser');

          const startRes = await performanceStartTraceTool.execute({
            tabId: senderTabId,
            reload: false,
            autoStop: true,
            durationMs: 5000,
          });
          if (startRes?.isError === true) {
            return {
              success: false,
              error: getFirstTextContent(startRes) || 'Failed to start performance trace.',
            };
          }
          {
            const text = getFirstTextContent(startRes);
            if (!text)
              return { success: false, error: 'Performance trace start returned no output.' };
            try {
              const parsed = JSON.parse(text) as { success?: unknown; message?: unknown };
              if (parsed?.success !== true) {
                return {
                  success: false,
                  error:
                    typeof parsed?.message === 'string'
                      ? parsed.message
                      : 'Failed to start performance trace.',
                };
              }
            } catch {
              return { success: false, error: text };
            }
          }
          started = true;

          // Allow a small buffer after autoStop.
          await delay(5_500);

          const stopRes = await performanceStopTraceTool.execute({
            tabId: senderTabId,
            saveToDownloads: true,
            filenamePrefix: 'quick_panel_performance_trace',
          });

          if (stopRes?.isError === true) {
            return {
              success: false,
              error: getFirstTextContent(stopRes) || 'Failed to stop performance trace.',
            };
          }

          const stopText = getFirstTextContent(stopRes);
          if (!stopText)
            return { success: false, error: 'Performance trace stop returned no output.' };

          let download: { downloadId?: number; filename?: string; fullPath?: string } | undefined;
          try {
            const parsed = JSON.parse(stopText) as {
              success?: unknown;
              message?: unknown;
              saved?: { downloadId?: unknown; filename?: unknown; fullPath?: unknown };
            };

            if (parsed?.success !== true) {
              return {
                success: false,
                error:
                  typeof parsed?.message === 'string'
                    ? parsed.message
                    : 'Failed to stop performance trace.',
              };
            }

            if (parsed?.saved) {
              download = {
                downloadId:
                  typeof parsed.saved.downloadId === 'number' ? parsed.saved.downloadId : undefined,
                filename:
                  typeof parsed.saved.filename === 'string' ? parsed.saved.filename : undefined,
                fullPath:
                  typeof parsed.saved.fullPath === 'string' ? parsed.saved.fullPath : undefined,
              };
            }
          } catch {
            return { success: false, error: stopText };
          }

          started = false;

          return {
            success: true,
            info: { message: 'Performance trace exported to Downloads.', download },
          };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error exporting performance trace:`, err);
          return {
            success: false,
            error: safeErrorMessage(err) || 'Failed to export performance trace.',
          };
        } finally {
          if (started) {
            try {
              const { performanceStopTraceTool } = await import('../tools/browser');
              await performanceStopTraceTool.execute({
                tabId: senderTabId,
                saveToDownloads: false,
                filenamePrefix: 'quick_panel_performance_trace',
              });
            } catch {
              // Best-effort cleanup.
            }
          }
        }
      }

      case 'dev_debug_bundle_create': {
        try {
          const tab = await chrome.tabs.get(senderTabId);
          const tabUrl = normalizeString(tab?.url).trim();
          const tabTitle = normalizeString(tab?.title).trim();

          const { createQuickPanelDebugBundle } = await import('./debug-bundle');
          const result = await createQuickPanelDebugBundle({
            tabId: senderTabId,
            tabUrl,
            tabTitle: tabTitle || tabUrl || `Tab ${senderTabId}`,
          });

          return {
            success: true,
            info: {
              message: `Debug bundle saved to Downloads/${result.folder}/ (manifest.json).`,
              download: result.manifest,
            },
          };
        } catch (err) {
          if (err instanceof Error && err.name === 'DebugBundleCancelledError') {
            return { success: false, error: 'Debug bundle cancelled.' };
          }
          console.warn(`${LOG_PREFIX} Error creating debug bundle:`, err);
          return {
            success: false,
            error: safeErrorMessage(err) || 'Failed to create debug bundle.',
          };
        }
      }

      case 'dev_debug_bundle_cancel': {
        try {
          const { cancelQuickPanelDebugBundle } = await import('./debug-bundle');
          const res = cancelQuickPanelDebugBundle(senderTabId);
          if (!res.success) return { success: false, error: res.error };
          return { success: true, info: { message: 'Debug bundle cancelled.' } };
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error cancelling debug bundle:`, err);
          return {
            success: false,
            error: safeErrorMessage(err) || 'Failed to cancel debug bundle.',
          };
        }
      }

      case 'close_tab':
        await chrome.tabs.remove(senderTabId);
        return { success: true };

      case 'duplicate_tab':
        await chrome.tabs.duplicate(senderTabId);
        return { success: true };

      case 'toggle_pin': {
        const tab = await chrome.tabs.get(senderTabId);
        const pinned = tab?.pinned === true;
        await chrome.tabs.update(senderTabId, { pinned: !pinned });
        return { success: true };
      }

      case 'toggle_mute': {
        const tab = await chrome.tabs.get(senderTabId);
        const muted = tab?.mutedInfo?.muted === true;
        await chrome.tabs.update(senderTabId, { muted: !muted });
        return { success: true };
      }

      case 'close_other_tabs': {
        if (!isValidWindowId(senderWindowId)) {
          return { success: false, error: 'Invalid sender windowId' };
        }

        const tabs = await chrome.tabs.query({ windowId: senderWindowId });
        const toClose = (Array.isArray(tabs) ? tabs : [])
          .filter((t) => {
            if (!isValidTabId(t.id)) return false;
            if (t.id === senderTabId) return false;
            return normalizeBoolean(t.pinned) === false;
          })
          .map((t) => t.id as number);

        if (toClose.length > 0) {
          await chrome.tabs.remove(toClose);
        }

        return { success: true };
      }

      case 'close_tabs_to_right': {
        if (!isValidWindowId(senderWindowId)) {
          return { success: false, error: 'Invalid sender windowId' };
        }

        const current = await chrome.tabs.get(senderTabId);
        const currentIndex =
          typeof current?.index === 'number' && Number.isFinite(current.index)
            ? current.index
            : null;
        if (currentIndex === null) {
          return { success: false, error: 'Failed to determine current tab index' };
        }

        const tabs = await chrome.tabs.query({ windowId: senderWindowId });
        const toClose = (Array.isArray(tabs) ? tabs : [])
          .filter((t) => {
            if (!isValidTabId(t.id)) return false;
            if (normalizeBoolean(t.pinned)) return false;
            const idx = typeof t.index === 'number' && Number.isFinite(t.index) ? t.index : -1;
            return idx > currentIndex;
          })
          .map((t) => t.id as number);

        if (toClose.length > 0) {
          await chrome.tabs.remove(toClose);
        }

        return { success: true };
      }

      case 'discard_inactive_tabs': {
        if (!isValidWindowId(senderWindowId)) {
          return { success: false, error: 'Invalid sender windowId' };
        }

        const tabs = await chrome.tabs.query({ windowId: senderWindowId });
        const toDiscard = (Array.isArray(tabs) ? tabs : [])
          .filter((t) => {
            if (!isValidTabId(t.id)) return false;
            if (t.id === senderTabId) return false;
            if (normalizeBoolean(t.active)) return false;
            if (normalizeBoolean(t.pinned)) return false;
            return true;
          })
          .map((t) => t.id as number);

        if (toDiscard.length === 0) {
          return { success: true };
        }

        await Promise.allSettled(
          toDiscard.map(async (tabId) => {
            try {
              await chrome.tabs.discard(tabId);
            } catch {
              // Best-effort
            }
          }),
        );

        return { success: true };
      }

      case 'merge_all_windows': {
        if (!isValidWindowId(senderWindowId)) {
          return { success: false, error: 'Invalid sender windowId' };
        }

        const senderTab = await chrome.tabs.get(senderTabId);
        const isIncognito = normalizeBoolean(senderTab?.incognito);

        const allTabs = await chrome.tabs.query({});

        const byWindow = new Map<number, Array<{ tabId: number; index: number }>>();
        for (const t of Array.isArray(allTabs) ? allTabs : []) {
          if (!isValidTabId(t.id)) continue;
          if (!isValidWindowId(t.windowId)) continue;
          if (t.windowId === senderWindowId) continue;
          if (normalizeBoolean(t.incognito) !== isIncognito) continue;

          const idx = typeof t.index === 'number' && Number.isFinite(t.index) ? t.index : 0;
          const list = byWindow.get(t.windowId) ?? [];
          list.push({ tabId: t.id, index: idx });
          byWindow.set(t.windowId, list);
        }

        for (const [, list] of byWindow) {
          list.sort((a, b) => a.index - b.index);
          const tabIds = list.map((x) => x.tabId);
          if (tabIds.length === 0) continue;
          try {
            await chrome.tabs.move(tabIds, { windowId: senderWindowId, index: -1 });
          } catch {
            // Best-effort: continue with other windows.
          }
        }

        return { success: true };
      }

      case 'skin_vscode':
        return applyQuickPanelPageSkin(senderTabId, 'vscode');

      case 'skin_terminal':
        return applyQuickPanelPageSkin(senderTabId, 'terminal');

      case 'skin_retro':
        return applyQuickPanelPageSkin(senderTabId, 'retro');

      case 'skin_paper':
        return applyQuickPanelPageSkin(senderTabId, 'paper');

      case 'skin_off':
        return clearQuickPanelPageSkin(senderTabId);

      case 'zen_mode_toggle':
        return toggleQuickPanelZenMode(senderTabId);

      case 'force_dark_toggle':
        return toggleQuickPanelForceDark(senderTabId);

      case 'allow_copy_toggle':
        return toggleQuickPanelAllowCopy(senderTabId);

      case 'privacy_curtain_toggle':
        return toggleQuickPanelPrivacyCurtain(senderTabId);

      case 'reader_mode_toggle':
        return toggleQuickPanelReaderMode(senderTabId);

      default:
        return { success: false, error: `Unsupported command: ${command}` };
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error executing command:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to execute command' };
  }
}

// ============================================================
// Initialization
// ============================================================

let initialized = false;

/**
 * Initialize the Quick Panel page commands message handler.
 * Should be called once during background script setup.
 */
export function initQuickPanelPageCommandsHandler(): void {
  if (initialized) return;
  initialized = true;

  initQuickPanelPageSkinsLifecycle();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_OPEN_URL) {
      handleOpenUrl(message as QuickPanelOpenUrlMessage, sender).then(sendResponse);
      return true; // Will respond asynchronously
    }

    if (message?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND) {
      handlePageCommand(message as QuickPanelPageCommandMessage, sender).then(sendResponse);
      return true; // Will respond asynchronously
    }

    return false;
  });

  console.debug(`${LOG_PREFIX} Initialized`);
}
