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

export {
  createCommandsProvider,
  type CommandsSearchResultData,
  type QuickPanelCommandId,
} from './commands-provider';
