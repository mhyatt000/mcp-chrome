/**
 * Quick Panel Action Panel
 *
 * A secondary panel that displays available actions for a selected search result.
 * Triggered by Tab or ArrowRight on a selected result.
 *
 * Design:
 * - Overlays the results list (not a separate view)
 * - Keyboard navigable (↑↓ to select, Enter to execute, Esc/← to close)
 * - Shows action title, keyboard hint, and danger tone styling
 */

import { Disposer } from '@/entrypoints/web-editor-v2/utils/disposables';
import type { Action, SearchResult } from '../core/types';

// ============================================================
// Types
// ============================================================

export interface ActionPanelOptions {
  /** Container element to mount the panel into */
  container: HTMLElement;
  /** Called when an action is executed */
  onExecute?: (action: Action) => void;
  /** Called when the panel should close (Esc or ← or backdrop click) */
  onClose?: () => void;
}

export interface ActionPanelManager {
  /** Show the panel with actions for a result */
  show: (result: SearchResult, actions: Action[]) => void;
  /** Hide the panel */
  hide: () => void;
  /** Check if panel is visible */
  isVisible: () => boolean;
  /** Get the currently selected action index */
  getSelectedIndex: () => number;
  /** Select previous action */
  selectPrev: () => void;
  /** Select next action */
  selectNext: () => void;
  /** Execute the currently selected action */
  executeSelected: () => void;
  /** Dispose the panel */
  dispose: () => void;
}

// ============================================================
// Main Factory
// ============================================================

/**
 * Create an Action Panel for displaying result actions.
 *
 * @example
 * ```typescript
 * const actionPanel = createActionPanel({
 *   container: resultsWrap,
 *   onExecute: (action) => {
 *     action.execute({ result });
 *     actionPanel.hide();
 *   },
 *   onClose: () => actionPanel.hide(),
 * });
 *
 * // Show when Tab is pressed on a result
 * actionPanel.show(selectedResult, provider.getActions(selectedResult));
 * ```
 */
export function createActionPanel(options: ActionPanelOptions): ActionPanelManager {
  const { container, onExecute, onClose } = options;
  const disposer = new Disposer();

  let disposed = false;
  let visible = false;
  let currentResult: SearchResult | null = null;
  let currentActions: Action[] = [];
  let selectedIndex = 0;

  // --------------------------------------------------------
  // DOM Elements
  // --------------------------------------------------------

  // Backdrop (for click-to-close)
  const backdrop = document.createElement('div');
  backdrop.className = 'qp-action-backdrop';
  backdrop.hidden = true;
  container.appendChild(backdrop);
  disposer.add(() => backdrop.remove());

  // Panel container
  const panel = document.createElement('div');
  panel.className = 'qp-action-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Actions');
  container.appendChild(panel);
  disposer.add(() => panel.remove());

  // Header (shows result context)
  const header = document.createElement('div');
  header.className = 'qp-action-header';
  panel.appendChild(header);

  // Actions list
  const actionsList = document.createElement('div');
  actionsList.className = 'qp-action-list';
  panel.appendChild(actionsList);

  // --------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === backdrop) {
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
    }
  }

  backdrop.addEventListener('click', handleBackdropClick);
  disposer.add(() => backdrop.removeEventListener('click', handleBackdropClick));

  // --------------------------------------------------------
  // Render Functions
  // --------------------------------------------------------

  function renderHeader(): void {
    if (!currentResult) {
      header.innerHTML = '';
      return;
    }

    header.innerHTML = '';

    // Icon
    const iconEl = document.createElement('span');
    iconEl.className = 'qp-action-header-icon';
    if (typeof currentResult.icon === 'string') {
      iconEl.textContent = currentResult.icon;
    } else if (currentResult.icon instanceof Node) {
      iconEl.appendChild(currentResult.icon.cloneNode(true));
    }
    header.appendChild(iconEl);

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'qp-action-header-title';
    titleEl.textContent = currentResult.title || 'Untitled';
    header.appendChild(titleEl);
  }

  function renderActions(): void {
    actionsList.innerHTML = '';

    if (currentActions.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'qp-action-empty';
      emptyEl.textContent = 'No actions available';
      actionsList.appendChild(emptyEl);
      return;
    }

    for (let i = 0; i < currentActions.length; i++) {
      const action = currentActions[i];
      const itemEl = renderActionItem(action, i === selectedIndex);
      actionsList.appendChild(itemEl);
    }
  }

  function renderActionItem(action: Action, isSelected: boolean): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'qp-action-item';
    item.dataset.actionId = action.id;
    item.dataset.selected = String(isSelected);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isSelected));

    if (action.tone === 'danger') {
      item.dataset.tone = 'danger';
    }

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'qp-action-item-title';
    titleEl.textContent = action.title;
    item.appendChild(titleEl);

    // Keyboard hint
    if (action.hotkeyHint) {
      const hintEl = document.createElement('span');
      hintEl.className = 'qp-action-item-hint';
      hintEl.textContent = action.hotkeyHint;
      item.appendChild(hintEl);
    }

    // Click handler
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disposed) {
        onExecute?.(action);
      }
    });

    return item;
  }

  function updateSelection(newIndex: number): void {
    if (disposed || !visible) return;
    if (newIndex < 0 || newIndex >= currentActions.length) return;

    const oldIndex = selectedIndex;
    selectedIndex = newIndex;

    // Update DOM
    const items = actionsList.querySelectorAll('.qp-action-item');

    if (oldIndex >= 0 && items[oldIndex]) {
      const oldItem = items[oldIndex] as HTMLElement;
      oldItem.dataset.selected = 'false';
      oldItem.setAttribute('aria-selected', 'false');
    }

    if (newIndex >= 0 && items[newIndex]) {
      const newItem = items[newIndex] as HTMLElement;
      newItem.dataset.selected = 'true';
      newItem.setAttribute('aria-selected', 'true');
      newItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // --------------------------------------------------------
  // Public API
  // --------------------------------------------------------

  function show(result: SearchResult, actions: Action[]): void {
    if (disposed) return;

    currentResult = result;
    currentActions = actions;
    selectedIndex = 0; // Always start at first action

    renderHeader();
    renderActions();

    backdrop.hidden = false;
    panel.hidden = false;
    visible = true;
  }

  function hide(): void {
    if (disposed) return;

    backdrop.hidden = true;
    panel.hidden = true;
    visible = false;
    currentResult = null;
    currentActions = [];
    selectedIndex = 0;
  }

  function isVisible(): boolean {
    return visible;
  }

  function getSelectedIndex(): number {
    return selectedIndex;
  }

  function selectPrev(): void {
    if (disposed || !visible || currentActions.length === 0) return;
    const newIndex = selectedIndex <= 0 ? currentActions.length - 1 : selectedIndex - 1;
    updateSelection(newIndex);
  }

  function selectNext(): void {
    if (disposed || !visible || currentActions.length === 0) return;
    const newIndex = selectedIndex >= currentActions.length - 1 ? 0 : selectedIndex + 1;
    updateSelection(newIndex);
  }

  function executeSelected(): void {
    if (disposed || !visible) return;
    if (selectedIndex < 0 || selectedIndex >= currentActions.length) return;

    const action = currentActions[selectedIndex];
    onExecute?.(action);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    visible = false;
    disposer.dispose();
  }

  return {
    show,
    hide,
    isVisible,
    getSelectedIndex,
    selectPrev,
    selectNext,
    executeSelected,
    dispose,
  };
}
