import { describe, expect, it } from 'vitest';

import { cleanUrl } from '@/shared/quick-panel/core/clean-url';

describe('Quick Panel clean-url', () => {
  it('removes utm_* and common tracking params while preserving hash', () => {
    const res = cleanUrl('https://example.com/path?a=1&utm_source=x&utm_medium=y&gclid=abc#sec');
    expect(res.cleaned).toBe('https://example.com/path?a=1#sec');
    expect(res.changed).toBe(true);
    expect(res.removedParams.map((p) => p.toLowerCase())).toEqual([
      'utm_source',
      'utm_medium',
      'gclid',
    ]);
  });

  it('does nothing for non-http(s) URLs', () => {
    const res = cleanUrl('chrome://extensions/?utm_source=x');
    expect(res.cleaned).toBe('chrome://extensions/?utm_source=x');
    expect(res.changed).toBe(false);
  });

  it('returns input as-is for invalid URLs', () => {
    const res = cleanUrl('not a url');
    expect(res.cleaned).toBe('not a url');
    expect(res.changed).toBe(false);
  });
});
