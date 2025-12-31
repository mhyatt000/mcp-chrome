/**
 * Quick Panel UI Module Index
 *
 * Exports all UI components for the Quick Panel feature.
 */

// ============================================================
// Shell (unified container for search + chat views)
// ============================================================

export {
  mountQuickPanelShell,
  type QuickPanelShellElements,
  type QuickPanelShellManager,
  type QuickPanelShellOptions,
} from './panel-shell';

// ============================================================
// Shadow DOM host
// ============================================================

export {
  mountQuickPanelShadowHost,
  type QuickPanelShadowHostElements,
  type QuickPanelShadowHostManager,
  type QuickPanelShadowHostOptions,
} from './shadow-host';

// ============================================================
// Search UI Components
// ============================================================

export {
  createSearchInput,
  type SearchInputManager,
  type SearchInputOptions,
  type SearchInputState,
} from './search-input';

export {
  createQuickEntries,
  type QuickEntriesManager,
  type QuickEntriesOptions,
} from './quick-entries';

export {
  mountQuickPanelSearchView,
  type QuickPanelSearchViewManager,
  type QuickPanelSearchViewMountPoints,
  type QuickPanelSearchViewOptions,
  type QuickPanelSearchViewState,
} from './search-view';

export {
  createActionPanel,
  type ActionPanelManager,
  type ActionPanelOptions,
} from './action-panel';

// ============================================================
// AI Chat Components
// ============================================================

export {
  createQuickPanelMessageRenderer,
  type QuickPanelMessageRenderer,
  type QuickPanelMessageRendererOptions,
} from './message-renderer';

export { createMarkdownRenderer, type MarkdownRendererInstance } from './markdown-renderer';

export {
  mountQuickPanelAiChatPanel,
  type QuickPanelAiChatPanelManager,
  type QuickPanelAiChatPanelOptions,
  type QuickPanelAiChatPanelState,
} from './ai-chat-panel';

export {
  mountQuickPanelAiChatView,
  type QuickPanelAiChatViewManager,
  type QuickPanelAiChatViewMountPoints,
  type QuickPanelAiChatViewOptions,
  type QuickPanelAiChatViewState,
} from './ai-chat-view';

// ============================================================
// Styles
// ============================================================

export { QUICK_PANEL_STYLES } from './styles';
