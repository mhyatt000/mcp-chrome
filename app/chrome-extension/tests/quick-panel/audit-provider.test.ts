import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuditProvider } from '@/shared/quick-panel/providers/audit-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel audit provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lists recent audit entries on empty query', async () => {
    const entry = {
      id: 'log_1',
      toolName: 'chrome_read_page',
      toolDescription: 'read page',
      riskLevel: 'low' as const,
      riskCategories: ['read'],
      source: 'native_host' as const,
      incognito: false,
      status: 'success' as const,
      startedAt: Date.now() - 1000,
      finishedAt: Date.now(),
      durationMs: 1000,
      argsSummary: '{ "depth": 2 }',
      resultSummary: '{ "success": true }',
    };

    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_LIST) {
        return Promise.resolve({ success: true, entries: [entry] });
      }
      return Promise.resolve({ success: true });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createAuditProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'audit',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'audit.log_1')).toBe(true);
  });

  it('offers clear command and triggers clear', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_LIST) {
        return Promise.resolve({ success: true, entries: [] });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_CLEAR) {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: false, error: 'unexpected' });
    });

    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createAuditProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'audit',
      query: { raw: 'clear', text: 'clear', tokens: ['clear'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results[0]?.id).toBe('audit.clear');

    const action = provider.getActions(results[0] as any)[0];
    await action.execute({ result: results[0] as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_CLEAR,
      payload: {},
    });
  });
});
