import type { Flow } from '../types';
import { saveFlow } from '../flow-store';
import { broadcastControlToTab, ensureRecorderInjected, REC_CMD } from './content-injection';
import { recordingSession as session } from './session-manager';
import { createInitialFlow, addNavigationStep } from './flow-builder';
import { initBrowserEventListeners } from './browser-event-listener';
import { initContentMessageHandler } from './content-message-handler';

class RecorderManagerImpl {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    initBrowserEventListeners(session);
    initContentMessageHandler(session);
    this.initialized = true;
  }

  async start(meta?: Partial<Flow>): Promise<{ success: boolean; error?: string }> {
    if (session.getStatus() !== 'idle')
      return { success: false, error: 'Recording already active' };
    // Resolve active tab
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active?.id) return { success: false, error: 'Active tab not found' };

    // Initialize flow & session
    const flow: Flow = createInitialFlow(meta);
    await session.startSession(flow, active.id);

    // Ensure recorder available and start listening
    await ensureRecorderInjected(active.id);
    await broadcastControlToTab(active.id, REC_CMD.START, {
      id: flow.id,
      name: flow.name,
      description: flow.description,
    });
    // Track active tab for targeted STOP broadcasts
    session.addActiveTab(active.id);

    // Record for first step
    const url = active.url;
    if (url) {
      addNavigationStep(flow, url);
      try {
        saveFlow(flow);
      } catch (e) {
        console.warn('RecorderManager: initial saveFlow failed', e);
      }
    }

    return { success: true };
  }

  async stop(): Promise<{ success: boolean; error?: string; flow?: Flow }> {
    if (session.getStatus() === 'idle' || !session.getFlow())
      return { success: false, error: 'No active recording' };
    // Best-effort STOP for all tabs that participated in this session
    try {
      const tabs = session.getActiveTabs();
      await Promise.all(tabs.map(async (id) => broadcastControlToTab(id, REC_CMD.STOP)));
    } catch {}
    const flow = await session.stopSession();
    if (flow) await saveFlow(flow);
    return flow ? { success: true, flow } : { success: true };
  }
}

export const RecorderManager = new RecorderManagerImpl();
