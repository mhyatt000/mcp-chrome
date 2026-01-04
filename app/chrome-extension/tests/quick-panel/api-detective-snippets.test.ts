import { describe, expect, it } from 'vitest';

import { toCurlCommand, toFetchSnippet } from '@/shared/quick-panel/core/api-detective-snippets';

describe('API Detective snippets', () => {
  it('builds a basic curl command', () => {
    const curl = toCurlCommand({
      method: 'POST',
      url: 'https://example.com/api/v1/items',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });

    expect(curl).toContain('curl');
    expect(curl).toContain("-X 'POST'");
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain('--data-raw');
    expect(curl).toContain('{"a":1}');
    expect(curl).toContain("'https://example.com/api/v1/items'");
  });

  it('escapes single quotes for POSIX shells', () => {
    const curl = toCurlCommand({
      method: 'POST',
      url: "https://example.com/api?note=o'clock",
      headers: { Authorization: "Bearer o'clock" },
      body: "o'clock",
    });

    // curl uses the classic '"'"' escape sequence
    expect(curl).toContain("'\"'\"'");
  });

  it('builds a fetch snippet', () => {
    const snippet = toFetchSnippet({
      method: 'PUT',
      url: 'https://example.com/api/v1/items/1',
      headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
      body: '{"ok":true}',
    });

    expect(snippet).toContain('await fetch("https://example.com/api/v1/items/1"');
    expect(snippet).toContain('method: "PUT"');
    expect(snippet).toContain('"Content-Type": "application/json"');
    expect(snippet).toContain('body: "{\\"ok\\":true}"');
  });
});
