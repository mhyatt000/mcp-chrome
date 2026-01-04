import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';
import { assessToolRisk, getToolDescription } from './tool-risk';
import { requestToolApproval } from './tool-approval';
import {
  appendToolActionLogEntry,
  formatToolArgsSummary,
  formatToolResultSummary,
  type ToolCallSource,
} from './tool-action-log';

const tools = { ...browserTools, flowRunTool, listPublishedFlowsTool } as any;
const toolsMap = new Map(Object.values(tools).map((tool: any) => [tool.name, tool]));

/**
 * Tool call parameter interface
 */
export interface ToolCallParam {
  name: string;
  args: any;
}

export interface ToolCallContext {
  source?: ToolCallSource;
}

async function resolveIncognitoHint(args: any): Promise<boolean> {
  try {
    const tabId = typeof args?.tabId === 'number' ? args.tabId : null;
    if (tabId !== null) {
      const tab = await chrome.tabs.get(tabId);
      return tab.incognito === true;
    }

    const windowId = typeof args?.windowId === 'number' ? args.windowId : null;
    if (windowId !== null) {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      return tabs[0]?.incognito === true;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.incognito === true;
  } catch {
    return false;
  }
}

/**
 * Handle tool execution
 */
export const handleCallTool = async (param: ToolCallParam, ctx?: ToolCallContext) => {
  const source: ToolCallSource = ctx?.source ?? 'internal';
  const startedAt = Date.now();
  const toolName = String(param?.name ?? '').trim();
  const args = param?.args;
  const toolDescription = getToolDescription(toolName);
  const risk = assessToolRisk(toolName, args);
  const incognito = await resolveIncognitoHint(args);
  const argsSummary = formatToolArgsSummary(args);

  const tool = toolsMap.get(toolName);
  if (!tool) {
    const finishedAt = Date.now();
    await appendToolActionLogEntry({
      toolName,
      toolDescription,
      risk,
      source,
      incognito,
      status: 'error',
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      argsSummary,
      resultSummary: `Tool ${toolName} not found`,
    });
    return createErrorResponse(`Tool ${toolName} not found`);
  }

  // Agent Mode guard: require explicit user approval for risky tool calls initiated by the native host.
  if (source === 'native_host' && risk.requiresConfirmation) {
    const approval = await requestToolApproval({
      toolName,
      toolDescription,
      risk,
      argsSummary,
      tabId: typeof args?.tabId === 'number' ? args.tabId : undefined,
      windowId: typeof args?.windowId === 'number' ? args.windowId : undefined,
    });

    if (!approval.approved) {
      const finishedAt = Date.now();
      await appendToolActionLogEntry({
        toolName,
        toolDescription,
        risk,
        source,
        incognito,
        status: 'denied',
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        argsSummary,
        resultSummary: `Denied (${approval.reason})`,
      });
      return createErrorResponse('Tool call denied by user');
    }
  }

  try {
    const result = await tool.execute(args);
    const finishedAt = Date.now();

    await appendToolActionLogEntry({
      toolName,
      toolDescription,
      risk,
      source,
      incognito,
      status: result?.isError === true ? 'error' : 'success',
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      argsSummary,
      resultSummary: formatToolResultSummary(result),
    });

    return result;
  } catch (error) {
    console.error(`Tool execution failed for ${param.name}:`, error);
    const finishedAt = Date.now();
    const errorMessage =
      error instanceof Error
        ? error.message
        : error
          ? String(error)
          : ERROR_MESSAGES.TOOL_EXECUTION_FAILED;
    await appendToolActionLogEntry({
      toolName,
      toolDescription,
      risk,
      source,
      incognito,
      status: 'error',
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      argsSummary,
      resultSummary: `Error: ${errorMessage}`,
    });

    return createErrorResponse(errorMessage || ERROR_MESSAGES.TOOL_EXECUTION_FAILED);
  }
};
