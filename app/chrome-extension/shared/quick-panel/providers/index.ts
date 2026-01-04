/**
 * Quick Panel Search Providers
 *
 * Exports all search providers for Quick Panel.
 */

export {
  createTabsProvider,
  type TabsProviderOptions,
  type TabsSearchResultData,
} from './tabs-provider';

export { createBookmarksProvider, type BookmarksSearchResultData } from './bookmarks-provider';

export { createHistoryProvider, type HistorySearchResultData } from './history-provider';

export { createContentProvider, type ContentSearchResultData } from './content-provider';

export {
  createCommandsProvider,
  type CommandsSearchResultData,
  type QuickPanelCommandId,
} from './commands-provider';

export { createApiDetectiveProvider, type ApiDetectiveResultData } from './api-detective-provider';

export {
  createWebSearchProvider,
  type WebSearchResultData,
  type WebSearchScope,
} from './web-search-provider';

export { createWorkspacesProvider, type WorkspacesResultData } from './workspaces-provider';

export { createClipboardProvider, type ClipboardResultData } from './clipboard-provider';

export { createNotesProvider, type NotesResultData } from './notes-provider';

export { createFocusProvider, type FocusResultData } from './focus-provider';

export { createMonitorProvider, type MonitorResultData } from './monitor-provider';

export { createAuditProvider, type AuditResultData } from './audit-provider';
