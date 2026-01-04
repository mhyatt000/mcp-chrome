import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClipboardProvider } from '@/shared/quick-panel/providers/clipboard-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel clipboard provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    return writeText;
  }

  it('returns an empty state entry when history is empty', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_LIST) {
        return Promise.resolve({ success: true, items: [] });
      }
      return Promise.resolve({ success: true });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createClipboardProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'clipboard',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'clip.empty')).toBe(true);
  });

  it('lists clipboard items and exposes copy action', async () => {
    const writeText = stubClipboard();

    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_LIST) {
        return Promise.resolve({
          success: true,
          items: [
            {
              id: 'c1',
              preview: 'hello world',
              pinned: false,
              createdAt: 1,
              updatedAt: 2,
              incognito: false,
              source: 'commands.copy.url',
              label: 'Example',
              originUrl: 'https://example.com',
              originTitle: 'Example',
              byteLength: 11,
              stored: true,
              copyCount: 1,
            },
          ],
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_GET) {
        return Promise.resolve({
          success: true,
          item: {
            id: 'c1',
            preview: 'hello world',
            pinned: false,
            createdAt: 1,
            updatedAt: 2,
            incognito: false,
            source: 'commands.copy.url',
            label: 'Example',
            originUrl: 'https://example.com',
            originTitle: 'Example',
            byteLength: 11,
            stored: true,
            copyCount: 1,
            value: 'hello world',
          },
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_RECORD) {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createClipboardProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'clipboard',
      query: { raw: 'hello', text: 'hello', tokens: ['hello'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const item = results.find((r) => r.id === 'clip.c1');
    expect(item).toBeTruthy();

    const actions = provider.getActions(item as any);
    expect(actions[0]?.id).toBe('clipboard.copy');

    await actions[0].execute({ result: item as any } as any);
    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('pins and deletes clipboard items via background bridge', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_SET_PINNED) {
        return Promise.resolve({ success: true });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_DELETE) {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true, items: [] });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createClipboardProvider();
    const result = {
      id: 'clip.c1',
      provider: 'clipboard',
      title: 'hello',
      score: 1,
      data: {
        kind: 'clipboard' as const,
        id: 'c1',
        preview: 'hello',
        pinned: false,
        createdAt: 1,
        updatedAt: 2,
        incognito: false,
        byteLength: 5,
        stored: true,
        copyCount: 1,
      },
    };

    const actions = provider.getActions(result as any);
    const pin = actions.find((a) => a.id === 'clipboard.togglePin')!;
    await pin.execute({ result } as any);
    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_SET_PINNED,
      payload: { id: 'c1', pinned: true },
    });

    const del = actions.find((a) => a.id === 'clipboard.delete')!;
    await del.execute({ result } as any);
    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_DELETE,
      payload: { id: 'c1' },
    });
  });
});
