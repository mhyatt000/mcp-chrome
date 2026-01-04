import { describe, expect, it, vi } from 'vitest';

import { createKeyboardController } from '@/shared/quick-panel/core/keyboard-controller';

function createShadowDomInput(): {
  shadowRoot: ShadowRoot;
  input: HTMLInputElement;
  dispose: () => void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  const input = document.createElement('input');
  input.type = 'text';
  shadowRoot.appendChild(input);

  return { shadowRoot, input, dispose: () => host.remove() };
}

describe('Quick Panel keyboard controller', () => {
  it('does not intercept ArrowLeft inside input when query is not empty', () => {
    const { shadowRoot, input, dispose } = createShadowDomInput();

    const onBack = vi.fn();

    const keyboard = createKeyboardController({
      shadowRoot,
      getCurrentView: () => 'search',
      isActionPanelOpen: () => false,
      isInputEmpty: () => input.value.trim().length === 0,
      onBack,
    });
    keyboard.enable();

    input.value = 'abc';
    input.setSelectionRange(1, 1);

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    input.dispatchEvent(ev);

    expect(onBack).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);

    keyboard.dispose();
    dispose();
  });

  it('intercepts ArrowLeft inside input when query is empty and caret is at start', () => {
    const { shadowRoot, input, dispose } = createShadowDomInput();

    const onBack = vi.fn();

    const keyboard = createKeyboardController({
      shadowRoot,
      getCurrentView: () => 'search',
      isActionPanelOpen: () => false,
      isInputEmpty: () => input.value.trim().length === 0,
      onBack,
    });
    keyboard.enable();

    input.value = '';
    input.setSelectionRange(0, 0);

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    input.dispatchEvent(ev);

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);

    keyboard.dispose();
    dispose();
  });

  it('intercepts ArrowRight inside input when caret is at end (opens action panel)', () => {
    const { shadowRoot, input, dispose } = createShadowDomInput();

    const onOpenActionPanel = vi.fn();

    const keyboard = createKeyboardController({
      shadowRoot,
      getCurrentView: () => 'search',
      isActionPanelOpen: () => false,
      isInputEmpty: () => input.value.trim().length === 0,
      onOpenActionPanel,
    });
    keyboard.enable();

    input.value = 'abc';
    input.setSelectionRange(3, 3);

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    input.dispatchEvent(ev);

    expect(onOpenActionPanel).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);

    keyboard.dispose();
    dispose();
  });

  it('does not intercept ArrowRight inside input when caret is not at end', () => {
    const { shadowRoot, input, dispose } = createShadowDomInput();

    const onOpenActionPanel = vi.fn();

    const keyboard = createKeyboardController({
      shadowRoot,
      getCurrentView: () => 'search',
      isActionPanelOpen: () => false,
      isInputEmpty: () => input.value.trim().length === 0,
      onOpenActionPanel,
    });
    keyboard.enable();

    input.value = 'abc';
    input.setSelectionRange(1, 1);

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    input.dispatchEvent(ev);

    expect(onOpenActionPanel).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);

    keyboard.dispose();
    dispose();
  });
});
