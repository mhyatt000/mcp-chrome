import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMonitorProvider } from '@/shared/quick-panel/providers/monitor-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel monitor provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows empty state when no monitors exist', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_LIST) {
        return Promise.resolve({ success: true, monitors: [], alerts: [], unreadCount: 0 });
      }
      return Promise.resolve({ success: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createMonitorProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'monitor',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'monitor.summary')).toBe(true);
    expect(results.some((r) => r.id === 'monitor.empty')).toBe(true);
  });

  it('creates a virtual create entry from `<url> <selector>` and sends create message', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_LIST) {
        return Promise.resolve({ success: true, monitors: [], alerts: [], unreadCount: 0 });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CREATE) {
        return Promise.resolve({
          success: true,
          monitor: {
            id: 'm1',
            url: msg.payload.url,
            extractor: 'selector_text',
            selector: msg.payload.selector,
            intervalMinutes: msg.payload.intervalMinutes,
            enabled: true,
            incognito: false,
            createdAt: 1,
            updatedAt: 1,
            lastCheckedAt: 0,
            lastChangedAt: 0,
            unreadAlerts: 0,
          },
        });
      }
      return Promise.resolve({ success: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createMonitorProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'monitor',
      query: {
        raw: 'https://example.com .price',
        text: 'https://example.com .price',
        tokens: ['https://example.com', '.price'],
      },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const create = results.find((r) => r.id.startsWith('monitor.create.'))!;
    expect(create).toBeTruthy();

    const action = provider.getActions(create as any)[0]!;
    await action.execute({ result: create as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CREATE,
      payload: {
        url: 'https://example.com/',
        selector: '.price',
        intervalMinutes: 15,
        fetchNow: true,
      },
    });
  });

  it('checks a monitor via QUICK_PANEL_MONITOR_CHECK_NOW', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_LIST) {
        return Promise.resolve({
          success: true,
          unreadCount: 0,
          monitors: [
            {
              id: 'm1',
              url: 'https://example.com',
              extractor: 'selector_text',
              selector: '.price',
              intervalMinutes: 15,
              enabled: true,
              incognito: false,
              createdAt: 1,
              updatedAt: 2,
              lastCheckedAt: 3,
              lastChangedAt: 0,
              unreadAlerts: 0,
            },
          ],
          alerts: [],
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CHECK_NOW) {
        return Promise.resolve({
          success: true,
          monitor: {
            id: 'm1',
            url: 'https://example.com',
            extractor: 'selector_text',
            selector: '.price',
            intervalMinutes: 15,
            enabled: true,
            incognito: false,
            createdAt: 1,
            updatedAt: 2,
            lastCheckedAt: 3,
            lastChangedAt: 0,
            unreadAlerts: 0,
          },
        });
      }
      return Promise.resolve({ success: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createMonitorProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'monitor',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const monitorResult = results.find((r) => r.id === 'monitor.m1')!;
    expect(monitorResult).toBeTruthy();

    const check = provider
      .getActions(monitorResult as any)
      .find((a) => a.id === 'monitor.checkNow')!;
    await check.execute({ result: monitorResult as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CHECK_NOW,
      payload: { id: 'm1' },
    });
  });

  it('marks an alert read via QUICK_PANEL_MONITOR_ALERT_MARK_READ', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_LIST) {
        return Promise.resolve({
          success: true,
          unreadCount: 1,
          monitors: [],
          alerts: [
            {
              id: 'a1',
              monitorId: 'm1',
              incognito: false,
              createdAt: 1,
              url: 'https://example.com',
              selector: '.price',
              oldValue: '$1',
              newValue: '$2',
              read: false,
            },
          ],
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_MARK_READ) {
        return Promise.resolve({ success: true, unreadCount: 0 });
      }
      return Promise.resolve({ success: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createMonitorProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'monitor',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const alertResult = results.find((r) => r.id === 'monitor.alert.a1')!;
    expect(alertResult).toBeTruthy();

    const mark = provider
      .getActions(alertResult as any)
      .find((a) => a.id === 'monitor.alert.markRead')!;
    await mark.execute({ result: alertResult as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_MARK_READ,
      payload: { id: 'a1', read: true },
    });
  });
});
