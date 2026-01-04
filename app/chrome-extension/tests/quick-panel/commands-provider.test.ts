import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCommandsProvider } from '@/shared/quick-panel/providers/commands-provider';
import type { SearchProviderContext } from '@/shared/quick-panel/core/types';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

describe('Quick Panel commands provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    try {
      history.replaceState({}, '', 'https://example.com/');
    } catch {
      // Best-effort
    }
  });

  it('search includes advanced tab/window management commands', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });

    const provider = createCommandsProvider();

    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'merge windows', text: 'merge windows', tokens: ['merge', 'windows'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'window.mergeAllWindows')).toBe(true);
  });

  it('search includes page skin commands', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });

    const provider = createCommandsProvider();

    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'skin vscode', text: 'skin vscode', tokens: ['skin', 'vscode'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    expect(results.some((r) => r.id === 'page.skinVscode')).toBe(true);
  });

  it('search includes page tools (reader, clean url)', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });

    const provider = createCommandsProvider();

    const readerCtx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'reader', text: 'reader', tokens: ['reader'] },
      limit: 50,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const readerResults = await provider.search(readerCtx);
    expect(readerResults.some((r) => r.id === 'page.readerMode')).toBe(true);

    const cleanCtx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'clean url', text: 'clean url', tokens: ['clean', 'url'] },
      limit: 50,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const cleanResults = await provider.search(cleanCtx);
    expect(cleanResults.some((r) => r.id === 'page.cleanUrl')).toBe(true);
  });

  it('search includes devtools export commands', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });

    const provider = createCommandsProvider();

    const consoleCtx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'export console', text: 'export console', tokens: ['export', 'console'] },
      limit: 50,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const consoleResults = await provider.search(consoleCtx);
    expect(consoleResults.some((r) => r.id === 'dev.consoleSnapshot')).toBe(true);
    expect(consoleResults.some((r) => r.id === 'dev.consoleErrors')).toBe(true);

    const netCtx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'network capture', text: 'network capture', tokens: ['network', 'capture'] },
      limit: 50,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const netResults = await provider.search(netCtx);
    expect(netResults.some((r) => r.id === 'dev.networkCapture10s')).toBe(true);

    const perfCtx: SearchProviderContext = {
      requestedScope: 'commands',
      query: {
        raw: 'performance trace',
        text: 'performance trace',
        tokens: ['performance', 'trace'],
      },
      limit: 50,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const perfResults = await provider.search(perfCtx);
    expect(perfResults.some((r) => r.id === 'dev.performanceTrace5s')).toBe(true);

    const bundleCtx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'debug bundle', text: 'debug bundle', tokens: ['debug', 'bundle'] },
      limit: 50,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const bundleResults = await provider.search(bundleCtx);
    expect(bundleResults.some((r) => r.id === 'dev.debugBundle')).toBe(true);
  });

  it('executes close other tabs via QUICK_PANEL_PAGE_COMMAND and marks as danger', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createCommandsProvider();

    const result = {
      id: 'tab.closeOtherTabs',
      provider: 'commands',
      title: 'Close other tabs',
      subtitle: 'Close all other unpinned tabs in current window',
      icon: '🧹',
      data: { commandId: 'tab.closeOtherTabs' as const },
      score: 1,
    };

    const action = provider.getActions(result as any)[0];
    expect(action?.tone).toBe('danger');

    await action.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND,
      payload: { command: 'close_other_tabs' },
    });
  });

  it('executes skin command via QUICK_PANEL_PAGE_COMMAND', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createCommandsProvider();

    const result = {
      id: 'page.skinTerminal',
      provider: 'commands',
      title: 'Skin: Terminal',
      subtitle: 'Apply terminal-inspired page skin (shows "Skin mode")',
      icon: '🎨',
      data: { commandId: 'page.skinTerminal' as const },
      score: 1,
    };

    const action = provider.getActions(result as any)[0];
    await action.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND,
      payload: { command: 'skin_terminal' },
    });
  });

  it('executes reader mode via QUICK_PANEL_PAGE_COMMAND', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createCommandsProvider();

    const result = {
      id: 'page.readerMode',
      provider: 'commands',
      title: 'Reader mode',
      subtitle: 'Open a distraction-free reader overlay (Esc to close)',
      icon: '📖',
      data: { commandId: 'page.readerMode' as const },
      score: 1,
    };

    const action = provider.getActions(result as any)[0];
    await action.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND,
      payload: { command: 'reader_mode_toggle' },
    });
  });

  it('executes devtools network capture export via QUICK_PANEL_PAGE_COMMAND', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createCommandsProvider();

    const result = {
      id: 'dev.networkCapture10s',
      provider: 'commands',
      title: 'Network capture (10s)',
      subtitle: 'Capture network requests for 10 seconds and export JSON to Downloads',
      icon: '📡',
      data: { commandId: 'dev.networkCapture10s' as const },
      score: 1,
    };

    const action = provider.getActions(result as any)[0];
    await action.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND,
      payload: { command: 'dev_network_capture_10s_export' },
    });
  });

  it('executes debug bundle via QUICK_PANEL_PAGE_COMMAND', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const provider = createCommandsProvider();

    const result = {
      id: 'dev.debugBundle',
      provider: 'commands',
      title: 'Debug bundle',
      subtitle: 'Collect screenshot/console/network/performance into a Downloads folder',
      icon: '🐛',
      data: { commandId: 'dev.debugBundle' as const },
      score: 1,
    };

    const action = provider.getActions(result as any)[0];
    await action.execute({ result } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND,
      payload: { command: 'dev_debug_bundle_create' },
    });
  });

  it('clean url opens cleaned URL in new tab and preserves hash', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    // Update JSDOM location for this test
    history.pushState({}, '', 'https://example.com/path?utm_source=x&gclid=abc#sec');

    const provider = createCommandsProvider();

    const result = {
      id: 'page.cleanUrl',
      provider: 'commands',
      title: 'Clean URL',
      subtitle: 'Remove tracking params and copy/open the cleaned URL',
      icon: '🧼',
      data: { commandId: 'page.cleanUrl' as const },
      score: 1,
    };

    const action = provider.getActions(result as any)[0];
    await action.execute({ result, openMode: 'new_tab' } as any);

    expect(sendMessage).toHaveBeenCalledWith({
      type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_OPEN_URL,
      payload: { url: 'https://example.com/path#sec', disposition: 'new_tab' },
    });
  });

  it('clean url copies cleaned URL by default (safe)', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    history.pushState({}, '', 'https://example.com/path?utm_source=x');

    const provider = createCommandsProvider();

    const result = {
      id: 'page.cleanUrl',
      provider: 'commands',
      title: 'Clean URL',
      subtitle: 'Remove tracking params and copy/open the cleaned URL',
      icon: '🧼',
      data: { commandId: 'page.cleanUrl' as const },
      score: 1,
    };

    const action = provider.getActions(result as any)[0];
    await action.execute({ result, openMode: 'current_tab' } as any);

    expect(writeText).toHaveBeenCalledWith('https://example.com/path');
  });

  it('toolbox json formats and copies pretty output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const provider = createCommandsProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'json {"a":1}', text: 'json {"a":1}', tokens: ['json', '{"a":1}'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const jsonResult = results.find((r) => r.id === 'toolbox.json');
    expect(jsonResult).toBeTruthy();

    const action = provider.getActions(jsonResult as any)[0];
    await action.execute({ result: jsonResult } as any);

    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it('toolbox base64 decode copies decoded text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const provider = createCommandsProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: {
        raw: 'base64 -d SGVsbG8=',
        text: 'base64 -d sgvsbg8=',
        tokens: ['base64', '-d', 'sgvsbg8='],
      },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const res = results.find((r) => r.id === 'toolbox.base64.decode');
    expect(res).toBeTruthy();

    const action = provider.getActions(res as any)[0];
    await action.execute({ result: res } as any);

    expect(writeText).toHaveBeenCalledWith('Hello');
  });

  it('toolbox url decode copies decoded text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const provider = createCommandsProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: {
        raw: 'url -d %E4%BD%A0%E5%A5%BD',
        text: 'url -d %e4%bd%a0%e5%a5%bd',
        tokens: ['url', '-d', '%e4%bd%a0%e5%a5%bd'],
      },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const res = results.find((r) => r.id === 'toolbox.url.decode');
    expect(res).toBeTruthy();

    const action = provider.getActions(res as any)[0];
    await action.execute({ result: res } as any);

    expect(writeText).toHaveBeenCalledWith('你好');
  });

  it('toolbox ts converts timestamp and copies ISO', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const provider = createCommandsProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'ts 1699123456', text: 'ts 1699123456', tokens: ['ts', '1699123456'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const res = results.find((r) => r.id === 'toolbox.ts');
    expect(res).toBeTruthy();

    const action = provider.getActions(res as any)[0];
    await action.execute({ result: res } as any);

    expect(writeText).toHaveBeenCalledWith(new Date(1699123456000).toISOString());
  });

  it('toolbox uuid generates and copies uuid', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const provider = createCommandsProvider();
    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: 'uuid', text: 'uuid', tokens: ['uuid'] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const res = results.find((r) => r.id === 'toolbox.uuid');
    expect(res).toBeTruthy();

    const action = provider.getActions(res as any)[0];
    await action.execute({ result: res } as any);

    const [firstCallArg] = writeText.mock.calls[0] ?? [];
    expect(firstCallArg).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('toolbox jwt returns header and payload results', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const provider = createCommandsProvider();
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    const ctx: SearchProviderContext = {
      requestedScope: 'commands',
      query: { raw: `jwt ${token}`, text: `jwt ${token}`, tokens: ['jwt', token] },
      limit: 20,
      signal: new AbortController().signal,
      now: Date.now(),
    };

    const results = await provider.search(ctx);
    const header = results.find((r) => r.id === 'toolbox.jwt.header');
    const payload = results.find((r) => r.id === 'toolbox.jwt.payload');
    expect(header).toBeTruthy();
    expect(payload).toBeTruthy();

    const headerAction = provider.getActions(header as any)[0];
    await headerAction.execute({ result: header } as any);
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2));

    const payloadAction = provider.getActions(payload as any)[0];
    await payloadAction.execute({ result: payload } as any);
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify({ sub: '1234567890', name: 'John Doe', iat: 1516239022 }, null, 2),
    );
  });
});
