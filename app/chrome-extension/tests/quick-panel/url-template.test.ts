import { describe, expect, it } from 'vitest';

import { buildSearchUrl } from '@/shared/quick-panel/core/url-template';

describe('Quick Panel url-template', () => {
  it('fills {query} using normalized encoding', () => {
    const url = buildSearchUrl(
      { template: 'https://www.google.com/search?q={query}' },
      'React   Hooks',
    );
    expect(url).toBe('https://www.google.com/search?q=React%20Hooks');
  });

  it('fills {rawQuery} using trim-only encoding', () => {
    const url = buildSearchUrl(
      { template: 'https://www.google.com/search?q={rawQuery}' },
      '  a  b  ',
    );
    expect(url).toBe('https://www.google.com/search?q=a%20%20b');
  });

  it('supports templates with both placeholders', () => {
    const url = buildSearchUrl(
      { template: 'https://example.com/?q={query}&raw={rawQuery}' },
      '  Hello   World  ',
    );
    expect(url).toBe('https://example.com/?q=Hello%20World&raw=Hello%20%20%20World');
  });

  it('rejects templates without placeholders', () => {
    expect(() => buildSearchUrl({ template: 'https://example.com/' }, 'x')).toThrow(
      /must include/i,
    );
  });

  it('rejects empty templates', () => {
    expect(() => buildSearchUrl({ template: '' }, 'x')).toThrow(/required/i);
  });
});
