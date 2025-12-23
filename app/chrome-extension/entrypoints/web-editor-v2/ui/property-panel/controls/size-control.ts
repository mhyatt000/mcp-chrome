/**
 * Size Control (Phase 3.5)
 *
 * Design control for editing inline width and height styles.
 *
 * Features:
 * - Live preview via TransactionManager.beginStyle().set()
 * - Shows real values (inline if set, otherwise computed)
 * - ArrowUp/ArrowDown keyboard stepping for numeric values
 * - Blur commits, Enter commits + blurs, ESC rollbacks
 * - Pure numbers default to px
 * - Empty value clears inline style
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import type { DesignControl } from '../types';
import { createInputContainer, type InputContainer } from '../components/input-container';
import { extractUnitSuffix, normalizeLength } from './css-helpers';
import { wireNumberStepping } from './number-stepping';

// =============================================================================
// Types
// =============================================================================

type SizeProperty = 'width' | 'height';

interface FieldState {
  property: SizeProperty;
  input: HTMLInputElement;
  container: InputContainer;
  handle: StyleTransactionHandle | null;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Read inline style property value from element
 */
function readInlineValue(element: Element, property: SizeProperty): string {
  try {
    const style = (element as HTMLElement).style;
    if (!style || typeof style.getPropertyValue !== 'function') return '';
    return style.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

/**
 * Read computed style property value from element
 */
function readComputedValue(element: Element, property: SizeProperty): string {
  try {
    const computed = window.getComputedStyle(element);
    return computed.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

// =============================================================================
// Factory
// =============================================================================

export interface SizeControlOptions {
  /** Container element to mount the control */
  container: HTMLElement;
  /** TransactionManager for style editing with undo/redo */
  transactionManager: TransactionManager;
}

/**
 * Create a Size control for editing width/height
 */
export function createSizeControl(options: SizeControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  // State
  let currentTarget: Element | null = null;

  // ==========================================================================
  // DOM Structure
  // ==========================================================================

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // ---------------------------------------------------------------------------
  // Width/Height row (2-column layout)
  // Design ref: attr-ui.html:214-230
  // ---------------------------------------------------------------------------
  const rowWH = document.createElement('div');
  rowWH.className = 'we-field-row';

  const widthContainer = createInputContainer({
    ariaLabel: 'Width',
    inputMode: 'decimal',
    prefix: 'W',
    suffix: 'px',
  });

  const heightContainer = createInputContainer({
    ariaLabel: 'Height',
    inputMode: 'decimal',
    prefix: 'H',
    suffix: 'px',
  });

  rowWH.append(widthContainer.root, heightContainer.root);

  // Wire up keyboard stepping for arrow up/down
  wireNumberStepping(disposer, widthContainer.input, { mode: 'css-length' });
  wireNumberStepping(disposer, heightContainer.input, { mode: 'css-length' });

  root.append(rowWH);
  container.append(root);
  disposer.add(() => root.remove());

  // Field state
  const fields: Record<SizeProperty, FieldState> = {
    width: {
      property: 'width',
      input: widthContainer.input,
      container: widthContainer,
      handle: null,
    },
    height: {
      property: 'height',
      input: heightContainer.input,
      container: heightContainer,
      handle: null,
    },
  };

  // ==========================================================================
  // Transaction Management
  // ==========================================================================

  /**
   * Begin a style transaction for a property (lazy initialization)
   */
  function beginTransaction(property: SizeProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;

    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];

    // Return existing handle if already editing
    if (field.handle) return field.handle;

    // Start new transaction
    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  /**
   * Commit the current transaction for a property
   */
  function commitTransaction(property: SizeProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;

    if (handle) {
      handle.commit({ merge: true });
    }
  }

  /**
   * Rollback the current transaction for a property
   */
  function rollbackTransaction(property: SizeProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;

    if (handle) {
      handle.rollback();
    }
  }

  /**
   * Commit all active transactions
   */
  function commitAllTransactions(): void {
    commitTransaction('width');
    commitTransaction('height');
  }

  // ==========================================================================
  // Sync / Render
  // ==========================================================================

  /**
   * Check if an input element is currently focused.
   * Uses getRootNode() for Shadow DOM compatibility.
   */
  function isInputFocused(input: HTMLInputElement): boolean {
    try {
      // In Shadow DOM, document.activeElement is the shadow host.
      // We need to check the activeElement of the ShadowRoot instead.
      const rootNode = input.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        return rootNode.activeElement === input;
      }
      return document.activeElement === input;
    } catch {
      return false;
    }
  }

  /**
   * Sync a single field's display with element styles
   * @param property - The property to sync
   * @param force - If true, ignore focus state and always update value
   */
  function syncField(property: SizeProperty, force = false): void {
    const field = fields[property];
    const target = currentTarget;

    // Disabled state when no target
    if (!target || !target.isConnected) {
      field.input.value = '';
      field.input.placeholder = '';
      field.input.disabled = true;
      field.container.setSuffix('px');
      return;
    }

    field.input.disabled = false;

    // Don't overwrite user input during active editing (unless forced)
    if (!force) {
      const isEditing = field.handle !== null || isInputFocused(field.input);
      if (isEditing) return;
    }

    // Display real value: prefer inline style, fallback to computed style
    const inlineValue = readInlineValue(target, property);
    const displayValue = inlineValue || readComputedValue(target, property);
    field.input.value = displayValue;
    field.input.placeholder = '';
    field.container.setSuffix(extractUnitSuffix(displayValue));
  }

  /**
   * Sync all fields
   */
  function syncAllFields(): void {
    syncField('width');
    syncField('height');
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Wire up event handlers for a field
   */
  function wireField(property: SizeProperty): void {
    const field = fields[property];
    const input = field.input;

    // Input: begin transaction and preview value
    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (!handle) return;

      const normalized = normalizeLength(input.value);
      handle.set(normalized);
    });

    // Blur: commit transaction
    disposer.listen(input, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    // Keydown: Enter commits, ESC rollbacks
    disposer.listen(input, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTransaction(property);
        syncAllFields();
        input.blur();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        rollbackTransaction(property);
        // Force sync to update input with rollback value (ignore focus state)
        syncField(property, true);
      }
    });
  }

  wireField('width');
  wireField('height');

  // ==========================================================================
  // Public API (DesignControl interface)
  // ==========================================================================

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;

    // Only commit if target actually changed
    if (element !== currentTarget) {
      // Commit any in-progress edits when selection changes
      commitAllTransactions();
    }

    currentTarget = element;
    syncAllFields();
  }

  function refresh(): void {
    if (disposer.isDisposed) return;
    syncAllFields();
  }

  function dispose(): void {
    // Commit any in-progress edits before cleanup
    commitAllTransactions();
    currentTarget = null;
    disposer.dispose();
  }

  // Initial state
  syncAllFields();

  return {
    setTarget,
    refresh,
    dispose,
  };
}
