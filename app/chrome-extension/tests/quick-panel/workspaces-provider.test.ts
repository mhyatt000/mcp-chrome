import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkspacesProvider } from '@/shared/quick-panel/providers/workspaces-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel workspaces provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows save current session entry on empty query', async () => {
    const sendMessage = vi.fn(async (msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_LIST) {
        return {
          success: true,
          items: [
            {
              id: 'ws_1',
              name: 'My session',
              tabCount: 12,
              createdAt: 1,
              updatedAt: 2,
              incognito: false,
            },
          ],
        };
      }
      throw new Error('Unexpected message');
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createWorkspacesProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'workspaces',
      query: { raw: '', text: '', tokens: [] },
      limit: 10,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results[0]?.id).toBe('workspaces.saveCurrent');
    expect(results.some((r) => r.id === 'ws_1')).toBe(true);
  });

  it('shows save-as entry when query has no exact match', async () => {
    const sendMessage = vi.fn(async (msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_LIST) {
        return {
          success: true,
          items: [
            {
              id: 'ws_1',
              name: 'Other',
              tabCount: 2,
              createdAt: 1,
              updatedAt: 2,
              incognito: false,
            },
          ],
        };
      }
      throw new Error('Unexpected message');
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createWorkspacesProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'workspaces',
      query: { raw: 'Project X', text: 'project x', tokens: ['project', 'x'] },
      limit: 10,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results[0]?.id).toBe(`workspaces.saveAs:${encodeURIComponent('Project X')}`);
  });

  it('open action maps openMode to new_window vs current_window', async () => {
    const sendMessage = vi.fn(async (msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_OPEN) {
        return { success: true, openedCount: 1, totalCount: 1 };
      }
      throw new Error('Unexpected message');
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createWorkspacesProvider();
    const result = {
      id: 'ws_1',
      provider: 'workspaces',
      title: 'My session',
      subtitle: '1 tabs',
      icon: '🗃️',
      data: {
        kind: 'workspace',
        workspaceId: 'ws_1',
        name: 'My session',
        tabCount: 1,
        createdAt: 1,
        updatedAt: 2,
        incognito: false,
      },
      score: 100,
    };

    const open = provider.getActions(result as any)[0];
    await open.execute({ result, openMode: 'current_tab' } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_OPEN,
      payload: { workspaceId: 'ws_1', target: 'new_window' },
    });

    await open.execute({ result, openMode: 'new_tab' } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_OPEN,
      payload: { workspaceId: 'ws_1', target: 'current_window' },
    });
  });
});
