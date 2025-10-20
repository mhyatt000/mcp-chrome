import type { Flow, Step } from '../types';
import { STEP_TYPES } from '@/common/step-types';

const WORKFLOW_VERSION = 1;

export function createInitialFlow(meta?: Partial<Flow>): Flow {
  const timeStamp = new Date().toISOString();
  const flow: Flow = {
    id: meta?.id || `flow_${Date.now()}`,
    name: meta?.name || 'new_workflow',
    version: WORKFLOW_VERSION,
    steps: [],
    variables: [],
    meta: {
      createdAt: timeStamp,
      updatedAt: timeStamp,
      ...meta?.meta,
    },
  };
  return flow;
}

export function generateStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function appendSteps(flow: Flow, steps: Step[]): void {
  for (const st of steps) {
    const step = st;
    if (!step.id) step.id = generateStepId();
    flow.steps.push(step);
  }
  try {
    const timeStamp = new Date().toISOString();
    if (flow.meta) {
      flow.meta.updatedAt = timeStamp;
    } else {
      flow = {
        ...flow,
        meta: {
          createdAt: timeStamp,
          updatedAt: timeStamp,
        },
      };
    }
  } catch {}
}

export function addNavigationStep(flow: Flow, url: string): void {
  const step = { id: generateStepId(), type: STEP_TYPES.NAVIGATE, url };
  appendSteps(flow, [step]);
}
