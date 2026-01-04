/**
 * ExecuteFlow Action Handler
 *
 * Handles cross-flow execution by returning a control directive.
 * The actual flow execution is delegated to the V3 Runner.
 *
 * Key features:
 * - inline=true (default): Share variable store with caller
 * - inline=false: Clone variable store, isolate callee changes
 * - Cycle detection: Runner maintains flowId call stack
 * - Args resolution: Variable references in args are resolved before passing to target flow
 */

import { failed, invalid, ok, tryResolveJson } from '../registry';
import type { ActionHandler, ControlDirective, JsonObject, JsonValue } from '../types';

export const executeFlowHandler: ActionHandler<'executeFlow'> = {
  type: 'executeFlow',

  validate: (action) => {
    const params = action.params as {
      flowId?: unknown;
      args?: unknown;
      inline?: unknown;
    };

    if (!params.flowId || typeof params.flowId !== 'string') {
      return invalid('executeFlow requires a flowId (string)');
    }

    if (params.args !== undefined) {
      if (typeof params.args !== 'object' || params.args === null || Array.isArray(params.args)) {
        return invalid('executeFlow args must be a plain object (not null or array)');
      }
    }

    if (params.inline !== undefined && typeof params.inline !== 'boolean') {
      return invalid('executeFlow inline must be a boolean');
    }

    return ok();
  },

  describe: (action) => {
    const params = action.params as { flowId?: string; inline?: boolean };
    const mode = params.inline === false ? 'isolated' : 'inline';
    return `Execute flow "${params.flowId}" (${mode})`;
  },

  run: async (ctx, action) => {
    const params = action.params as {
      flowId: string;
      args?: Record<string, JsonValue>;
      inline?: boolean;
    };

    // Resolve args values (supports variable references like { ref: { name: 'varName' } })
    let resolvedArgs: JsonObject | undefined;
    if (params.args) {
      resolvedArgs = {};
      for (const [key, value] of Object.entries(params.args)) {
        const resolved = tryResolveJson(value, ctx.vars);
        if (!resolved.ok) {
          return failed('VALIDATION_ERROR', `Failed to resolve arg "${key}": ${resolved.error}`);
        }
        resolvedArgs[key] = resolved.value;
      }
    }

    // Return control directive for Runner to handle
    // The actual flow loading and execution is done by the V3 Runner
    const directive: ControlDirective = {
      kind: 'executeFlow',
      flowId: params.flowId,
      args: resolvedArgs,
      inline: params.inline,
    };

    return { status: 'success', control: directive };
  },
};
