/**
 * Quick Panel Provider Utilities
 *
 * Shared utilities for all Quick Panel search providers:
 * - Clipboard operations
 * - Markdown formatting
 * - Text normalization (pure)
 * - Token-based scoring (pure)
 * - Navigation helpers (background bridge)
 */

import {
  BACKGROUND_MESSAGE_TYPES,
  type QuickPanelOpenUrlDisposition,
  type QuickPanelOpenUrlResponse,
} from '@/common/message-types';

export {
  computeWeightedTokenScore,
  normalizeText,
  normalizeUrl,
  scoreToken,
  type WeightedField,
  type WeightedFieldMode,
} from '../core/text-score';

// ============================================================
// Clipboard Utilities
// ============================================================

export interface ClipboardRecordOptions {
  /** Best-effort source tag (e.g. "commands.copy.url", "toolbox.jwt.payload"). */
  source?: string;
  /** Best-effort label (e.g. page title or output title). */
  label?: string;
  /** Best-effort origin URL (tab where the copy happened). */
  originUrl?: string;
  /** Best-effort origin title (tab where the copy happened). */
  originTitle?: string;
}

async function recordQuickPanelClipboardWrite(
  text: string,
  options: ClipboardRecordOptions | undefined,
): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    const raw = String(text ?? '');
    if (!raw) return;

    // Avoid sending very large payloads over runtime messaging.
    // 对于超大文本（如长 base64），这里选择不记录以避免消息/存储开销过高。
    if (raw.length > 500_000) return;

    const originUrl = options?.originUrl ?? window.location.href;
    const originTitle = options?.originTitle ?? document.title;

    await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_RECORD,
      payload: {
        text: raw,
        source: options?.source,
        label: options?.label,
        originUrl,
        originTitle,
      },
    });
  } catch {
    // Best-effort
  }
}

/**
 * Write text to the clipboard using execCommand fallback.
 * This is the legacy approach that works in more contexts.
 */
function writeToClipboardFallback(text: string): void {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const success = document.execCommand('copy');
    if (!success) {
      throw new Error('execCommand copy failed');
    }
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Write text to the clipboard.
 * Uses the modern Clipboard API with fallback for older browsers or restricted contexts.
 */
export async function writeToClipboard(
  text: string,
  record?: ClipboardRecordOptions,
): Promise<void> {
  // Try modern API first, with fallback on any failure
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      void recordQuickPanelClipboardWrite(text, record);
      return;
    } catch {
      // Modern API failed (permission denied, no user gesture, etc.)
      // Fall through to legacy approach
    }
  }

  // Fallback for older browsers or when modern API fails
  writeToClipboardFallback(text);
  void recordQuickPanelClipboardWrite(text, record);
}

/**
 * Format a title and URL as a Markdown link.
 * Escapes special characters in both title and URL for valid Markdown.
 */
export function formatMarkdownLink(title: string, url: string): string {
  // Escape special characters in title for Markdown: [ ] \
  const escapedTitle = String(title ?? '').replace(/([[\]\\])/g, '\\$1');
  // Escape parentheses in URL to avoid breaking the link syntax
  const escapedUrl = String(url ?? '').replace(/[()]/g, (ch) => encodeURIComponent(ch));
  return `[${escapedTitle}](${escapedUrl})`;
}

// ============================================================
// Navigation Utilities (Background Bridge)
// ============================================================

/**
 * Open a URL via the background service worker.
 * Uses `QUICK_PANEL_OPEN_URL` to ensure consistent tab disposition behavior.
 */
export async function openUrl(options: {
  url: string;
  disposition?: QuickPanelOpenUrlDisposition;
}): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('chrome.runtime.sendMessage is not available');
  }

  const url = String(options.url ?? '').trim();
  if (!url) {
    throw new Error('url is required');
  }

  const disposition = options.disposition ?? 'current_tab';

  const resp = (await chrome.runtime.sendMessage({
    type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_OPEN_URL,
    payload: { url, disposition },
  })) as QuickPanelOpenUrlResponse;

  if (!resp || resp.success !== true) {
    const err = (resp as { error?: unknown })?.error;
    throw new Error(typeof err === 'string' ? err : 'Failed to open url');
  }
}
