import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContentProvider } from '@/shared/quick-panel/providers/content-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel content provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('maps background matches to SearchResult items', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      success: true,
      items: [
        {
          tabId: 10,
          windowId: 2,
          url: 'https://example.com/docs',
          title: 'Docs',
          favIconUrl: 'https://example.com/favicon.ico',
          snippet: '…example snippet…',
          score: 123,
        },
      ],
    });

    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    });

    const provider = createContentProvider();

    const ctx: SearchProviderContext = {
      requestedScope: 'content',
      query: { raw: 'docs', text: 'docs', tokens: ['docs'] },
      limit: 10,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results).toHaveLength(1);
    expect(results[0]?.provider).toBe('content');
    expect(results[0]?.title).toBe('Docs');
    expect(results[0]?.subtitle).toBe('…example snippet…');

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CONTENT_QUERY,
      payload: { query: 'docs', maxResults: 10 },
    });
  });

  it('honors openMode=new_tab by opening the URL instead of switching tabs', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });

    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    });

    const provider = createContentProvider();

    const result = {
      id: '10',
      provider: 'content',
      title: 'Docs',
      subtitle: '…example snippet…',
      icon: '📄',
      data: {
        tabId: 10,
        windowId: 2,
        url: 'https://example.com/docs',
        title: 'Docs',
        favIconUrl: undefined,
        snippet: '…example snippet…',
      },
      score: 1,
    };

    const actions = provider.getActions(result as any);
    const open = actions[0];
    expect(open?.id).toBe('content.open');

    await open.execute({ result, openMode: 'new_tab' } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_OPEN_URL,
      payload: { url: 'https://example.com/docs', disposition: 'new_tab' },
    });
  });
});
