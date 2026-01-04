import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFocusProvider } from '@/shared/quick-panel/providers/focus-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel focus provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function makeIdleStatus() {
    return {
      incognito: false,
      now: Date.now(),
      session: {
        phase: 'idle' as const,
        startedAt: 0,
        endsAt: 0,
        remainingMs: 0,
        durationMs: 0,
        updatedAt: Date.now(),
      },
      blockingEnabled: false,
      blockingActive: false,
      blockingSnoozedUntil: 0,
      blocklist: [] as string[],
    };
  }

  it('shows status and start presets when idle', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS) {
        return Promise.resolve({ success: true, status: makeIdleStatus() });
      }
      return Promise.resolve({ success: true, status: makeIdleStatus() });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createFocusProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'focus',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'focus.status')).toBe(true);
    expect(results.some((r) => r.id === 'focus.start.25')).toBe(true);
  });

  it('starts a focus session with numeric query', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS) {
        return Promise.resolve({ success: true, status: makeIdleStatus() });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_START) {
        return Promise.resolve({ success: true, status: makeIdleStatus() });
      }
      return Promise.resolve({ success: true, status: makeIdleStatus() });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createFocusProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'focus',
      query: { raw: '25', text: '25', tokens: ['25'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results[0]?.id).toBe('focus.start.25');

    const action = provider.getActions(results[0] as any)[0];
    await action.execute({ result: results[0] as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_START,
      payload: { durationMinutes: 25 },
    });
  });

  it('toggles blocking via status actions', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS) {
        return Promise.resolve({ success: true, status: makeIdleStatus() });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKING_ENABLED) {
        return Promise.resolve({ success: true, status: makeIdleStatus() });
      }
      return Promise.resolve({ success: true, status: makeIdleStatus() });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createFocusProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'focus',
      query: { raw: '', text: '', tokens: [] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const status = results.find((r) => r.id === 'focus.status')!;
    const toggle = provider.getActions(status as any).find((a) => a.id === 'focus.toggleBlocking')!;

    await toggle.execute({ result: status as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKING_ENABLED,
      payload: { enabled: true },
    });
  });

  it('sets blocklist via `block` command', async () => {
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS) {
        return Promise.resolve({ success: true, status: makeIdleStatus() });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKLIST) {
        return Promise.resolve({ success: true, status: makeIdleStatus() });
      }
      return Promise.resolve({ success: true, status: makeIdleStatus() });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createFocusProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'focus',
      query: {
        raw: 'block youtube.com twitter.com',
        text: 'block youtube.com twitter.com',
        tokens: ['block', 'youtube.com', 'twitter.com'],
      },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const entry = results.find((r) => r.id === 'focus.blocklist.set')!;
    const action = provider.getActions(entry as any)[0];
    await action.execute({ result: entry as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKLIST,
      payload: { domains: ['youtube.com', 'twitter.com'] },
    });
  });

  it('snoozes blocking via `snooze` command', async () => {
    const running = {
      ...makeIdleStatus(),
      session: {
        phase: 'running' as const,
        startedAt: Date.now(),
        endsAt: Date.now() + 25 * 60_000,
        remainingMs: 25 * 60_000,
        durationMs: 25 * 60_000,
        updatedAt: Date.now(),
      },
      blockingEnabled: true,
      blockingActive: true,
      blockingSnoozedUntil: 0,
      blocklist: ['youtube.com'],
    };

    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS) {
        return Promise.resolve({ success: true, status: running });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SNOOZE_BLOCKING) {
        return Promise.resolve({ success: true, status: running });
      }
      return Promise.resolve({ success: true, status: running });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createFocusProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'focus',
      query: { raw: 'snooze 5', text: 'snooze 5', tokens: ['snooze', '5'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const entry = results.find((r) => r.id === 'focus.blocking.snooze.5')!;
    const action = provider.getActions(entry as any)[0];
    await action.execute({ result: entry as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SNOOZE_BLOCKING,
      payload: { minutes: 5 },
    });
  });

  it('resumes blocking via `resume-blocking` command', async () => {
    const status = makeIdleStatus();
    const sendMessage = vi.fn().mockImplementation((msg: any) => {
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS) {
        return Promise.resolve({ success: true, status });
      }
      if (msg?.type === BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME_BLOCKING) {
        return Promise.resolve({ success: true, status });
      }
      return Promise.resolve({ success: true, status });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createFocusProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'focus',
      query: { raw: 'resume-blocking', text: 'resume-blocking', tokens: ['resume-blocking'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results[0]?.id).toBe('focus.blocking.resume');
    const action = provider.getActions(results[0] as any)[0];
    await action.execute({ result: results[0] as any } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME_BLOCKING,
      payload: {},
    });
  });
});
