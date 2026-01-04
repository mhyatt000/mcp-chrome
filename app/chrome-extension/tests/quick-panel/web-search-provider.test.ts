import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebSearchProvider } from '@/shared/quick-panel/providers/web-search-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel web search provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('builds a search URL and honors openMode via QUICK_PANEL_OPEN_URL', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createWebSearchProvider();

    const ctx: SearchProviderContext = {
      requestedScope: 'web_google',
      query: { raw: 'React Hooks', text: 'react hooks', tokens: ['react', 'hooks'] },
      limit: 10,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Search Google');
    expect(results[0]?.subtitle).toBe('React Hooks');
    expect(results[0]?.data.url).toBe('https://www.google.com/search?q=React%20Hooks');

    const open = provider.getActions(results[0] as any)[0];
    await open.execute({ result: results[0], openMode: 'new_tab' } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_OPEN_URL,
      payload: { url: 'https://www.google.com/search?q=React%20Hooks', disposition: 'new_tab' },
    });
  });
});
