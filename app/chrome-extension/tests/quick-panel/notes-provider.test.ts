import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotesProvider } from '@/shared/quick-panel/providers/notes-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel notes provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    return writeText;
  }

  it('shows a create entry when query is non-empty', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_LIST) {
        return Promise.resolve({ success: true, items: [] });
      }
      return Promise.resolve({ success: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createNotesProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'notes',
      query: { raw: 'hello', text: 'hello', tokens: ['hello'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'notes.create')).toBe(true);
  });

  it('creates a note via QUICK_PANEL_NOTES_CREATE', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_CREATE) {
        return Promise.resolve({
          success: true,
          note: {
            id: 'n1',
            title: 'hello',
            preview: 'hello',
            createdAt: 1,
            updatedAt: 1,
            incognito: false,
          },
        });
      }
      return Promise.resolve({ success: true, items: [] });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createNotesProvider();
    const action = provider.getActions({
      id: 'notes.create',
      provider: 'notes',
      title: 'Create note',
      score: 1,
      data: { kind: 'create', content: 'hello' },
    } as any)[0];

    await action.execute({ result: {} as any } as any);
    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_CREATE,
      payload: { content: 'hello' },
    });
  });

  it('copies a note via GET + clipboard', async () => {
    const writeText = stubClipboard();

    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_LIST) {
        return Promise.resolve({
          success: true,
          items: [
            {
              id: 'n1',
              title: 'Todo',
              preview: 'Buy milk',
              createdAt: 1,
              updatedAt: 2,
              incognito: false,
            },
          ],
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_GET) {
        return Promise.resolve({
          success: true,
          note: {
            id: 'n1',
            title: 'Todo',
            preview: 'Buy milk',
            content: 'Buy milk',
            createdAt: 1,
            updatedAt: 2,
            incognito: false,
          },
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_RECORD) {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createNotesProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'notes',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const note = results.find((r) => r.id === 'note.n1')!;
    expect(note).toBeTruthy();

    const copy = provider.getActions(note as any).find((a) => a.id === 'notes.copy')!;
    await copy.execute({ result: note as any } as any);

    expect(writeText).toHaveBeenCalledWith('Buy milk');
  });

  it('deletes a note via QUICK_PANEL_NOTES_DELETE', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_DELETE) {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createNotesProvider();
    const result = {
      id: 'note.n1',
      provider: 'notes',
      title: 'Todo',
      score: 1,
      data: {
        kind: 'note',
        id: 'n1',
        title: 'Todo',
        preview: 'Buy milk',
        createdAt: 1,
        updatedAt: 2,
        incognito: false,
      },
    };

    const del = provider.getActions(result as any).find((a) => a.id === 'notes.delete')!;
    await del.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_DELETE,
      payload: { id: 'n1' },
    });
  });
});
