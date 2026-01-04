import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiDetectiveProvider } from '@/shared/quick-panel/providers/api-detective-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel API Detective provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function stubClipboard() {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  }

  it('search returns command entries and request list for `api` query', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STATUS) {
        return Promise.resolve({
          success: true,
          active: false,
          backend: null,
          startedAt: null,
          lastCaptureAt: 111,
          lastRequestCount: 1,
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_LIST) {
        return Promise.resolve({
          success: true,
          active: false,
          backend: null,
          capturedAt: 111,
          tabUrl: 'https://example.com',
          items: [
            {
              requestId: 'r1',
              method: 'GET',
              url: 'https://api.example.com/user',
              type: 'XHR',
              status: 200,
              mimeType: 'application/json',
            },
          ],
        });
      }
      return Promise.resolve({ success: true });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createApiDetectiveProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'api', text: 'api', tokens: ['api'] },
      limit: 10,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'api_detective.status')).toBe(true);
    expect(results.some((r) => r.id === 'api_detective.start')).toBe(true);
    expect(results.some((r) => r.id === 'api_detective.stop')).toBe(true);
    expect(results.some((r) => r.id === 'api_detective.req.r1')).toBe(true);
  });

  it('executes start capture via QUICK_PANEL_API_DETECTIVE_START', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_START) {
        return Promise.resolve({
          success: true,
          active: true,
          backend: 'webRequest',
          startedAt: 1,
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STATUS) {
        return Promise.resolve({
          success: true,
          active: false,
          backend: null,
          startedAt: null,
          lastCaptureAt: null,
          lastRequestCount: 0,
        });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_LIST) {
        return Promise.resolve({
          success: true,
          active: false,
          backend: null,
          capturedAt: null,
          tabUrl: null,
          items: [],
        });
      }
      return Promise.resolve({ success: true });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createApiDetectiveProvider();
    const action = provider.getActions({
      id: 'api_detective.start',
      provider: 'api_detective',
      title: 'Start capture',
      score: 1,
      data: { kind: 'command', command: 'start' },
    } as any)[0];

    await action.execute({ result: {} as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_START,
      payload: { needResponseBody: false, includeStatic: false, maxCaptureTimeMs: 180000 },
    });
  });

  it('copies curl snippet via GET_REQUEST + clipboard', async () => {
    stubClipboard();

    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_GET_REQUEST) {
        return Promise.resolve({
          success: true,
          request: {
            requestId: 'r1',
            method: 'POST',
            url: 'https://example.com/api',
            requestHeaders: { 'Content-Type': 'application/json' },
            requestBody: '{"a":1}',
          },
        });
      }
      return Promise.resolve({ success: true });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createApiDetectiveProvider();
    const result = {
      id: 'api_detective.req.r1',
      provider: 'api_detective',
      title: 'POST example.com/api',
      score: 1,
      data: {
        kind: 'request',
        requestId: 'r1',
        method: 'POST',
        url: 'https://example.com/api',
        backend: 'webRequest',
        capturedAt: 1,
        tabUrl: 'https://example.com',
      },
    };

    const action = provider.getActions(result as any)[0];
    await action.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_GET_REQUEST,
      payload: { requestId: 'r1' },
    });

    const writeText = (navigator as any).clipboard.writeText as any;
    expect(writeText).toHaveBeenCalled();
    const copied = String(writeText.mock.calls[0]?.[0] ?? '');
    expect(copied.startsWith('curl')).toBe(true);
  });

  it('replays request via QUICK_PANEL_API_DETECTIVE_REPLAY_REQUEST', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_REPLAY_REQUEST) {
        return Promise.resolve({ success: true, result: { ok: true } });
      }
      return Promise.resolve({ success: true });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createApiDetectiveProvider();
    const result = {
      id: 'api_detective.req.r1',
      provider: 'api_detective',
      title: 'GET example.com/api',
      score: 1,
      data: {
        kind: 'request',
        requestId: 'r1',
        method: 'GET',
        url: 'https://example.com/api',
        backend: 'webRequest',
        capturedAt: 1,
        tabUrl: 'https://example.com',
      },
    };

    const action = provider.getActions(result as any).find((a) => a.id === 'api_detective.replay')!;
    await action.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_REPLAY_REQUEST,
      payload: { requestId: 'r1', timeoutMs: 30000 },
    });
  });
});
