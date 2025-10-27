import { TOOL_NAMES } from 'chrome-mcp-shared';
import { handleCallTool } from '@/entrypoints/background/tools';
import type { StepKey } from '../types';
import { expandTemplatesDeep } from '../rr-utils';
import type { ExecCtx, ExecResult, NodeRuntime } from './types';

export const keyNode: NodeRuntime<StepKey> = {
  run: async (_ctx, step: StepKey) => {
    const s = expandTemplatesDeep(step as StepKey, {});
    const res = await handleCallTool({
      name: TOOL_NAMES.BROWSER.KEYBOARD,
      args: { keys: (s as StepKey).keys },
    });
    if ((res as any).isError) throw new Error('key failed');
    return {} as ExecResult;
  },
};
