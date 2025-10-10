import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { screenshotContextManager } from '@/utils/screenshot-context';
import { TargetLocator, SelectorCandidate } from './types';

// design note: minimal selector engine that tries ref then candidates

export interface LocatedElement {
  ref?: string;
  center?: { x: number; y: number };
  resolvedBy?: 'ref' | SelectorCandidate['type'];
}

/**
 * Try to resolve an element using ref or candidates via content scripts
 */
export async function locateElement(
  tabId: number,
  target: TargetLocator,
): Promise<LocatedElement | null> {
  // Try ref first
  if (target.ref) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, {
        action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
        ref: target.ref,
      });
      if (res && res.success && res.center) {
        return { ref: target.ref, center: res.center, resolvedBy: 'ref' };
      }
    } catch (e) {
      // ignore and fallback
    }
  }
  // Try candidates in order
  for (const c of target.candidates || []) {
    try {
      if (c.type === 'css' || c.type === 'attr') {
        const ensured = await chrome.tabs.sendMessage(tabId, {
          action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
          selector: c.value,
        });
        if (ensured && ensured.success && ensured.ref && ensured.center) {
          return { ref: ensured.ref, center: ensured.center, resolvedBy: c.type };
        }
      } else if (c.type === 'text') {
        // Search by visible innerText contains value
        const ensured = await chrome.tabs.sendMessage(tabId, {
          action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
          useText: true,
          text: c.value,
        } as any);
        if (ensured && ensured.success && ensured.ref && ensured.center) {
          return { ref: ensured.ref, center: ensured.center, resolvedBy: c.type };
        }
      } else if (c.type === 'aria') {
        // Best-effort: try as CSS first, otherwise ignore in M2
        const ensured = await chrome.tabs.sendMessage(tabId, {
          action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
          selector: c.value,
        });
        if (ensured && ensured.success && ensured.ref && ensured.center) {
          return { ref: ensured.ref, center: ensured.center, resolvedBy: c.type };
        }
      } else if (c.type === 'xpath') {
        // Minimal xpath support via document.evaluate through injected helper
        const ensured = await chrome.tabs.sendMessage(tabId, {
          action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
          selector: c.value,
          isXPath: true,
        } as any);
        if (ensured && ensured.success && ensured.ref && ensured.center) {
          return { ref: ensured.ref, center: ensured.center, resolvedBy: c.type };
        }
      }
    } catch (e) {
      // continue to next candidate
    }
  }
  return null;
}

/**
 * Ensure screenshot context hostname is still valid for coordinate-based actions
 */
export function validateScreenshotHostname(tabUrl?: string): string | null {
  try {
    const tabsHostname = tabUrl ? new URL(tabUrl).hostname : '';
    const activeTabId = screenshotContextManager.getActiveTabId();
    if (!activeTabId) return null;
    const ctx = screenshotContextManager.getContext(activeTabId);
    const contextHostname = (ctx as any)?.hostname as string | undefined;
    if (contextHostname && ctx && tabsHostname && contextHostname !== tabsHostname) {
      return `Security check failed: Domain changed since last screenshot (from ${contextHostname} to ${tabsHostname}).`;
    }
  } catch (e) {
    return null;
  }
  return null;
}
