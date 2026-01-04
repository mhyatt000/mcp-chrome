/**
 * Quick Panel Keyboard Controller
 *
 * Manages keyboard navigation within the Quick Panel.
 * Provides a centralized keyboard handling system that:
 * - Works at ShadowRoot capture level for reliable interception
 * - Guards input controls (doesn't intercept letter keys when typing)
 * - Supports view-specific keyboard mappings
 * - Provides navigation, selection, and action triggers
 */

import type { QuickPanelView } from './types';

// ============================================================
// Types
// ============================================================

export interface KeyboardControllerOptions {
  /**
   * The ShadowRoot to attach keyboard listeners to.
   * Events are captured at this level for reliable interception.
   */
  shadowRoot: ShadowRoot;

  /**
   * Callback when navigation up is requested (↑)
   */
  onNavigateUp?: () => void;

  /**
   * Callback when navigation down is requested (↓)
   */
  onNavigateDown?: () => void;

  /**
   * Callback when selection is confirmed (Enter)
   */
  onSelect?: () => void;

  /**
   * Callback when selection in new tab is requested (Cmd/Ctrl+Enter)
   */
  onSelectInNewTab?: () => void;

  /**
   * Callback when action panel is requested (Tab or →)
   */
  onOpenActionPanel?: () => void;

  /**
   * Callback when action panel should close (Esc in action panel, or ←)
   */
  onCloseActionPanel?: () => void;

  /**
   * Callback for navigating up in action panel
   */
  onActionPanelNavigateUp?: () => void;

  /**
   * Callback for navigating down in action panel
   */
  onActionPanelNavigateDown?: () => void;

  /**
   * Callback for executing selected action in action panel
   */
  onActionPanelSelect?: () => void;

  /**
   * Callback when going back is requested (Backspace when input is empty, or ←)
   */
  onBack?: () => void;

  /**
   * Callback when close is requested (Escape)
   */
  onClose?: () => void;

  /**
   * Callback when view switch is requested (specific to Quick Panel views)
   */
  onViewSwitch?: (view: QuickPanelView) => void;

  /**
   * Function to check if the search input is empty.
   * Used to determine whether Backspace should trigger back action.
   */
  isInputEmpty?: () => boolean;

  /**
   * Function to get the current view.
   */
  getCurrentView?: () => QuickPanelView;

  /**
   * Function to check if the action panel is currently open.
   */
  isActionPanelOpen?: () => boolean;
}

export interface KeyboardControllerManager {
  /**
   * Enable keyboard handling
   */
  enable: () => void;

  /**
   * Disable keyboard handling
   */
  disable: () => void;

  /**
   * Check if keyboard handling is enabled
   */
  isEnabled: () => boolean;

  /**
   * Dispose the controller and remove all listeners
   */
  dispose: () => void;
}

// ============================================================
// Constants
// ============================================================

/** Keys that should be intercepted even when in an input field */
const INTERCEPT_IN_INPUT = new Set([
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Tab',
]);

/** Keys that trigger navigation */
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// ============================================================
// Main Factory
// ============================================================

/**
 * Create a keyboard controller for Quick Panel navigation.
 *
 * @example
 * ```typescript
 * const keyboard = createKeyboardController({
 *   shadowRoot: hostElements.shadowRoot,
 *   onNavigateUp: () => searchView.selectPrev(),
 *   onNavigateDown: () => searchView.selectNext(),
 *   onSelect: () => searchView.executeSelected(),
 *   onClose: () => hide(),
 * });
 *
 * // Enable when panel is shown
 * keyboard.enable();
 *
 * // Disable when panel is hidden
 * keyboard.disable();
 *
 * // Clean up
 * keyboard.dispose();
 * ```
 */
export function createKeyboardController(
  options: KeyboardControllerOptions,
): KeyboardControllerManager {
  const { shadowRoot } = options;

  let enabled = false;
  let disposed = false;

  /**
   * Check if the event target is an input-like element
   */
  function isInputElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;

    const tagName = target.tagName.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;

    return false;
  }

  /**
   * Best-effort selection state for text inputs.
   * Used to decide when ArrowLeft/ArrowRight should act as panel navigation without breaking typing UX.
   */
  function getTextInputSelection(
    target: EventTarget | null,
  ): { valueLength: number; start: number; end: number } | null {
    if (!target) return null;

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (typeof start !== 'number' || typeof end !== 'number') return null;
      return { valueLength: target.value.length, start, end };
    }

    return null;
  }

  /**
   * Check if we should intercept this key event
   */
  function shouldInterceptKey(event: KeyboardEvent): boolean {
    const { key } = event;
    const isInput = isInputElement(event.target);
    const actionPanelOpen = options.isActionPanelOpen?.() ?? false;

    // ArrowLeft/ArrowRight: avoid breaking text cursor movement in inputs.
    // - When action panel is open: always intercept for panel navigation.
    // - In inputs: intercept only when cursor is at boundary (start/end), so Arrow keys can be used as panel shortcuts.
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (actionPanelOpen) {
        return true;
      }

      if (isInput) {
        const sel = getTextInputSelection(event.target);
        if (!sel) return false;

        const inputEmpty = options.isInputEmpty?.() ?? sel.valueLength === 0;
        const collapsed = sel.start === sel.end;

        if (key === 'ArrowLeft') {
          // Treat ArrowLeft as "back" only when input is empty and cursor is at start.
          return inputEmpty && collapsed && sel.start === 0;
        }

        // Treat ArrowRight as "open actions" only when cursor is at end.
        return collapsed && sel.end === sel.valueLength;
      }

      // Not in an input: allow ArrowLeft/ArrowRight as panel navigation shortcuts.
      return true;
    }

    // Always intercept certain keys even in input fields
    if (INTERCEPT_IN_INPUT.has(key)) {
      return true;
    }

    // Don't intercept letter/number keys when typing in an input
    if (isInput) {
      return false;
    }

    // Allow navigation keys outside of inputs
    if (NAVIGATION_KEYS.has(key)) {
      return true;
    }

    return false;
  }

  /**
   * Handle keyboard events
   */
  function handleKeyDown(event: Event): void {
    // Type guard for KeyboardEvent
    if (!(event instanceof KeyboardEvent)) return;
    if (!enabled || disposed) return;

    // Don't intercept during IME composition (e.g., CJK input)
    if (event.isComposing) return;

    // Check if we should handle this key
    if (!shouldInterceptKey(event)) return;

    const { key, metaKey, ctrlKey, shiftKey } = event;
    const modKey = metaKey || ctrlKey; // Support both Mac and Windows

    // Determine current view for context-specific handling
    const currentView = options.getCurrentView?.() ?? 'search';
    const actionPanelOpen = options.isActionPanelOpen?.() ?? false;

    // ESC - Close action panel first, then close Quick Panel
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (actionPanelOpen) {
        options.onCloseActionPanel?.();
      } else {
        options.onClose?.();
      }
      return;
    }

    // If action panel is open, delegate to action panel handling
    if (actionPanelOpen) {
      handleActionPanelKey(event, key, modKey, shiftKey);
      return;
    }

    // Search view keyboard handling
    if (currentView === 'search') {
      handleSearchViewKey(event, key, modKey, shiftKey);
      return;
    }

    // Chat view keyboard handling
    if (currentView === 'chat') {
      handleChatViewKey(event, key, modKey, shiftKey);
      return;
    }
  }

  /**
   * Handle keyboard events in search view
   */
  function handleSearchViewKey(
    event: KeyboardEvent,
    key: string,
    modKey: boolean,
    _shiftKey: boolean,
  ): void {
    // Arrow Up - Navigate up
    if (key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      options.onNavigateUp?.();
      return;
    }

    // Arrow Down - Navigate down
    if (key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      options.onNavigateDown?.();
      return;
    }

    // Enter - Select / Execute
    if (key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (modKey) {
        // Cmd/Ctrl+Enter - Open in new tab
        options.onSelectInNewTab?.();
      } else {
        // Plain Enter - Execute default action
        options.onSelect?.();
      }
      return;
    }

    // Tab or ArrowRight - Open action panel
    if (key === 'Tab' || key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      options.onOpenActionPanel?.();
      return;
    }

    // Arrow Left - Back (when input is empty)
    if (key === 'ArrowLeft') {
      const inputEmpty = options.isInputEmpty?.() ?? false;
      if (inputEmpty) {
        event.preventDefault();
        event.stopPropagation();
        options.onBack?.();
      }
      return;
    }

    // Backspace - Back (when input is empty)
    if (key === 'Backspace') {
      const inputEmpty = options.isInputEmpty?.() ?? false;
      if (inputEmpty) {
        event.preventDefault();
        event.stopPropagation();
        options.onBack?.();
      }
      // If input is not empty, let the default behavior happen
      return;
    }
  }

  /**
   * Handle keyboard events when action panel is open
   */
  function handleActionPanelKey(
    event: KeyboardEvent,
    key: string,
    _modKey: boolean,
    _shiftKey: boolean,
  ): void {
    // Arrow Up - Navigate up in action list
    if (key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      options.onActionPanelNavigateUp?.();
      return;
    }

    // Arrow Down - Navigate down in action list
    if (key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      options.onActionPanelNavigateDown?.();
      return;
    }

    // Arrow Left - Close action panel (go back to results)
    if (key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      options.onCloseActionPanel?.();
      return;
    }

    // Enter - Execute selected action
    if (key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      options.onActionPanelSelect?.();
      return;
    }

    // Tab - Close action panel (alternative back)
    if (key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      options.onCloseActionPanel?.();
      return;
    }
  }

  /**
   * Handle keyboard events in chat view
   */
  function handleChatViewKey(
    event: KeyboardEvent,
    key: string,
    _modKey: boolean,
    _shiftKey: boolean,
  ): void {
    // In chat view, only handle ESC (already handled above)
    // and potentially Tab to go back to search

    // Tab - Go back to search view
    if (key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      options.onViewSwitch?.('search');
      return;
    }

    // Arrow keys in chat view - let them work normally for text editing
    // Don't prevent default
  }

  /**
   * Enable keyboard handling
   */
  function enable(): void {
    if (disposed || enabled) return;
    enabled = true;
    shadowRoot.addEventListener('keydown', handleKeyDown, { capture: true });
  }

  /**
   * Disable keyboard handling
   */
  function disable(): void {
    if (disposed || !enabled) return;
    enabled = false;
    shadowRoot.removeEventListener('keydown', handleKeyDown, { capture: true });
  }

  /**
   * Check if enabled
   */
  function isEnabled(): boolean {
    return enabled;
  }

  /**
   * Dispose the controller
   */
  function dispose(): void {
    if (disposed) return;
    disposed = true;

    // Remove listener if still attached
    if (enabled) {
      shadowRoot.removeEventListener('keydown', handleKeyDown, { capture: true });
    }
    enabled = false;
  }

  return {
    enable,
    disable,
    isEnabled,
    dispose,
  };
}
