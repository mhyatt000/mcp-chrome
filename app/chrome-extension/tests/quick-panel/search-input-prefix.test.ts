import { afterEach, describe, expect, it } from 'vitest';

import { createSearchInput } from '@/shared/quick-panel/ui/search-input';

describe('Quick Panel search input prefix scopes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('allows prefix-only scopes that are not in the cycle list', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'], // web scopes are intentionally excluded
    });

    input.input.value = 'g React Hooks';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('web_google');
    expect(input.getState().query).toBe('React Hooks');
    expect(input.input.value).toBe('React Hooks');

    input.dispose();
  });

  it('prefers longer prefixes over shorter ones', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'],
    });

    input.input.value = 'gh openai';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('web_github');
    expect(input.getState().query).toBe('openai');

    input.dispose();
  });

  it('supports ws prefix for workspaces scope', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'],
    });

    input.input.value = 'ws Project X';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('workspaces');
    expect(input.getState().query).toBe('Project X');

    input.dispose();
  });

  it('supports clip prefix for clipboard scope', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'],
    });

    input.input.value = 'clip hello world';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('clipboard');
    expect(input.getState().query).toBe('hello world');

    input.dispose();
  });

  it('supports note prefix for notes scope', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'],
    });

    input.input.value = 'note buy milk';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('notes');
    expect(input.getState().query).toBe('buy milk');

    input.dispose();
  });

  it('supports focus prefix for focus scope', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'],
    });

    input.input.value = 'focus start 25';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('focus');
    expect(input.getState().query).toBe('start 25');

    input.dispose();
  });

  it('supports mon prefix for monitor scope', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'],
    });

    input.input.value = 'mon https://example.com .price';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('monitor');
    expect(input.getState().query).toBe('https://example.com .price');

    input.dispose();
  });

  it('supports audit prefix for audit scope', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const input = createSearchInput({
      container,
      initialScope: 'all',
      availableScopes: ['all', 'tabs', 'commands'],
    });

    input.input.value = 'audit chrome_navigate';
    input.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getState().scope).toBe('audit');
    expect(input.getState().query).toBe('chrome_navigate');

    input.dispose();
  });
});
