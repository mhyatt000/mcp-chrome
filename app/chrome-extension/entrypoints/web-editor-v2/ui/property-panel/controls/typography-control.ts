/**
 * Typography Control (Phase 3.7)
 *
 * Edits inline typography styles:
 * - font-size (input)
 * - font-weight (select)
 * - line-height (input)
 * - text-align (select)
 * - color (input with optional token picker)
 *
 * Phase 5.4: Added optional DesignTokensService integration for color field.
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import type { DesignTokensService, CssVarName } from '../../../core/design-tokens';
import { createTokenPicker, type TokenPicker } from './token-picker';
import { createColorField, type ColorField } from './color-field';
import { createInputContainer, type InputContainer } from '../components/input-container';
import { extractUnitSuffix, hasExplicitUnit, normalizeLength } from './css-helpers';
import { wireNumberStepping } from './number-stepping';
import type { DesignControl } from '../types';

// =============================================================================
// Constants
// =============================================================================

const FONT_WEIGHT_VALUES = ['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
const TEXT_ALIGN_VALUES = ['left', 'center', 'right', 'justify'] as const;

type TypographyProperty = 'font-size' | 'font-weight' | 'line-height' | 'text-align' | 'color';

/** Standard input/select field state */
interface StandardFieldState {
  kind: 'standard';
  property: TypographyProperty;
  element: HTMLSelectElement | HTMLInputElement;
  handle: StyleTransactionHandle | null;
  /** InputContainer reference for input fields (null/undefined for selects) */
  container?: InputContainer;
}

/** Color field state */
interface ColorFieldState {
  kind: 'color';
  property: TypographyProperty;
  field: ColorField;
  handle: StyleTransactionHandle | null;
}

type FieldState = StandardFieldState | ColorFieldState;

// =============================================================================
// Helpers
// =============================================================================

function isFieldFocused(el: HTMLElement): boolean {
  try {
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
    return document.activeElement === el;
  } catch {
    return false;
  }
}

/**
 * Normalize line-height value.
 * Keeps unitless numbers as-is (e.g., "1.5" stays "1.5", not "1.5px")
 * because unitless line-height is relative to font-size.
 */
function normalizeLineHeight(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Keep unitless numbers as-is for line-height
  return trimmed;
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

// =============================================================================
// Factory
// =============================================================================

export interface TypographyControlOptions {
  container: HTMLElement;
  transactionManager: TransactionManager;
  /** Optional: DesignTokensService for token picker integration (Phase 5.4) */
  tokensService?: DesignTokensService;
}

export function createTypographyControl(options: TypographyControlOptions): DesignControl {
  const { container, transactionManager, tokensService } = options;
  const disposer = new Disposer();

  let currentTarget: Element | null = null;

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // Font Size (with input-container for suffix support)
  const fontSizeRow = document.createElement('div');
  fontSizeRow.className = 'we-field';
  const fontSizeLabel = document.createElement('span');
  fontSizeLabel.className = 'we-field-label';
  fontSizeLabel.textContent = 'Size';
  const fontSizeContainer = createInputContainer({
    ariaLabel: 'Font Size',
    inputMode: 'decimal',
    prefix: null,
    suffix: 'px',
  });
  fontSizeRow.append(fontSizeLabel, fontSizeContainer.root);

  // Font Weight
  const fontWeightRow = document.createElement('div');
  fontWeightRow.className = 'we-field';
  const fontWeightLabel = document.createElement('span');
  fontWeightLabel.className = 'we-field-label';
  fontWeightLabel.textContent = 'Weight';
  const fontWeightSelect = document.createElement('select');
  fontWeightSelect.className = 'we-select';
  fontWeightSelect.setAttribute('aria-label', 'Font Weight');
  for (const v of FONT_WEIGHT_VALUES) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    fontWeightSelect.append(opt);
  }
  fontWeightRow.append(fontWeightLabel, fontWeightSelect);

  // Line Height (with input-container, suffix only shown if value has unit)
  const lineHeightRow = document.createElement('div');
  lineHeightRow.className = 'we-field';
  const lineHeightLabel = document.createElement('span');
  lineHeightLabel.className = 'we-field-label';
  lineHeightLabel.textContent = 'Line H';
  const lineHeightContainer = createInputContainer({
    ariaLabel: 'Line Height',
    inputMode: 'decimal',
    prefix: null,
    suffix: null, // Will be set dynamically based on value
  });
  lineHeightRow.append(lineHeightLabel, lineHeightContainer.root);

  // Wire up keyboard stepping for arrow up/down
  wireNumberStepping(disposer, fontSizeContainer.input, { mode: 'css-length' });
  wireNumberStepping(disposer, lineHeightContainer.input, {
    mode: 'css-length',
    step: 0.1,
    shiftStep: 1,
    altStep: 0.01,
  });

  // Text Align
  const textAlignRow = document.createElement('div');
  textAlignRow.className = 'we-field';
  const textAlignLabel = document.createElement('span');
  textAlignLabel.className = 'we-field-label';
  textAlignLabel.textContent = 'Align';
  const textAlignSelect = document.createElement('select');
  textAlignSelect.className = 'we-select';
  textAlignSelect.setAttribute('aria-label', 'Text Align');
  for (const v of TEXT_ALIGN_VALUES) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    textAlignSelect.append(opt);
  }
  textAlignRow.append(textAlignLabel, textAlignSelect);

  // Color (with ColorField and optional token picker)
  const colorRow = document.createElement('div');
  colorRow.className = 'we-field';
  colorRow.style.position = 'relative'; // For token picker positioning

  const colorLabel = document.createElement('span');
  colorLabel.className = 'we-field-label';
  colorLabel.textContent = 'Color';

  const colorFieldWrapper = document.createElement('div');
  colorFieldWrapper.style.display = 'flex';
  colorFieldWrapper.style.gap = '4px';
  colorFieldWrapper.style.flex = '1';
  colorFieldWrapper.style.alignItems = 'center';

  const colorFieldContainer = document.createElement('div');
  colorFieldContainer.style.flex = '1';
  colorFieldContainer.style.minWidth = '0';
  colorFieldWrapper.append(colorFieldContainer);

  // Token picker button (only if tokensService is provided)
  let colorTokenPicker: TokenPicker | null = null;
  if (tokensService) {
    const tokenBtn = document.createElement('button');
    tokenBtn.type = 'button';
    tokenBtn.className = 'we-token-btn';
    tokenBtn.setAttribute('aria-label', 'Select design token');
    tokenBtn.title = 'Select design token';
    // Simple icon using text (could be replaced with SVG)
    tokenBtn.innerHTML = '<span class="we-token-btn-icon">⬡</span>';

    colorFieldWrapper.append(tokenBtn);

    // Create token picker
    colorTokenPicker = createTokenPicker({
      container: colorRow,
      tokensService,
      onSelect: (tokenName: CssVarName, cssValue: string) => {
        // Apply the token value
        const handle = beginTransaction('color');
        if (handle) {
          handle.set(cssValue);
          commitTransaction('color');
          syncAllFields();
        }
      },
    });
    disposer.add(() => colorTokenPicker?.dispose());

    // Toggle picker on button click
    disposer.listen(tokenBtn, 'click', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      colorTokenPicker?.toggle();
    });

    // Close picker when clicking outside
    disposer.listen(document, 'click', (e: MouseEvent) => {
      if (!colorTokenPicker?.isVisible()) return;
      const target = e.target as Node;
      if (!colorRow.contains(target)) {
        colorTokenPicker.hide();
      }
    });
  }

  colorRow.append(colorLabel, colorFieldWrapper);

  root.append(fontSizeRow, fontWeightRow, lineHeightRow, textAlignRow, colorRow);
  container.append(root);
  disposer.add(() => root.remove());

  // -------------------------------------------------------------------------
  // Create ColorField instance for text color
  // -------------------------------------------------------------------------
  const textColorField = createColorField({
    container: colorFieldContainer,
    ariaLabel: 'Text Color',
    onInput: (value) => {
      const handle = beginTransaction('color');
      if (handle) handle.set(value);
    },
    onCommit: () => {
      commitTransaction('color');
      syncAllFields();
    },
    onCancel: () => {
      rollbackTransaction('color');
      syncField('color', true);
    },
  });
  disposer.add(() => textColorField.dispose());

  // -------------------------------------------------------------------------
  // Field state map
  // -------------------------------------------------------------------------
  const fields: Record<TypographyProperty, FieldState> = {
    'font-size': {
      kind: 'standard',
      property: 'font-size',
      element: fontSizeContainer.input,
      container: fontSizeContainer,
      handle: null,
    },
    'font-weight': {
      kind: 'standard',
      property: 'font-weight',
      element: fontWeightSelect,
      handle: null,
    },
    'line-height': {
      kind: 'standard',
      property: 'line-height',
      element: lineHeightContainer.input,
      container: lineHeightContainer,
      handle: null,
    },
    'text-align': {
      kind: 'standard',
      property: 'text-align',
      element: textAlignSelect,
      handle: null,
    },
    color: { kind: 'color', property: 'color', field: textColorField, handle: null },
  };

  const PROPS: readonly TypographyProperty[] = [
    'font-size',
    'font-weight',
    'line-height',
    'text-align',
    'color',
  ];

  function beginTransaction(property: TypographyProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;
    const field = fields[property];
    if (field.handle) return field.handle;
    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  function commitTransaction(property: TypographyProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.commit({ merge: true });
  }

  function rollbackTransaction(property: TypographyProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.rollback();
  }

  function commitAllTransactions(): void {
    for (const p of PROPS) commitTransaction(p);
  }

  function syncField(property: TypographyProperty, force = false): void {
    const field = fields[property];
    const target = currentTarget;

    if (field.kind === 'color') {
      // Handle ColorField
      const colorField = field.field;

      if (!target || !target.isConnected) {
        colorField.setDisabled(true);
        colorField.setValue('');
        colorField.setPlaceholder('');
        return;
      }

      colorField.setDisabled(false);

      const isEditing = field.handle !== null || colorField.isFocused();
      if (isEditing && !force) return;

      // Display real value: prefer inline style, fallback to computed style
      const inlineValue = readInlineValue(target, property);
      const computedValue = readComputedValue(target, property);
      if (inlineValue) {
        colorField.setValue(inlineValue);
        // Pass computed value as placeholder when using CSS variables
        // so color-field can resolve the actual color for swatch display
        colorField.setPlaceholder(/\bvar\s*\(/i.test(inlineValue) ? computedValue : '');
      } else {
        colorField.setValue(computedValue);
        colorField.setPlaceholder('');
      }
    } else {
      // Handle standard input/select
      const el = field.element;

      if (!target || !target.isConnected) {
        el.disabled = true;
        if (el instanceof HTMLInputElement) {
          el.value = '';
          el.placeholder = '';
          // Reset suffix to defaults
          if (field.container) {
            if (property === 'font-size') {
              field.container.setSuffix('px');
            } else if (property === 'line-height') {
              field.container.setSuffix(null);
            }
          }
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

        // Update suffix dynamically
        if (field.container) {
          if (property === 'font-size') {
            field.container.setSuffix(extractUnitSuffix(displayValue));
          } else if (property === 'line-height') {
            // Line-height: only show suffix if value has explicit unit
            field.container.setSuffix(
              hasExplicitUnit(displayValue) ? extractUnitSuffix(displayValue) : null,
            );
          }
        }
      } else {
        const inline = readInlineValue(target, property);
        const computed = readComputedValue(target, property);
        if (isEditing && !force) return;
        const val = inline || computed;
        const hasOption = Array.from(el.options).some((o) => o.value === val);
        el.value = hasOption ? val : (el.options[0]?.value ?? '');
      }
    }
  }

  function syncAllFields(): void {
    for (const p of PROPS) syncField(p);
  }

  function wireSelect(property: TypographyProperty): void {
    const field = fields[property];
    if (field.kind !== 'standard') return;

    const select = field.element as HTMLSelectElement;

    const preview = () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(select.value);
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

  function wireInput(
    property: TypographyProperty,
    normalize: (v: string) => string = (v) => v.trim(),
  ): void {
    const field = fields[property];
    if (field.kind !== 'standard') return;

    const input = field.element as HTMLInputElement;

    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(normalize(input.value));
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

  // Wire standard inputs/selects (color field is wired via its own callbacks)
  wireInput('font-size', normalizeLength);
  wireSelect('font-weight');
  wireInput('line-height', normalizeLineHeight);
  wireSelect('text-align');

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;
    if (element !== currentTarget) commitAllTransactions();
    currentTarget = element;
    syncAllFields();
    // Update token picker target (Phase 5.4)
    colorTokenPicker?.setTarget(element);
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
