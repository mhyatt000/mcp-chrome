/**
 * Layout Control (Phase 3.4 + 4.1/4.2)
 *
 * Edits inline layout styles:
 * - display (select): block/inline/inline-block/flex/grid/none
 * - flex-direction (icon button group, shown when display=flex)
 * - justify-content + align-items (alignment grid, shown when display=flex/grid)
 * - flex-wrap (select, shown when display=flex)
 * - gap (input)
 */

import { Disposer } from '../../../utils/disposables';
import type {
  MultiStyleTransactionHandle,
  StyleTransactionHandle,
  TransactionManager,
} from '../../../core/transaction-manager';
import type { DesignControl } from '../types';
import { createAlignmentGrid, type AlignmentGrid } from '../components/alignment-grid';
import { createIconButtonGroup, type IconButtonGroup } from '../components/icon-button-group';
import { createInputContainer } from '../components/input-container';
import { extractUnitSuffix, normalizeLength } from './css-helpers';
import { wireNumberStepping } from './number-stepping';

// =============================================================================
// Constants
// =============================================================================

const DISPLAY_VALUES = ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'] as const;
const FLEX_DIRECTION_VALUES = ['row', 'column', 'row-reverse', 'column-reverse'] as const;
const FLEX_WRAP_VALUES = ['nowrap', 'wrap', 'wrap-reverse'] as const;
const ALIGNMENT_AXIS_VALUES = ['flex-start', 'center', 'flex-end'] as const;

type FlexDirectionValue = (typeof FLEX_DIRECTION_VALUES)[number];
type AlignmentAxisValue = (typeof ALIGNMENT_AXIS_VALUES)[number];

/** Single-property field keys */
type LayoutProperty = 'display' | 'flex-direction' | 'flex-wrap' | 'gap';

/** All field keys including the composite alignment field */
type FieldKey = LayoutProperty | 'alignment';

// -----------------------------------------------------------------------------
// Field State Types (discriminated union for type-safe field handling)
// -----------------------------------------------------------------------------

interface SelectFieldState {
  kind: 'select';
  property: Extract<LayoutProperty, 'display' | 'flex-wrap'>;
  element: HTMLSelectElement;
  handle: StyleTransactionHandle | null;
  row: HTMLElement;
}

interface InputFieldState {
  kind: 'input';
  property: 'gap';
  element: HTMLInputElement;
  handle: StyleTransactionHandle | null;
  row: HTMLElement;
}

interface IconButtonGroupFieldState {
  kind: 'icon-button-group';
  property: 'flex-direction';
  group: IconButtonGroup<FlexDirectionValue>;
  handle: StyleTransactionHandle | null;
  row: HTMLElement;
}

interface AlignmentGridFieldState {
  kind: 'alignment-grid';
  properties: readonly ['justify-content', 'align-items'];
  grid: AlignmentGrid;
  handle: MultiStyleTransactionHandle | null;
  row: HTMLElement;
}

type FieldState =
  | SelectFieldState
  | InputFieldState
  | IconButtonGroupFieldState
  | AlignmentGridFieldState;

// =============================================================================
// Helpers
// =============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

function isFieldFocused(el: HTMLElement): boolean {
  try {
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
    return document.activeElement === el;
  } catch {
    return false;
  }
}

function readInlineValue(element: Element, property: string): string {
  try {
    const style = (element as HTMLElement).style;
    return style?.getPropertyValue?.(property)?.trim() ?? '';
  } catch {
    return '';
  }
}

function readComputedValue(element: Element, property: string): string {
  try {
    return window.getComputedStyle(element).getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

function isFlexDirectionValue(value: string): value is FlexDirectionValue {
  return (FLEX_DIRECTION_VALUES as readonly string[]).includes(value);
}

function isAlignmentAxisValue(value: string): value is AlignmentAxisValue {
  return (ALIGNMENT_AXIS_VALUES as readonly string[]).includes(value);
}

/**
 * Map computed display values to the closest option value.
 * e.g., inline-flex -> flex, inline-grid -> grid
 */
function normalizeDisplayValue(computed: string): string {
  const trimmed = computed.trim();
  if (trimmed === 'inline-flex') return 'flex';
  if (trimmed === 'inline-grid') return 'grid';
  return trimmed;
}

// -----------------------------------------------------------------------------
// SVG Icons for flex-direction
// Design ref: attr-ui.html:183-208
// -----------------------------------------------------------------------------

function createFlowIcon(direction: FlexDirectionValue): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 15 15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');

  // Arrow paths for each direction
  const DIRECTION_PATHS: Record<FlexDirectionValue, string> = {
    row: 'M2 7.5H13M10 4.5L13 7.5L10 10.5',
    'row-reverse': 'M13 7.5H2M5 4.5L2 7.5L5 10.5',
    column: 'M7.5 2V13M4.5 10L7.5 13L10.5 10',
    'column-reverse': 'M7.5 13V2M4.5 5L7.5 2L10.5 5',
  };

  path.setAttribute('d', DIRECTION_PATHS[direction]);
  svg.append(path);
  return svg;
}

// -----------------------------------------------------------------------------
// SVG Icon for gap (prefix)
// Design ref: attr-ui.html:278-285
// -----------------------------------------------------------------------------

function createGapIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 15 15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('d', 'M1.5 4.5H13.5M1.5 10.5H13.5');
  svg.append(path);
  return svg;
}

// =============================================================================
// Factory
// =============================================================================

export interface LayoutControlOptions {
  container: HTMLElement;
  transactionManager: TransactionManager;
}

export function createLayoutControl(options: LayoutControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  let currentTarget: Element | null = null;

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // ---------------------------------------------------------------------------
  // Helper: Create a standard select row
  // ---------------------------------------------------------------------------
  function createSelectRow(
    labelText: string,
    ariaLabel: string,
    values: readonly string[],
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'we-field';
    const label = document.createElement('span');
    label.className = 'we-field-label';
    label.textContent = labelText;
    const select = document.createElement('select');
    select.className = 'we-select';
    select.setAttribute('aria-label', ariaLabel);
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.append(opt);
    }
    row.append(label, select);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Display row (select)
  // ---------------------------------------------------------------------------
  const displayRow = createSelectRow('Display', 'display', DISPLAY_VALUES);
  const displaySelect = displayRow.querySelector('select') as HTMLSelectElement;

  // ---------------------------------------------------------------------------
  // Flex direction row (icon button group)
  // Design ref: attr-ui.html:179-209
  // ---------------------------------------------------------------------------
  const directionRow = document.createElement('div');
  directionRow.className = 'we-field';

  const directionLabel = document.createElement('span');
  directionLabel.className = 'we-field-label';
  directionLabel.textContent = 'Flow';

  const directionMount = document.createElement('div');
  directionMount.className = 'we-field-content';

  directionRow.append(directionLabel, directionMount);

  const directionGroup = createIconButtonGroup<FlexDirectionValue>({
    container: directionMount,
    ariaLabel: 'Flex direction',
    columns: 4,
    items: FLEX_DIRECTION_VALUES.map((dir) => ({
      value: dir,
      ariaLabel: dir.replace('-', ' '),
      title: dir.replace('-', ' '),
      icon: createFlowIcon(dir),
    })),
    onChange: (value) => {
      // Icon button group uses "click-to-apply" interaction pattern
      const handle = beginTransaction('flex-direction');
      if (handle) handle.set(value);
      commitTransaction('flex-direction');
      syncAllFields();
    },
  });
  disposer.add(() => directionGroup.dispose());
  // Clear initial selection until first sync
  directionGroup.setValue(null);

  // ---------------------------------------------------------------------------
  // Flex wrap row (select)
  // ---------------------------------------------------------------------------
  const wrapRow = createSelectRow('Wrap', 'flex-wrap', FLEX_WRAP_VALUES);
  const wrapSelect = wrapRow.querySelector('select') as HTMLSelectElement;

  // ---------------------------------------------------------------------------
  // Alignment row (3×3 grid for justify-content + align-items)
  // Design ref: attr-ui.html:256-273
  // ---------------------------------------------------------------------------
  const alignmentRow = document.createElement('div');
  alignmentRow.className = 'we-field';

  const alignmentLabel = document.createElement('span');
  alignmentLabel.className = 'we-field-label';
  alignmentLabel.textContent = 'Align';

  const alignmentMount = document.createElement('div');
  alignmentMount.className = 'we-field-content';

  alignmentRow.append(alignmentLabel, alignmentMount);

  const alignmentGrid = createAlignmentGrid({
    container: alignmentMount,
    ariaLabel: 'Alignment',
    justifyValues: ALIGNMENT_AXIS_VALUES,
    alignValues: ALIGNMENT_AXIS_VALUES,
    onChange: ({ justifyContent, alignItems }) => {
      // Apply both properties atomically
      const handle = beginAlignmentTransaction();
      if (!handle) return;
      handle.set({ 'justify-content': justifyContent, 'align-items': alignItems });
      commitAlignmentTransaction();
      syncAllFields();
    },
  });
  disposer.add(() => alignmentGrid.dispose());

  // ---------------------------------------------------------------------------
  // Gap row (input with icon prefix and unit suffix)
  // Design ref: attr-ui.html:275-289
  // ---------------------------------------------------------------------------
  const gapRow = document.createElement('div');
  gapRow.className = 'we-field';
  const gapLabel = document.createElement('span');
  gapLabel.className = 'we-field-label';
  gapLabel.textContent = 'Gap';

  const gapContainer = createInputContainer({
    ariaLabel: 'Gap',
    inputMode: 'decimal',
    prefix: createGapIcon(),
    suffix: 'px',
  });
  gapRow.append(gapLabel, gapContainer.root);

  wireNumberStepping(disposer, gapContainer.input, { mode: 'css-length' });

  // ---------------------------------------------------------------------------
  // Assemble DOM
  // ---------------------------------------------------------------------------
  root.append(displayRow, directionRow, wrapRow, alignmentRow, gapRow);
  container.append(root);
  disposer.add(() => root.remove());

  // ---------------------------------------------------------------------------
  // Field State Registry
  // ---------------------------------------------------------------------------
  const fields: Record<FieldKey, FieldState> = {
    display: {
      kind: 'select',
      property: 'display',
      element: displaySelect,
      handle: null,
      row: displayRow,
    },
    'flex-direction': {
      kind: 'icon-button-group',
      property: 'flex-direction',
      group: directionGroup,
      handle: null,
      row: directionRow,
    },
    'flex-wrap': {
      kind: 'select',
      property: 'flex-wrap',
      element: wrapSelect,
      handle: null,
      row: wrapRow,
    },
    alignment: {
      kind: 'alignment-grid',
      properties: ['justify-content', 'align-items'] as const,
      grid: alignmentGrid,
      handle: null,
      row: alignmentRow,
    },
    gap: {
      kind: 'input',
      property: 'gap',
      element: gapContainer.input,
      handle: null,
      row: gapRow,
    },
  };

  /** Single-property fields for iteration */
  const STYLE_PROPS: readonly LayoutProperty[] = ['display', 'flex-direction', 'flex-wrap', 'gap'];
  /** All field keys for iteration */
  const FIELD_KEYS: readonly FieldKey[] = [
    'display',
    'flex-direction',
    'flex-wrap',
    'alignment',
    'gap',
  ];

  // ---------------------------------------------------------------------------
  // Transaction Management
  // ---------------------------------------------------------------------------

  function beginTransaction(property: LayoutProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];
    if (field.kind === 'alignment-grid') return null;
    if (field.handle) return field.handle;

    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  function commitTransaction(property: LayoutProperty): void {
    const field = fields[property];
    if (field.kind === 'alignment-grid') return;
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.commit({ merge: true });
  }

  function rollbackTransaction(property: LayoutProperty): void {
    const field = fields[property];
    if (field.kind === 'alignment-grid') return;
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.rollback();
  }

  function beginAlignmentTransaction(): MultiStyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields.alignment;
    if (field.kind !== 'alignment-grid') return null;
    if (field.handle) return field.handle;

    const handle = transactionManager.beginMultiStyle(target, ['justify-content', 'align-items']);
    field.handle = handle;
    return handle;
  }

  function commitAlignmentTransaction(): void {
    const field = fields.alignment;
    if (field.kind !== 'alignment-grid') return;
    const handle = field.handle;
    field.handle = null;
    handle?.commit({ merge: true });
  }

  function commitAllTransactions(): void {
    for (const p of STYLE_PROPS) commitTransaction(p);
    commitAlignmentTransaction();
  }

  // ---------------------------------------------------------------------------
  // Visibility Control
  // ---------------------------------------------------------------------------

  function updateVisibility(): void {
    const target = currentTarget;
    const displayValue = target
      ? readInlineValue(target, 'display') || readComputedValue(target, 'display')
      : displaySelect.value;

    const trimmed = displayValue.trim();
    const isFlex = trimmed === 'flex' || trimmed === 'inline-flex';
    const isGrid = trimmed === 'grid' || trimmed === 'inline-grid';
    const isFlexOrGrid = isFlex || isGrid;

    directionRow.hidden = !isFlex;
    wrapRow.hidden = !isFlex;
    alignmentRow.hidden = !isFlexOrGrid;
    gapRow.hidden = !isFlexOrGrid;
  }

  // ---------------------------------------------------------------------------
  // Field Synchronization
  // ---------------------------------------------------------------------------

  function syncField(key: FieldKey, force = false): void {
    const field = fields[key];
    const target = currentTarget;

    // Handle icon button group (flex-direction)
    if (field.kind === 'icon-button-group') {
      const group = field.group;

      if (!target || !target.isConnected) {
        group.setDisabled(true);
        group.setValue(null);
        return;
      }

      group.setDisabled(false);
      const isEditing = field.handle !== null;
      if (isEditing && !force) return;

      const inline = readInlineValue(target, field.property);
      const computed = readComputedValue(target, field.property);
      const raw = (inline || computed).trim();
      group.setValue(isFlexDirectionValue(raw) ? raw : null);
      return;
    }

    // Handle alignment grid (justify-content + align-items)
    if (field.kind === 'alignment-grid') {
      const grid = field.grid;

      if (!target || !target.isConnected) {
        grid.setDisabled(true);
        grid.setValue(null);
        return;
      }

      grid.setDisabled(false);
      const isEditing = field.handle !== null;
      if (isEditing && !force) return;

      const justifyInline = readInlineValue(target, 'justify-content');
      const justifyComputed = readComputedValue(target, 'justify-content');
      const alignInline = readInlineValue(target, 'align-items');
      const alignComputed = readComputedValue(target, 'align-items');

      const justifyRaw = (justifyInline || justifyComputed).trim();
      const alignRaw = (alignInline || alignComputed).trim();

      // Graceful handling: if values aren't representable in 3×3 grid, show no selection
      if (isAlignmentAxisValue(justifyRaw) && isAlignmentAxisValue(alignRaw)) {
        grid.setValue({ justifyContent: justifyRaw, alignItems: alignRaw });
      } else {
        grid.setValue(null);
      }
      return;
    }

    // Handle input field (gap)
    if (field.kind === 'input') {
      const input = field.element;

      if (!target || !target.isConnected) {
        input.disabled = true;
        input.value = '';
        input.placeholder = '';
        // Reset suffix to default for gap
        if (field.property === 'gap') {
          gapContainer.setSuffix('px');
        }
        return;
      }

      input.disabled = false;
      const isEditing = field.handle !== null || isFieldFocused(input);
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, field.property);
      const displayValue = inlineValue || readComputedValue(target, field.property);
      input.value = displayValue;
      input.placeholder = '';

      // Update suffix to match current unit for gap field
      if (field.property === 'gap') {
        gapContainer.setSuffix(extractUnitSuffix(displayValue));
      }
      return;
    }

    // Handle select field (display, flex-wrap)
    if (field.kind === 'select') {
      const select = field.element;

      if (!target || !target.isConnected) {
        select.disabled = true;
        return;
      }

      select.disabled = false;
      const isEditing = field.handle !== null || isFieldFocused(select);
      if (isEditing && !force) return;

      const inline = readInlineValue(target, field.property);
      const computed = readComputedValue(target, field.property);
      let val = inline || computed;

      // For display property, map inline-flex/inline-grid to flex/grid
      if (field.property === 'display') {
        val = normalizeDisplayValue(val);
      }

      const hasOption = Array.from(select.options).some((o) => o.value === val);
      select.value = hasOption ? val : (select.options[0]?.value ?? '');
    }
  }

  function syncAllFields(): void {
    for (const key of FIELD_KEYS) syncField(key);
    updateVisibility();
  }

  // ---------------------------------------------------------------------------
  // Event Wiring
  // ---------------------------------------------------------------------------

  function wireSelect(property: Extract<LayoutProperty, 'display' | 'flex-wrap'>): void {
    const field = fields[property];
    if (field.kind !== 'select') return;
    const select = field.element;

    const preview = () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(select.value);
      if (property === 'display') updateVisibility();
    };

    disposer.listen(select, 'input', preview);
    disposer.listen(select, 'change', preview);
    disposer.listen(select, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    disposer.listen(select, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTransaction(property);
        syncAllFields();
        select.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        rollbackTransaction(property);
        syncField(property, true);
      }
    });
  }

  function wireInput(property: 'gap'): void {
    const field = fields[property];
    if (field.kind !== 'input') return;
    const input = field.element;

    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(normalizeLength(input.value));
    });

    disposer.listen(input, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    disposer.listen(input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTransaction(property);
        syncAllFields();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        rollbackTransaction(property);
        syncField(property, true);
      }
    });
  }

  wireSelect('display');
  wireSelect('flex-wrap');
  wireInput('gap');

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;
    if (element !== currentTarget) commitAllTransactions();
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
