import { BACKGROUND_MESSAGE_TYPES, TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { Flow } from './types';
import {
  listFlows,
  saveFlow,
  getFlow,
  deleteFlow,
  publishFlow,
  unpublishFlow,
  exportFlow,
  exportAllFlows,
  importFlowFromJson,
} from './flow-store';
import { runFlow } from './flow-runner';

// design note: background listener for record & replay; manages start/stop and storage

let currentRecording: { tabId: number; flow?: Flow } | null = null;

async function ensureRecorderInjected(tabId: number): Promise<void> {
  // Inject helper and recorder scripts
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['inject-scripts/accessibility-tree-helper.js'],
    world: 'ISOLATED',
  } as any);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['inject-scripts/recorder.js'],
    world: 'ISOLATED',
  } as any);
}

async function startRecording(meta?: Partial<Flow>): Promise<{ success: boolean; error?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return { success: false, error: 'Active tab not found' };
  try {
    await ensureRecorderInjected(tab.id);
    currentRecording = { tabId: tab.id };
    await chrome.tabs.sendMessage(tab.id, {
      action: TOOL_MESSAGE_TYPES.RR_RECORDER_CONTROL,
      cmd: 'start',
      meta: {
        id: meta?.id,
        name: meta?.name,
        description: meta?.description,
      },
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function stopRecording(): Promise<{ success: boolean; flow?: Flow; error?: string }> {
  if (!currentRecording) return { success: false, error: 'No active recording' };
  try {
    const flowRes: any = await chrome.tabs.sendMessage(currentRecording.tabId, {
      action: TOOL_MESSAGE_TYPES.RR_RECORDER_CONTROL,
      cmd: 'stop',
    });
    const flow = (flowRes && flowRes.flow) as Flow;
    if (flow) {
      await saveFlow(flow);
    }
    const resp = { success: true, flow };
    currentRecording = null;
    return resp;
  } catch (e: any) {
    const err = { success: false, error: e?.message || String(e) };
    currentRecording = null;
    return err;
  }
}

export function initRecordReplayListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message && message.type === 'rr_recorder_event') {
        if (currentRecording) {
          if (message.payload?.kind === 'start') {
            currentRecording.flow = message.payload.flow;
          } else if (message.payload?.kind === 'step') {
            // background can enrich or validate steps if needed in future
          } else if (message.payload?.kind === 'stop') {
            currentRecording.flow = message.payload.flow || currentRecording.flow;
          }
        }
        sendResponse({ ok: true });
        return true;
      }

      switch (message?.type) {
        case BACKGROUND_MESSAGE_TYPES.RR_START_RECORDING: {
          startRecording(message.meta)
            .then(sendResponse)
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_STOP_RECORDING: {
          stopRecording()
            .then(sendResponse)
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_LIST_FLOWS: {
          listFlows()
            .then((flows) => sendResponse({ success: true, flows }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_GET_FLOW: {
          getFlow(message.flowId)
            .then((flow) => sendResponse({ success: !!flow, flow }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_DELETE_FLOW: {
          deleteFlow(message.flowId)
            .then(() => sendResponse({ success: true }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_PUBLISH_FLOW: {
          getFlow(message.flowId)
            .then(async (flow) => {
              if (!flow) return sendResponse({ success: false, error: 'flow not found' });
              await publishFlow(flow, message.slug);
              sendResponse({ success: true });
            })
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_UNPUBLISH_FLOW: {
          unpublishFlow(message.flowId)
            .then(() => sendResponse({ success: true }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_RUN_FLOW: {
          getFlow(message.flowId)
            .then(async (flow) => {
              if (!flow) return sendResponse({ success: false, error: 'flow not found' });
              const result = await runFlow(flow, message.options || {});
              sendResponse({ success: true, result });
            })
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_SAVE_FLOW: {
          const flow = message.flow as Flow;
          if (!flow || !flow.id) {
            sendResponse({ success: false, error: 'invalid flow' });
            return true;
          }
          saveFlow(flow)
            .then(() => sendResponse({ success: true }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_EXPORT_FLOW: {
          exportFlow(message.flowId)
            .then((json) => sendResponse({ success: true, json }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_EXPORT_ALL: {
          exportAllFlows()
            .then((json) => sendResponse({ success: true, json }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
        case BACKGROUND_MESSAGE_TYPES.RR_IMPORT_FLOW: {
          importFlowFromJson(message.json)
            .then((flows) => sendResponse({ success: true, imported: flows.length }))
            .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
          return true;
        }
      }
    } catch (err) {
      sendResponse({ success: false, error: (err as any)?.message || String(err) });
    }
    return false;
  });
}
