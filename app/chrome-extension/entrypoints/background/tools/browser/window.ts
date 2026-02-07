import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

type WindowsAndTabsResult = {
  windowCount: number;
  tabCount: number;
  windows: Array<{ windowId: number; tabs: Array<{ tabId: number }> }>;
};

const parseWindowsAndTabsResult = async (): Promise<WindowsAndTabsResult | ToolResult> => {
  const result = await windowTool.execute();
  if (result.isError) return result;
  const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
  try {
    const parsed = JSON.parse(text) as WindowsAndTabsResult;
    if (!parsed || !Array.isArray(parsed.windows)) {
      return createErrorResponse('Invalid response from get_windows_and_tabs');
    }
    return parsed;
  } catch (error) {
    return createErrorResponse(
      `Failed to parse get_windows_and_tabs response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;
  async execute(): Promise<ToolResult> {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      let tabCount = 0;

      const structuredWindows = windows.map((window) => {
        const tabs =
          window.tabs?.map((tab) => {
            tabCount++;
            return {
              tabId: tab.id || 0,
              url: tab.url || '',
              title: tab.title || '',
              active: tab.active || false,
            };
          }) || [];

        return {
          windowId: window.id || 0,
          tabs: tabs,
        };
      });

      const result = {
        windowCount: windows.length,
        tabCount: tabCount,
        windows: structuredWindows,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in WindowTool.execute:', error);
      return createErrorResponse(
        `Error getting windows and tabs information: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class WindowIdsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOW_IDS;
  async execute(): Promise<ToolResult> {
    const parsed = await parseWindowsAndTabsResult();
    if ('isError' in parsed) return parsed;
    const windowIds = parsed.windows.map((window) => window.windowId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(windowIds),
        },
      ],
      isError: false,
    };
  }
}

class WindowTabCountsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.COUNT_WINDOWS_NUM_TABS;
  async execute(): Promise<ToolResult> {
    const parsed = await parseWindowsAndTabsResult();
    if ('isError' in parsed) return parsed;
    const counts: Record<string, number> = {};
    for (const window of parsed.windows) {
      counts[String(window.windowId)] = Array.isArray(window.tabs) ? window.tabs.length : 0;
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(counts),
        },
      ],
      isError: false,
    };
  }
}

class WindowTabsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOW_TABS;
  async execute(args: { windowId: number }): Promise<ToolResult> {
    if (!args || typeof args.windowId !== 'number') {
      return createErrorResponse('windowId is required and must be a number');
    }
    const parsed = await parseWindowsAndTabsResult();
    if ('isError' in parsed) return parsed;
    const match = parsed.windows.find((window) => window.windowId === args.windowId);
    if (!match) {
      return createErrorResponse(`Window not found: ${args.windowId}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(match.tabs || []),
        },
      ],
      isError: false,
    };
  }
}

export const windowTool = new WindowTool();
export const windowIdsTool = new WindowIdsTool();
export const windowTabCountsTool = new WindowTabCountsTool();
export const windowTabsTool = new WindowTabsTool();
