/**
 * Record-Replay Tools for MCP
 *
 * These tools use V3 runtime directly since they run in the background context.
 * For RPC-based access from UI, use rr_v3.* methods.
 */

import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { bootstrapV3 } from '../record-replay-v3/bootstrap';
import { enqueueRun } from '../record-replay-v3/engine/queue/enqueue-run';

class FlowRunTool {
  name = TOOL_NAMES.RECORD_REPLAY.FLOW_RUN;
  async execute(args: any): Promise<ToolResult> {
    const { flowId, args: vars, startNodeId } = args || {};
    if (!flowId) return createErrorResponse('flowId is required');

    try {
      // Ensure V3 runtime is initialized
      const runtime = await bootstrapV3();

      // Use shared enqueueRun service (same as RPC)
      const result = await enqueueRun(
        {
          storage: runtime.storage,
          events: runtime.events,
          scheduler: runtime.scheduler,
        },
        {
          flowId,
          args: vars,
          startNodeId,
        },
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              runId: result.runId,
              position: result.position,
              message: 'Flow enqueued for execution. Use rr_v3 events to monitor progress.',
            }),
          },
        ],
        isError: false,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return createErrorResponse(`Failed to enqueue flow: ${errorMsg}`);
    }
  }
}

class ListPublishedTool {
  name = TOOL_NAMES.RECORD_REPLAY.LIST_PUBLISHED;
  async execute(): Promise<ToolResult> {
    try {
      // Ensure V3 runtime is initialized
      const runtime = await bootstrapV3();

      // V3 doesn't have a separate "published" concept
      // Return all flows; caller can filter by meta.tool if needed
      const flows = await runtime.storage.flows.list();
      const published = flows.map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        meta: f.meta,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, published }),
          },
        ],
        isError: false,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return createErrorResponse(`Failed to list flows: ${errorMsg}`);
    }
  }
}

export const flowRunTool = new FlowRunTool();
export const listPublishedFlowsTool = new ListPublishedTool();
