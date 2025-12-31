/**
 * Quick Panel Entry Point
 *
 * This module provides the main controller for Quick Panel functionality.
 * It orchestrates:
 * - Shadow DOM host management
 * - Panel Shell (unified container for search/chat views)
 * - AI Chat view lifecycle
 * - Agent bridge communication
 * - View switching (search <-> chat)
 * - Keyboard shortcut handling (external)
 *
 * **Architecture (v2):**
 * The controller now uses Shell as the unified container:
 * - Shell provides overlay/panel/header/content/footer structure
 * - Search view (default) shows search input + results
 * - Chat view shows AI assistant interface
 * - Views can be switched via `setView()` or keyboard shortcuts
 *
 * Usage in content script:
 * ```typescript
 * import { createQuickPanelController } from './quick-panel';
 *
 * const controller = createQuickPanelController();
 *
 * // Show panel (default: search view)
 * controller.show();
 *
 * // Show panel with specific view
 * controller.show('chat');
 *
 * // Switch view while panel is open
 * controller.setView('chat');
 *
 * // Hide panel
 * controller.hide();
 *
 * // Toggle visibility
 * controller.toggle();
 *
 * // Cleanup on unload
 * controller.dispose();
 * ```
 */

import { createAgentBridge, type QuickPanelAgentBridge } from './core/agent-bridge';
import {
  createKeyboardController,
  type KeyboardControllerManager,
} from './core/keyboard-controller';
import { HistoryTracker } from './core/history-tracker';
import { SearchEngine } from './core/search-engine';
import type { QuickPanelView, SearchProvider, SearchResult } from './core/types';
import { computeUsageKey } from './core/usage-key';
import {
  createBookmarksProvider,
  createCommandsProvider,
  createHistoryProvider,
  createTabsProvider,
} from './providers';
import {
  mountQuickPanelShadowHost,
  mountQuickPanelShell,
  mountQuickPanelAiChatView,
  mountQuickPanelSearchView,
  type QuickPanelShadowHostManager,
  type QuickPanelShellManager,
  type QuickPanelAiChatViewManager,
  type QuickPanelSearchViewManager,
} from './ui';

// ============================================================
// Types
// ============================================================

export interface QuickPanelControllerOptions {
  /** Custom host element ID for Shadow DOM. Default: '__mcp_quick_panel_host__' */
  hostId?: string;
  /** Custom z-index for overlay. Default: 2147483647 (highest possible) */
  zIndex?: number;
  /** Default view when opening panel. Default: 'search' */
  defaultView?: QuickPanelView;

  // AI Chat options (new naming convention)
  /** AI Chat panel title. Default: 'Agent' */
  chatTitle?: string;
  /** AI Chat panel subtitle. Default: 'Quick Panel' */
  chatSubtitle?: string;
  /** AI Chat input placeholder. Default: 'Ask the agent...' */
  chatPlaceholder?: string;

  // Backward-compatible aliases for AI Chat options
  /** @deprecated Use chatTitle instead */
  title?: string;
  /** @deprecated Use chatSubtitle instead */
  subtitle?: string;
  /** @deprecated Use chatPlaceholder instead */
  placeholder?: string;
}

export interface QuickPanelController {
  /** Show the Quick Panel (creates if not exists). Optionally specify view. */
  show: (view?: QuickPanelView) => void;
  /** Hide the Quick Panel (disposes UI but keeps bridge alive) */
  hide: () => void;
  /** Toggle Quick Panel visibility */
  toggle: () => void;
  /** Check if panel is currently visible */
  isVisible: () => boolean;
  /** Get current view ('search' | 'chat') */
  getView: () => QuickPanelView | null;
  /** Switch to a different view */
  setView: (view: QuickPanelView) => void;
  /** Fully dispose all resources */
  dispose: () => void;
}

// ============================================================
// Constants
// ============================================================

const LOG_PREFIX = '[QuickPanelController]';
const DEFAULT_VIEW: QuickPanelView = 'search';

// ============================================================
// Main Factory
// ============================================================

/**
 * Create a Quick Panel controller instance.
 *
 * The controller manages the full lifecycle of the Quick Panel UI,
 * including Shadow DOM isolation, Shell container, search/chat views,
 * and background communication.
 *
 * @example
 * ```typescript
 * // In content script
 * const quickPanel = createQuickPanelController();
 *
 * // Listen for keyboard shortcut (e.g., Cmd+Shift+U)
 * document.addEventListener('keydown', (e) => {
 *   if (e.metaKey && e.shiftKey && e.key === 'u') {
 *     e.preventDefault();
 *     quickPanel.toggle();
 *   }
 * });
 *
 * // Cleanup on extension unload
 * window.addEventListener('unload', () => {
 *   quickPanel.dispose();
 * });
 * ```
 */
export function createQuickPanelController(
  options: QuickPanelControllerOptions = {},
): QuickPanelController {
  let disposed = false;

  // Shared agent bridge (persists across show/hide cycles)
  let agentBridge: QuickPanelAgentBridge | null = null;

  // UI components (created on show, disposed on hide)
  let shadowHost: QuickPanelShadowHostManager | null = null;
  let shell: QuickPanelShellManager | null = null;
  let chatView: QuickPanelAiChatViewManager | null = null;
  let searchView: QuickPanelSearchViewManager | null = null;
  let keyboardController: KeyboardControllerManager | null = null;

  // Search engine (persists across show/hide cycles)
  let searchEngine: SearchEngine | null = null;

  // Usage tracking (persists across show/hide cycles)
  let historyTracker: HistoryTracker | null = null;

  // Current view state
  let currentView: QuickPanelView | null = null;

  /**
   * Ensure agent bridge is initialized
   */
  function ensureBridge(): QuickPanelAgentBridge {
    if (!agentBridge || agentBridge.isDisposed()) {
      agentBridge = createAgentBridge();
    }
    return agentBridge;
  }

  /**
   * Ensure history tracker is initialized
   */
  function ensureHistoryTracker(): HistoryTracker {
    if (!historyTracker) {
      historyTracker = new HistoryTracker();
    }
    return historyTracker;
  }

  /**
   * Ensure search engine is initialized with providers
   */
  function ensureSearchEngine(): SearchEngine {
    if (!searchEngine) {
      searchEngine = new SearchEngine({
        debounceMs: 100,
        perProviderLimit: 10,
        totalLimit: 20,
      });

      // Register all providers
      // Type assertion needed because SearchProvider<TData> is invariant in TData position
      searchEngine.registerProvider(createTabsProvider() as SearchProvider);
      searchEngine.registerProvider(createBookmarksProvider() as SearchProvider);
      searchEngine.registerProvider(createHistoryProvider() as SearchProvider);
      searchEngine.registerProvider(createCommandsProvider() as SearchProvider);
    }
    return searchEngine;
  }

  /**
   * Dispose current UI (keeps bridge alive for potential reuse)
   */
  function disposeUI(): void {
    // Disable and dispose keyboard controller first
    if (keyboardController) {
      try {
        keyboardController.dispose();
      } catch {
        // Best-effort cleanup
      }
      keyboardController = null;
    }

    // Dispose search view (mounted inside shell)
    if (searchView) {
      try {
        searchView.dispose();
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error disposing search view:`, err);
      }
      searchView = null;
    }

    // Dispose chat view (mounted inside shell)
    if (chatView) {
      try {
        chatView.dispose();
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error disposing chat view:`, err);
      }
      chatView = null;
    }

    // Dispose shell
    if (shell) {
      try {
        shell.dispose();
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error disposing shell:`, err);
      }
      shell = null;
    }

    // Dispose shadow host last
    if (shadowHost) {
      try {
        shadowHost.dispose();
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error disposing shadow host:`, err);
      }
      shadowHost = null;
    }

    currentView = null;
  }

  /**
   * Handle view change event from Shell
   */
  function handleViewChange(view: QuickPanelView): void {
    currentView = view;

    // Handle scroll position on view switch
    const shellElements = shell?.getElements();
    if (!shellElements) return;

    if (view === 'chat' && chatView?.hasMessages()) {
      // Scroll to bottom when switching to chat with messages
      chatView.scrollToBottom();
    } else {
      // Reset scroll position for search view or empty chat
      shellElements.content.scrollTop = 0;
    }

    // Focus appropriate input after view switch
    if (view === 'chat') {
      chatView?.focusInput();
    } else if (view === 'search') {
      searchView?.focusInput();
    }
  }

  /**
   * Record usage for a search result (best-effort, fire-and-forget)
   */
  function recordResultUsage(result: SearchResult): void {
    const usageKey = computeUsageKey(result);
    if (usageKey) {
      const tracker = ensureHistoryTracker();
      void tracker.recordUsage(usageKey).catch(() => {
        // Best-effort: silently ignore tracking errors
      });
    }
  }

  /**
   * Handle result selection from search view
   */
  function handleResultSelect(result: SearchResult): void {
    if (disposed) return;

    // Look up the provider to get actions
    const engine = searchEngine;
    if (!engine) {
      console.warn(`${LOG_PREFIX} No search engine available`);
      hide();
      return;
    }

    // Find the provider that owns this result
    const providers = engine.listProviders();
    const provider = providers.find((p) => p.id === result.provider);
    if (!provider) {
      console.warn(`${LOG_PREFIX} Provider not found for result:`, result.provider);
      hide();
      return;
    }

    // Get actions from the provider
    const actions = provider.getActions(result);
    if (actions && actions.length > 0) {
      const defaultAction = actions[0];
      try {
        // Execute with proper context
        void Promise.resolve(defaultAction.execute({ result })).catch((err) => {
          console.warn(`${LOG_PREFIX} Error executing action:`, err);
        });
        // Record usage after successful execution initiation
        recordResultUsage(result);
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error executing action:`, err);
      }
    }

    // Hide panel after action
    hide();
  }

  /**
   * Mount Search View into Shell's search mount points
   */
  function mountSearchView(): void {
    if (searchView) return; // Already mounted

    const shellElements = shell?.getElements();
    if (!shellElements) {
      console.error(`${LOG_PREFIX} Cannot mount search view - shell elements not available`);
      return;
    }

    const engine = ensureSearchEngine();

    searchView = mountQuickPanelSearchView({
      mountPoints: {
        header: shellElements.headerSearchMount,
        headerRight: shellElements.headerRightSearchMount,
        content: shellElements.contentSearchMount,
        footer: shellElements.footerSearchMount,
        scrollContainer: shellElements.content,
      },
      searchEngine: engine,
      historyTracker: ensureHistoryTracker(),
      placeholder: 'Search tabs, bookmarks, commands...',
      autoFocus: false, // We'll focus after view is set
      availableScopes: ['all', 'tabs', 'bookmarks', 'history', 'commands'],
      onResultSelect: handleResultSelect,
      onAiSelect: () => {
        // Switch to chat view when AI entry is selected
        setView('chat');
      },
      onGetActions: (result) => {
        // Look up the provider to get actions
        if (!searchEngine) return [];

        const providers = searchEngine.listProviders();
        const provider = providers.find((p) => p.id === result.provider);
        if (!provider) return [];

        return provider.getActions(result) ?? [];
      },
      onActionExecute: (_action, result) => {
        // Record usage after action execution
        recordResultUsage(result);
        // Hide panel after action execution
        hide();
      },
    });
  }

  /**
   * Mount AI Chat View into Shell's chat mount points
   */
  function mountChatView(): void {
    if (chatView) return; // Already mounted

    const shellElements = shell?.getElements();
    if (!shellElements) {
      console.error(`${LOG_PREFIX} Cannot mount chat view - shell elements not available`);
      return;
    }

    const bridge = ensureBridge();

    // Resolve options with backward-compatible aliases
    const resolvedTitle = options.chatTitle ?? options.title;
    const resolvedSubtitle = options.chatSubtitle ?? options.subtitle;
    const resolvedPlaceholder = options.chatPlaceholder ?? options.placeholder;

    chatView = mountQuickPanelAiChatView({
      mountPoints: {
        header: shellElements.headerChatMount,
        headerRight: shellElements.headerRightChatMount,
        content: shellElements.contentChatMount,
        footer: shellElements.footerChatMount,
        scrollContainer: shellElements.content,
      },
      agentBridge: bridge,
      title: resolvedTitle,
      subtitle: resolvedSubtitle,
      placeholder: resolvedPlaceholder,
      autoFocus: false, // We'll focus after view is set
    });
  }

  /**
   * Show the Quick Panel
   */
  function show(view?: QuickPanelView): void {
    if (disposed) {
      console.warn(`${LOG_PREFIX} Cannot show - controller is disposed`);
      return;
    }

    const targetView = view ?? options.defaultView ?? DEFAULT_VIEW;

    // Already visible - just switch view if needed
    if (shell && shadowHost?.getElements()) {
      if (targetView !== currentView) {
        setView(targetView);
      }
      // Focus appropriate input
      if (targetView === 'chat') {
        chatView?.focusInput();
      } else if (targetView === 'search') {
        searchView?.focusInput();
      }
      return;
    }

    // Clean up any stale UI
    disposeUI();

    // Create shadow host
    shadowHost = mountQuickPanelShadowHost({
      hostId: options.hostId,
      zIndex: options.zIndex,
    });

    const hostElements = shadowHost.getElements();
    if (!hostElements) {
      console.error(`${LOG_PREFIX} Failed to create shadow host elements`);
      disposeUI();
      return;
    }

    // Create shell (unified container)
    shell = mountQuickPanelShell({
      mount: hostElements.root,
      defaultView: targetView,
      ariaLabel: 'Quick Panel',
      closeOnBackdropClick: true,
      onRequestClose: () => hide(),
      onViewChange: handleViewChange,
    });

    const shellElements = shell.getElements();
    if (!shellElements) {
      console.error(`${LOG_PREFIX} Failed to create shell elements`);
      disposeUI();
      return;
    }

    // Mount both views (always mount for instant switching)
    mountSearchView();
    mountChatView();

    // Set initial view state
    currentView = targetView;

    // Setup keyboard controller for navigation
    keyboardController = createKeyboardController({
      shadowRoot: hostElements.shadowRoot,
      getCurrentView: () => currentView ?? 'search',
      isInputEmpty: () => {
        const state = searchView?.getState();
        return !state?.query || state.query.trim().length === 0;
      },
      isActionPanelOpen: () => {
        return searchView?.isActionPanelOpen() ?? false;
      },
      onNavigateUp: () => {
        if (currentView === 'search') {
          searchView?.selectPrev();
        }
      },
      onNavigateDown: () => {
        if (currentView === 'search') {
          searchView?.selectNext();
        }
      },
      onSelect: () => {
        if (currentView === 'search') {
          searchView?.executeSelected();
        }
      },
      onSelectInNewTab: () => {
        // TODO: Implement open in new tab action
        // For now, just execute the default action
        if (currentView === 'search') {
          searchView?.executeSelected();
        }
      },
      onOpenActionPanel: () => {
        // Tab/ArrowRight key behavior:
        // - In search view with valid selection: open action panel
        // - For AI entry: switch to chat view
        if (currentView === 'search') {
          searchView?.openActionPanel();
        }
      },
      onCloseActionPanel: () => {
        if (currentView === 'search') {
          searchView?.closeActionPanel();
        }
      },
      onActionPanelNavigateUp: () => {
        if (currentView === 'search') {
          searchView?.actionPanelSelectPrev();
        }
      },
      onActionPanelNavigateDown: () => {
        if (currentView === 'search') {
          searchView?.actionPanelSelectNext();
        }
      },
      onActionPanelSelect: () => {
        if (currentView === 'search') {
          searchView?.actionPanelExecuteSelected();
        }
      },
      onBack: () => {
        // Backspace when input empty: go back to previous view or clear
        if (currentView === 'chat') {
          setView('search');
        }
        // In search view with empty input, could close panel or do nothing
      },
      onClose: () => {
        hide();
      },
      onViewSwitch: (view) => {
        setView(view);
      },
    });
    keyboardController.enable();

    // Focus appropriate input based on view
    if (targetView === 'chat') {
      chatView?.focusInput();
    } else if (targetView === 'search') {
      searchView?.focusInput();
    }
  }

  /**
   * Hide the Quick Panel
   */
  function hide(): void {
    if (disposed) return;
    disposeUI();
  }

  /**
   * Toggle Quick Panel visibility
   */
  function toggle(): void {
    if (disposed) return;

    if (isVisible()) {
      hide();
    } else {
      show();
    }
  }

  /**
   * Check if panel is currently visible
   */
  function isVisible(): boolean {
    // Both shell and shadowHost must exist and have valid elements
    return shell !== null && shadowHost !== null && shadowHost.getElements() !== null;
  }

  /**
   * Get current view
   */
  function getView(): QuickPanelView | null {
    return currentView;
  }

  /**
   * Switch to a different view
   */
  function setView(view: QuickPanelView): void {
    if (disposed || !shell) return;

    // Validate view
    if (view !== 'search' && view !== 'chat') {
      console.warn(`${LOG_PREFIX} Invalid view: ${view}`);
      return;
    }

    shell.setView(view);
    // handleViewChange will be called by Shell's callback
  }

  /**
   * Fully dispose all resources
   */
  function dispose(): void {
    if (disposed) return;
    disposed = true;

    disposeUI();

    if (searchEngine) {
      try {
        searchEngine.dispose();
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error disposing search engine:`, err);
      }
      searchEngine = null;
    }

    if (agentBridge) {
      try {
        agentBridge.dispose();
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error disposing agent bridge:`, err);
      }
      agentBridge = null;
    }
  }

  return {
    show,
    hide,
    toggle,
    isVisible,
    getView,
    setView,
    dispose,
  };
}

// ============================================================
// Re-exports for convenience
// ============================================================

// Core types
export {
  DEFAULT_SCOPE,
  QUICK_PANEL_SCOPES,
  normalizeQuickPanelScope,
  parseScopePrefixedQuery,
  normalizeSearchQuery,
} from './core/types';

export type {
  QuickPanelScope,
  QuickPanelScopeDefinition,
  QuickPanelView,
  ParsedScopeQuery,
  QuickPanelIcon,
  SearchResult,
  ActionTone,
  ActionContext,
  Action,
  SearchQuery,
  SearchProviderContext,
  SearchProvider,
  QuickPanelState,
} from './core/types';

// Agent bridge
export { createAgentBridge } from './core/agent-bridge';
export type {
  QuickPanelAgentBridge,
  RequestEventListener,
  AgentBridgeOptions,
} from './core/agent-bridge';

// UI Components
export {
  // Shadow host
  mountQuickPanelShadowHost,
  // Panel shell (unified container)
  mountQuickPanelShell,
  // AI Chat (standalone wrapper for backward compatibility)
  mountQuickPanelAiChatPanel,
  // AI Chat View (embeddable)
  mountQuickPanelAiChatView,
  // Search View (embeddable)
  mountQuickPanelSearchView,
  // Message renderer
  createQuickPanelMessageRenderer,
  // Search UI
  createSearchInput,
  createQuickEntries,
  // Styles
  QUICK_PANEL_STYLES,
} from './ui';

export type {
  // Shadow host
  QuickPanelShadowHostElements,
  QuickPanelShadowHostManager,
  QuickPanelShadowHostOptions,
  // Panel shell
  QuickPanelShellElements,
  QuickPanelShellManager,
  QuickPanelShellOptions,
  // AI Chat Panel (standalone wrapper)
  QuickPanelAiChatPanelManager,
  QuickPanelAiChatPanelOptions,
  QuickPanelAiChatPanelState,
  // AI Chat View (embeddable)
  QuickPanelAiChatViewManager,
  QuickPanelAiChatViewMountPoints,
  QuickPanelAiChatViewOptions,
  QuickPanelAiChatViewState,
  // Search View (embeddable)
  QuickPanelSearchViewManager,
  QuickPanelSearchViewMountPoints,
  QuickPanelSearchViewOptions,
  QuickPanelSearchViewState,
  // Message renderer
  QuickPanelMessageRenderer,
  QuickPanelMessageRendererOptions,
  // Search input
  SearchInputManager,
  SearchInputOptions,
  SearchInputState,
  // Quick entries
  QuickEntriesManager,
  QuickEntriesOptions,
} from './ui';

// Search Engine
export { SearchEngine } from './core/search-engine';
export type {
  SearchEngineOptions,
  SearchEngineRequest,
  SearchEngineResponse,
  SearchProviderError,
} from './core/search-engine';

// Search Providers
export { createTabsProvider } from './providers';
export type { TabsProviderOptions, TabsSearchResultData } from './providers';

// Keyboard Controller
export { createKeyboardController } from './core/keyboard-controller';
export type {
  KeyboardControllerOptions,
  KeyboardControllerManager,
} from './core/keyboard-controller';

// History Tracker (Usage tracking for frecency)
export { HistoryTracker } from './core/history-tracker';
export type {
  UsageEntry,
  UsageSignal,
  RecentItem,
  HistoryTrackerOptions,
} from './core/history-tracker';

// Usage Key Utilities
export {
  normalizeUrlForUsage,
  computeUsageKey,
  parseUsageKey,
  isUrlKey,
  isCommandKey,
} from './core/usage-key';
export type { ParsedUsageKey } from './core/usage-key';
