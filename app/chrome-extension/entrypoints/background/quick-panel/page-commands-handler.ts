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

function normalizeDisposition(value: unknown): QuickPanelOpenUrlDisposition {
  if (value === 'new_tab' || value === 'background_tab' || value === 'current_tab') return value;
  return 'current_tab';
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
