/**
 * Position Control (Phase 3.3)
 *
 * Edits inline positioning styles:
 * - position (select): static/relative/absolute/fixed/sticky
 * - top/right/bottom/left (inputs)
 * - z-index (input)
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

type PositionProperty = 'position' | 'top' | 'right' | 'bottom' | 'left' | 'z-index';
type FieldElement = HTMLInputElement | HTMLSelectElement;

interface FieldState {
  property: PositionProperty;
  element: FieldElement;
  handle: StyleTransactionHandle | null;
  /** Container reference for input fields (null for select) */
  container?: InputContainer;
}

// =============================================================================
// Constants
// =============================================================================

const POSITION_VALUES = ['static', 'relative', 'absolute', 'fixed', 'sticky'] as const;
const POSITION_PROPERTIES: readonly PositionProperty[] = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
];

// =============================================================================
// Helpers
// =============================================================================

function isFieldFocused(el: FieldElement): boolean {
  try {
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      return rootNode.activeElement === el;
    }
    return document.activeElement === el;
  } catch {
    return false;
  }
}

function normalizeZIndex(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^-?\d+\.$/.test(trimmed)) return trimmed.slice(0, -1);
  return trimmed;
}

function readInlineValue(element: Element, property: PositionProperty): string {
  try {
    const style = (element as HTMLElement).style;
    if (!style || typeof style.getPropertyValue !== 'function') return '';
    return style.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

function readComputedValue(element: Element, property: PositionProperty): string {
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

export interface PositionControlOptions {
  container: HTMLElement;
  transactionManager: TransactionManager;
}

export function createPositionControl(options: PositionControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  let currentTarget: Element | null = null;

  // ==========================================================================
  // DOM Structure
  // ==========================================================================

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // Position select
  const positionRow = document.createElement('div');
  positionRow.className = 'we-field';

  const positionLabel = document.createElement('span');
  positionLabel.className = 'we-field-label';
  positionLabel.textContent = 'Position';

  const positionSelect = document.createElement('select');
  positionSelect.className = 'we-select';
  positionSelect.setAttribute('aria-label', 'Position');

  for (const value of POSITION_VALUES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    positionSelect.append(opt);
  }

  positionRow.append(positionLabel, positionSelect);

  // ---------------------------------------------------------------------------
  // Helper: Create input container with prefix and optional unit suffix
  // ---------------------------------------------------------------------------
  function createPositionInput(
    ariaLabel: string,
    prefix: string,
    hasUnitSuffix: boolean,
  ): InputContainer {
    return createInputContainer({
      ariaLabel,
      inputMode: hasUnitSuffix ? 'decimal' : 'numeric',
      prefix,
      suffix: hasUnitSuffix ? 'px' : null,
    });
  }

  // ---------------------------------------------------------------------------
  // Top/Right row
  // ---------------------------------------------------------------------------
  const rowTR = document.createElement('div');
  rowTR.className = 'we-field-row';

  const topContainer = createPositionInput('Top', 'T', true);
  const rightContainer = createPositionInput('Right', 'R', true);

  rowTR.append(topContainer.root, rightContainer.root);

  // ---------------------------------------------------------------------------
  // Bottom/Left row
  // ---------------------------------------------------------------------------
  const rowBL = document.createElement('div');
  rowBL.className = 'we-field-row';

  const bottomContainer = createPositionInput('Bottom', 'B', true);
  const leftContainer = createPositionInput('Left', 'L', true);

  rowBL.append(bottomContainer.root, leftContainer.root);

  // ---------------------------------------------------------------------------
  // Z-index row
  // ---------------------------------------------------------------------------
  const zRow = document.createElement('div');
  zRow.className = 'we-field';

  const zLabel = document.createElement('span');
  zLabel.className = 'we-field-label';
  zLabel.textContent = 'Z-Index';

  const zContainer = createPositionInput('Z-Index', 'Z', false);
  zRow.append(zLabel, zContainer.root);

  // Wire up keyboard stepping for arrow up/down
  wireNumberStepping(disposer, topContainer.input, { mode: 'css-length' });
  wireNumberStepping(disposer, rightContainer.input, { mode: 'css-length' });
  wireNumberStepping(disposer, bottomContainer.input, { mode: 'css-length' });
  wireNumberStepping(disposer, leftContainer.input, { mode: 'css-length' });
  wireNumberStepping(disposer, zContainer.input, { mode: 'number', integer: true });

  root.append(positionRow, rowTR, rowBL, zRow);
  container.append(root);
  disposer.add(() => root.remove());

  // Field state
  const fields: Record<PositionProperty, FieldState> = {
    position: { property: 'position', element: positionSelect, handle: null },
    top: { property: 'top', element: topContainer.input, container: topContainer, handle: null },
    right: {
      property: 'right',
      element: rightContainer.input,
      container: rightContainer,
      handle: null,
    },
    bottom: {
      property: 'bottom',
      element: bottomContainer.input,
      container: bottomContainer,
      handle: null,
    },
    left: {
      property: 'left',
      element: leftContainer.input,
      container: leftContainer,
      handle: null,
    },
    'z-index': {
      property: 'z-index',
      element: zContainer.input,
      container: zContainer,
      handle: null,
    },
  };

  // ==========================================================================
  // Transaction Management
  // ==========================================================================

  function beginTransaction(property: PositionProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];
    if (field.handle) return field.handle;

    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  function commitTransaction(property: PositionProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.commit({ merge: true });
  }

  function rollbackTransaction(property: PositionProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.rollback();
  }

  function commitAllTransactions(): void {
    for (const p of POSITION_PROPERTIES) commitTransaction(p);
  }

  // ==========================================================================
  // Sync
  // ==========================================================================

  /** Check if property is a length property (has unit suffix) */
  function isLengthProperty(property: PositionProperty): boolean {
    return (
      property === 'top' || property === 'right' || property === 'bottom' || property === 'left'
    );
  }

  function syncField(property: PositionProperty, force = false): void {
    const field = fields[property];
    const el = field.element;
    const target = currentTarget;

    if (!target || !target.isConnected) {
      el.disabled = true;
      if (el instanceof HTMLInputElement) {
        el.value = '';
        el.placeholder = '';
        // Reset suffix to default
        if (field.container) {
          field.container.setSuffix(isLengthProperty(property) ? 'px' : null);
        }
      } else {
        el.value = 'static';
      }
      return;
    }

    el.disabled = false;
    const isEditing = field.handle !== null || isFieldFocused(el);

    if (el instanceof HTMLInputElement) {
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, property);
      const displayValue = inlineValue || readComputedValue(target, property);
      el.value = displayValue;
      el.placeholder = '';

      // Update suffix to match current unit
      if (field.container) {
        field.container.setSuffix(
          isLengthProperty(property) ? extractUnitSuffix(displayValue) : null,
        );
      }
    } else {
      // Select
      const inline = readInlineValue(target, property);
      const computed = readComputedValue(target, property);
      el.title = inline ? '' : computed ? `Computed: ${computed}` : '';
      if (isEditing && !force) return;
      const val = inline || computed;
      el.value = (POSITION_VALUES as readonly string[]).includes(val) ? val : 'static';
    }
  }

  function syncAllFields(): void {
    for (const p of POSITION_PROPERTIES) syncField(p);
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  function wireInput(property: PositionProperty, normalize: (v: string) => string): void {
    const field = fields[property];
    const input = field.element as HTMLInputElement;

    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(normalize(input.value));
    });

    disposer.listen(input, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    disposer.listen(input, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTransaction(property);
        syncAllFields();
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        rollbackTransaction(property);
        syncField(property, true);
      }
    });
  }

  function wireSelect(): void {
    const select = positionSelect;

    const preview = () => {
      const handle = beginTransaction('position');
      if (handle) handle.set(select.value);
    };

    disposer.listen(select, 'input', preview);
    disposer.listen(select, 'change', preview);

    disposer.listen(select, 'blur', () => {
      commitTransaction('position');
      syncAllFields();
    });

    disposer.listen(select, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTransaction('position');
        syncAllFields();
        select.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        rollbackTransaction('position');
        syncField('position', true);
      }
    });
  }

  wireSelect();
  wireInput('top', normalizeLength);
  wireInput('right', normalizeLength);
  wireInput('bottom', normalizeLength);
  wireInput('left', normalizeLength);
  wireInput('z-index', normalizeZIndex);

  // ==========================================================================
  // Public API
  // ==========================================================================

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;
    if (element !== currentTarget) {
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
    commitAllTransactions();
    currentTarget = null;
    disposer.dispose();
  }

  syncAllFields();

  return { setTarget, refresh, dispose };
}
