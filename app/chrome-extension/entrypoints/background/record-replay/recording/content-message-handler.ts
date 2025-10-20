import type { RecordingSessionManager } from './session-manager';
import type { Step } from '../types';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

export function initContentMessageHandler(session: RecordingSessionManager): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (!message || message.type !== TOOL_MESSAGE_TYPES.RR_RECORDER_EVENT) return false;
      if (session.getStatus() !== 'recording') {
        sendResponse({ ok: true });
        return true;
      }
      const flow = session.getFlow();
      if (!flow) {
        sendResponse({ ok: true });
        return true;
      }
      const payload = message?.payload || {};
      if (payload.kind === 'steps' || payload.kind === 'step') {
        const steps: Step[] = Array.isArray(payload.steps)
          ? (payload.steps as Step[])
          : payload.step
            ? [payload.step as Step]
            : [];
        // Use session-aware append to keep session state consistent
        session.appendSteps(steps);
      }
      // payload.kind === 'start'|'stop' are no-ops here (lifecycle handled elsewhere)
      sendResponse({ ok: true });
      return true;
    } catch (e) {
      console.warn('ContentMessageHandler: processing message failed', e);
      sendResponse({ ok: false, error: String((e as any)?.message || e) });
      return true;
    }
  });
}
