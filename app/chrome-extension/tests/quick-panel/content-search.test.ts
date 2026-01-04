import { describe, expect, it } from 'vitest';

import {
  createContentSnippet,
  scoreTokensAgainstNormalizedText,
} from '@/shared/quick-panel/core/content-search';

describe('Quick Panel content search utilities', () => {
  it('scores tokens with AND semantics', () => {
    expect(scoreTokensAgainstNormalizedText('hello world', [])).toBe(0);

    const single = scoreTokensAgainstNormalizedText('hello world', ['hello']);
    expect(single).toBeGreaterThan(80);

    const both = scoreTokensAgainstNormalizedText('hello world', ['hello', 'world']);
    expect(both).toBeGreaterThan(50);

    const missing = scoreTokensAgainstNormalizedText('hello world', ['hello', 'missing']);
    expect(missing).toBe(0);
  });

  it('creates a snippet around the first matched token', () => {
    const content = `${'x '.repeat(80)}token ${'y '.repeat(80)}`.trim();
    const snippet = createContentSnippet(content, ['token']);

    expect(snippet).toContain('token');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(220);
  });

  it('creates a snippet from the start when no token matches', () => {
    const content = `${'alpha '.repeat(100)}omega`.trim();
    const snippet = createContentSnippet(content, ['missing']);

    expect(snippet.startsWith('…')).toBe(false);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(220);
  });
});
