/**
 * Quick Panel Search View
 *
 * The search view container that coordinates:
 * - SearchInput: query input with scope selection
 * - QuickEntries: scope shortcut grid (shown when query is empty)
 * - ResultList: search results (shown when query has results)
 * - Footer: keyboard hints and status
 *
 * This view is designed to work within QuickPanelShell's search mount points.
 */

import { Disposer } from '@/entrypoints/web-editor-v2/utils/disposables';
import type { Action, QuickPanelScope, SearchResult } from '../core/types';
import { SearchEngine } from '../core/search-engine';
import type { HistoryTracker, RecentItem } from '../core/history-tracker';
import { computeUsageKey, parseUsageKey } from '../core/usage-key';
import { createSearchInput, type SearchInputManager, type SearchInputState } from './search-input';
import { createQuickEntries, type QuickEntriesManager } from './quick-entries';
import { createActionPanel, type ActionPanelManager } from './action-panel';

// ============================================================
// Types
// ============================================================

export interface QuickPanelSearchViewMountPoints {
  /** Mount point for header content (search input) */
  header: HTMLElement;
  /** Mount point for header right content (optional actions) */
  headerRight: HTMLElement;
  /** Mount point for main content (quick entries + results) */
  content: HTMLElement;
  /** Mount point for footer content (keyboard hints) */
  footer: HTMLElement;
  /** Scroll container for keyboard navigation */
  scrollContainer: HTMLElement;
}

export interface QuickPanelSearchViewOptions {
  /** Mount points provided by the Shell */
  mountPoints: QuickPanelSearchViewMountPoints;
  /** Search engine instance */
  searchEngine: SearchEngine;
  /** Usage tracker for recents and ranking. Optional for backward compatibility. */
  historyTracker?: HistoryTracker;

  /** Initial scope. Default: 'all' */
  initialScope?: QuickPanelScope;
  /** Input placeholder. Default: 'Search tabs, bookmarks, commands...' */
  placeholder?: string;
  /** Auto-focus input on mount. Default: true */
  autoFocus?: boolean;
  /** Available scopes for search. Default: ['all', 'tabs', 'commands'] */
  availableScopes?: readonly QuickPanelScope[];

  /** Called when a result is selected (clicked or Enter) */
  onResultSelect?: (result: SearchResult) => void;
  /** Called when AI Assistant entry is selected */
  onAiSelect?: () => void;
  /** Called when Tab is pressed on a result (opens action panel) */
  onResultAction?: (result: SearchResult) => void;
  /** Called to get actions for a result (for action panel) */
  onGetActions?: (result: SearchResult) => Action[];
  /** Called when an action is executed */
  onActionExecute?: (action: Action, result: SearchResult) => void;
}

export interface QuickPanelSearchViewState {
  scope: QuickPanelScope;
  query: string;
  results: SearchResult[];
  selectedIndex: number;
  loading: boolean;
  error: string | null;
  /** Whether the action panel is currently open */
  actionPanelOpen: boolean;
}

export interface QuickPanelSearchViewManager {
  getState: () => QuickPanelSearchViewState;
  focusInput: () => void;
  clearInput: () => void;
  setSelectedIndex: (index: number) => void;
  selectPrev: () => void;
  selectNext: () => void;
  executeSelected: () => void;
  /** Open action panel for current selection */
  openActionPanel: () => void;
  /** Close action panel */
  closeActionPanel: () => void;
  /** Check if action panel is open */
  isActionPanelOpen: () => boolean;
  /** Navigate action panel selection up */
  actionPanelSelectPrev: () => void;
  /** Navigate action panel selection down */
  actionPanelSelectNext: () => void;
  /** Execute selected action in action panel */
  actionPanelExecuteSelected: () => void;
  dispose: () => void;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_PLACEHOLDER = 'Search tabs, bookmarks, commands...';
const DEFAULT_SCOPES: QuickPanelScope[] = ['all', 'tabs', 'commands'];
const DEFAULT_RECENT_LIMIT = 20;

/** AI Assistant special entry ID */
const AI_ASSISTANT_ID = '__ai_assistant__';

// ============================================================
// AI Assistant Entry
// ============================================================

function createAiAssistantEntry(): SearchResult {
  return {
    id: AI_ASSISTANT_ID,
    provider: 'system',
    title: 'AI Assistant',
    subtitle: 'Chat with AI about this page',
    icon: '\u2728', // Sparkles emoji
    data: { type: 'ai-entry' },
    score: 0, // Will be boosted based on query
  };
}

// ============================================================
// Main Factory
// ============================================================

/**
 * Mount the Quick Panel Search View into provided mount points.
 *
 * @example
 * ```typescript
 * const searchView = mountQuickPanelSearchView({
 *   mountPoints: {
 *     header: shellElements.headerSearchMount,
 *     headerRight: shellElements.headerRightSearchMount,
 *     content: shellElements.contentSearchMount,
 *     footer: shellElements.footerSearchMount,
 *     scrollContainer: shellElements.content,
 *   },
 *   searchEngine,
 *   onResultSelect: (result) => executeResult(result),
 *   onAiSelect: () => shell.setView('chat'),
 * });
 * ```
 */
export function mountQuickPanelSearchView(
  options: QuickPanelSearchViewOptions,
): QuickPanelSearchViewManager {
  const disposer = new Disposer();

  const { mountPoints, searchEngine } = options;
  const availableScopes = options.availableScopes ?? DEFAULT_SCOPES;
  const historyTracker = options.historyTracker ?? null;

  let disposed = false;
  let recentSeq = 0; // Sequence counter for recent list requests

  // --------------------------------------------------------
  // State
  // --------------------------------------------------------

  let state: QuickPanelSearchViewState = {
    scope: options.initialScope ?? 'all',
    query: '',
    results: [],
    selectedIndex: -1,
    loading: false,
    error: null,
    actionPanelOpen: false,
  };

  // Track current result for action panel
  let actionPanelResult: SearchResult | null = null;

  // --------------------------------------------------------
  // DOM Setup - Content Container
  // --------------------------------------------------------

  const contentWrap = document.createElement('div');
  contentWrap.className = 'qp-search-content';
  mountPoints.content.append(contentWrap);
  disposer.add(() => contentWrap.remove());

  // Quick entries container
  const quickEntriesWrap = document.createElement('div');
  quickEntriesWrap.className = 'qp-quick-entries-wrap';
  contentWrap.append(quickEntriesWrap);

  // Results container
  const resultsWrap = document.createElement('div');
  resultsWrap.className = 'qp-results';
  resultsWrap.hidden = true;
  // Need position relative for action panel positioning
  resultsWrap.style.position = 'relative';
  contentWrap.append(resultsWrap);

  // --------------------------------------------------------
  // Action Panel
  // --------------------------------------------------------

  let actionPanel: ActionPanelManager | null = null;

  actionPanel = createActionPanel({
    container: resultsWrap,
    onExecute: handleActionExecute,
    onClose: closeActionPanel,
  });
  disposer.add(() => actionPanel?.dispose());

  // --------------------------------------------------------
  // Search Input
  // --------------------------------------------------------

  let searchInput: SearchInputManager | null = null;

  searchInput = createSearchInput({
    container: mountPoints.header,
    initialScope: state.scope,
    placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER,
    autoFocus: options.autoFocus !== false,
    availableScopes,
    onChange: handleSearchInputChange,
  });
  disposer.add(() => searchInput?.dispose());

  // --------------------------------------------------------
  // Quick Entries
  // --------------------------------------------------------

  let quickEntries: QuickEntriesManager | null = null;

  quickEntries = createQuickEntries({
    container: quickEntriesWrap,
    scopes: ['tabs', 'bookmarks', 'history', 'commands'],
    onSelect: (scope) => {
      searchInput?.setScope(scope);
      searchInput?.focus();
    },
  });
  disposer.add(() => quickEntries?.dispose());

  // Disable unavailable scopes initially
  if (!availableScopes.includes('bookmarks')) {
    quickEntries.setDisabled('bookmarks', true);
  }
  if (!availableScopes.includes('history')) {
    quickEntries.setDisabled('history', true);
  }

  // --------------------------------------------------------
  // Footer
  // --------------------------------------------------------

  const footer = document.createElement('div');
  footer.className = 'qp-search-footer';

  const hints = [
    { key: '\u2191\u2193', label: 'Navigate' },
    { key: '\u21b5', label: 'Select' },
    { key: 'Tab', label: 'Actions' },
    { key: 'Esc', label: 'Close' },
  ];

  for (const hint of hints) {
    const keyEl = document.createElement('span');
    keyEl.className = 'qp-kbd';
    keyEl.textContent = hint.key;

    const labelEl = document.createElement('span');
    labelEl.textContent = hint.label;

    footer.append(keyEl, labelEl);
  }

  mountPoints.footer.append(footer);
  disposer.add(() => footer.remove());

  // --------------------------------------------------------
  // Recent List Logic
  // --------------------------------------------------------

  /**
   * Build a scope filter for recent items.
   */
  function buildRecentScopeFilter(scope: QuickPanelScope): (key: string) => boolean {
    return (key) => {
      const parsed = parseUsageKey(key);
      if (!parsed) return false;

      if (scope === 'commands') return parsed.type === 'cmd';
      if (scope === 'all') return true; // All types
      // tabs, bookmarks, history -> URL based
      return parsed.type === 'url';
    };
  }

  /**
   * Format a URL for display in recent list.
   */
  function formatRecentUrl(url: string): { title: string; subtitle: string } {
    try {
      const u = new URL(url);
      const host = u.hostname || u.host || url;
      const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
      const title = `${host}${path}`;
      return { title: title || url, subtitle: u.toString() };
    } catch {
      return { title: url, subtitle: url };
    }
  }

  /**
   * Convert recent items to SearchResult format for rendering.
   */
  function recentItemsToResults(items: RecentItem[], scope: QuickPanelScope): SearchResult[] {
    const results: SearchResult[] = [];

    for (const item of items) {
      const parsed = parseUsageKey(item.key);
      if (!parsed) continue;

      if (parsed.type === 'cmd') {
        results.push({
          id: `recent:${item.key}`,
          provider: 'commands',
          title: parsed.value,
          subtitle: 'Command',
          icon: '>',
          data: { commandId: parsed.value },
          score: 0,
        });
        continue;
      }

      // URL-based: show as history item (generic)
      const { title, subtitle } = formatRecentUrl(parsed.value);
      results.push({
        id: `recent:${item.key}`,
        provider: 'history',
        title,
        subtitle,
        icon: '🕐',
        data: { historyId: item.key, url: parsed.value, title },
        score: 0,
      });
    }

    return results;
  }

  /**
   * Refresh and display the recent list (for empty query state).
   */
  async function refreshRecentList(scope: QuickPanelScope): Promise<void> {
    if (disposed) return;

    // Backward compatibility: no historyTracker means old behavior
    if (!historyTracker) {
      quickEntriesWrap.hidden = false;
      resultsWrap.hidden = true;
      state = { ...state, results: [], loading: false, error: null, selectedIndex: -1 };
      renderResults();
      return;
    }

    const seq = ++recentSeq;

    // Cancel any in-flight search
    searchEngine.cancelActive();
    state = { ...state, results: [], loading: true, error: null, selectedIndex: -1 };
    quickEntriesWrap.hidden = true;
    resultsWrap.hidden = false;
    renderResults();

    try {
      const scopeFilter = buildRecentScopeFilter(scope);
      const items = await historyTracker.getRecentList(DEFAULT_RECENT_LIMIT, scopeFilter);

      if (disposed) return;
      if (seq !== recentSeq) return; // Stale response
      if (state.query.trim().length > 0) return; // Query changed while loading

      if (items.length === 0) {
        // No recent items: fall back to quick entries
        quickEntriesWrap.hidden = false;
        resultsWrap.hidden = true;
        state = { ...state, results: [], loading: false, error: null, selectedIndex: -1 };
        renderResults();
        return;
      }

      const results = recentItemsToResults(items, scope);
      state = {
        ...state,
        results,
        loading: false,
        error: null,
        selectedIndex: results.length > 0 ? 0 : -1,
      };

      quickEntriesWrap.hidden = true;
      resultsWrap.hidden = false;
      renderResults();
    } catch (err) {
      if (disposed) return;
      if (seq !== recentSeq) return;

      // Fallback to quick entries on error
      quickEntriesWrap.hidden = false;
      resultsWrap.hidden = true;
      state = {
        ...state,
        results: [],
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        selectedIndex: -1,
      };
      renderResults();
    }
  }

  /**
   * Apply usage boost to search results for frecency ranking.
   * Best-effort: any failure returns unmodified results to preserve search UX.
   */
  async function applyUsageBoost(results: SearchResult[]): Promise<SearchResult[]> {
    if (!historyTracker) return results;
    if (results.length === 0) return results;

    try {
      // Compute usage keys for all results
      const keysByIndex = results.map((r) => computeUsageKey(r));
      const uniqueKeys = [
        ...new Set(keysByIndex.filter((k): k is string => typeof k === 'string' && k.length > 0)),
      ];

      if (uniqueKeys.length === 0) return results;

      const signals = await historyTracker.getSignals(uniqueKeys);
      if (signals.size === 0) return results;

      // Apply boost to scores
      const boosted = results.map((r, idx) => {
        const key = keysByIndex[idx];
        const signal = key ? signals.get(key) : undefined;
        if (!signal) return r;
        return { ...r, score: r.score + signal.boost };
      });

      // Re-sort by boosted score (stable sort preserving original order for ties)
      return boosted
        .map((r, idx) => ({ r, idx }))
        .sort((a, b) => {
          if (b.r.score !== a.r.score) return b.r.score - a.r.score;
          return a.idx - b.idx;
        })
        .map(({ r }) => r);
    } catch {
      // Best-effort: any failure returns unmodified results
      return results;
    }
  }

  // --------------------------------------------------------
  // Search Logic
  // --------------------------------------------------------

  function handleSearchInputChange(inputState: SearchInputState): void {
    if (disposed) return;

    state = {
      ...state,
      scope: inputState.scope,
      query: inputState.query,
      selectedIndex: -1, // Reset selection on new search
    };

    const hasQuery = inputState.query.trim().length > 0;

    if (hasQuery) {
      // Show search results
      quickEntriesWrap.hidden = true;
      resultsWrap.hidden = false;
      void performSearch(inputState.scope, inputState.query);
    } else {
      // Show recent list (or quick entries if no tracker)
      void refreshRecentList(inputState.scope);
    }
  }

  async function performSearch(scope: QuickPanelScope, query: string): Promise<void> {
    if (disposed) return;

    const requestScope = scope;
    const requestQuery = query;

    // Clear previous results to prevent stale execution while loading
    state = { ...state, results: [], loading: true, error: null, selectedIndex: -1 };
    renderResults(); // Show loading state immediately

    try {
      const response = await searchEngine.schedule({ scope, query });

      if (disposed) return;
      if (response.cancelled) return; // Ignore cancelled responses
      // Check if state changed while waiting (staleness check)
      if (state.scope !== requestScope || state.query !== requestQuery) return;

      // Inject AI assistant entry
      let results = injectAiEntry(response.results, query);

      // Apply usage boost for frecency ranking
      results = await applyUsageBoost(results);

      // Re-check staleness after async boost to prevent race conditions
      if (disposed) return;
      if (state.scope !== requestScope || state.query !== requestQuery) return;

      state = {
        ...state,
        results,
        loading: false,
        selectedIndex: results.length > 0 ? 0 : -1, // Auto-select first
      };

      renderResults();
    } catch (err) {
      if (disposed) return;

      state = {
        ...state,
        results: [],
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        selectedIndex: -1,
      };

      renderResults();
    }
  }

  function injectAiEntry(results: SearchResult[], query: string): SearchResult[] {
    // Show AI entry when:
    // 1. Query is empty (but we're searching for something)
    // 2. Query contains "ai"
    const queryLower = query.toLowerCase().trim();
    const shouldShowAi = queryLower === '' || queryLower.includes('ai');

    if (!shouldShowAi) {
      return results;
    }

    const aiEntry = createAiAssistantEntry();
    // Boost score if query matches "ai"
    aiEntry.score = queryLower.includes('ai') ? 100 : 50;

    // Insert at appropriate position based on score
    const insertIndex = results.findIndex((r) => r.score < aiEntry.score);
    if (insertIndex === -1) {
      return [...results, aiEntry];
    }
    return [...results.slice(0, insertIndex), aiEntry, ...results.slice(insertIndex)];
  }

  // --------------------------------------------------------
  // Results Rendering
  // --------------------------------------------------------

  function renderResults(): void {
    if (disposed) return;

    // Clear existing results
    resultsWrap.innerHTML = '';

    if (state.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'qp-results-error';
      errorEl.textContent = state.error;
      resultsWrap.append(errorEl);
      return;
    }

    if (state.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'qp-results-loading';
      loadingEl.textContent = state.query.trim().length > 0 ? 'Searching...' : 'Loading recent...';
      resultsWrap.append(loadingEl);
      return;
    }

    if (state.results.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'qp-results-empty';
      emptyEl.textContent = state.query.trim().length > 0 ? 'No results found' : 'No recent items';
      resultsWrap.append(emptyEl);
      return;
    }

    // Render result items
    for (let i = 0; i < state.results.length; i++) {
      const result = state.results[i];
      const itemEl = renderResultItem(result, i === state.selectedIndex);
      resultsWrap.append(itemEl);
    }

    // Scroll selected item into view
    scrollSelectedIntoView();
  }

  function renderResultItem(result: SearchResult, isSelected: boolean): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'qp-result';
    item.dataset.resultId = result.id;
    item.dataset.selected = String(isSelected);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isSelected));

    // Icon - QuickPanelIcon is string | Node
    // Priority: 1. favIconUrl in data (for tabs), 2. Node icon, 3. String icon
    const iconEl = document.createElement('div');
    iconEl.className = 'qp-result-icon';

    let iconRendered = false;

    // Check for favIconUrl in data first (tabs have this)
    if (result.data && typeof result.data === 'object') {
      const data = result.data as Record<string, unknown>;
      if (typeof data.favIconUrl === 'string' && data.favIconUrl) {
        const img = document.createElement('img');
        img.src = data.favIconUrl;
        img.alt = '';
        img.className = 'qp-result-favicon';
        img.onerror = () => {
          // Replace with fallback on error
          img.remove();
          // Fall back to result.icon or default
          if (typeof result.icon === 'string') {
            iconEl.textContent = result.icon;
          } else {
            iconEl.textContent = '🌐';
          }
        };
        iconEl.append(img);
        iconRendered = true;
      }
    }

    // Fall back to result.icon if no favicon
    if (!iconRendered) {
      if (typeof result.icon === 'string') {
        // String icon (emoji or text)
        iconEl.textContent = result.icon;
      } else if (result.icon instanceof Node) {
        // DOM Node (e.g., img element, SVG)
        iconEl.append(result.icon.cloneNode(true));
      }
    }

    item.append(iconEl);

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'qp-result-content';

    const titleEl = document.createElement('div');
    titleEl.className = 'qp-result-title';
    titleEl.textContent = result.title || 'Untitled';
    contentEl.append(titleEl);

    if (result.subtitle) {
      const subtitleEl = document.createElement('div');
      subtitleEl.className = 'qp-result-subtitle';
      subtitleEl.textContent = result.subtitle;
      contentEl.append(subtitleEl);
    }
    item.append(contentEl);

    // Click handler
    item.addEventListener('click', () => {
      if (disposed) return;
      handleResultSelect(result);
    });

    return item;
  }

  function scrollSelectedIntoView(): void {
    if (state.selectedIndex < 0) return;

    const items = resultsWrap.querySelectorAll('.qp-result');
    const selectedItem = items[state.selectedIndex] as HTMLElement | undefined;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function updateSelection(newIndex: number): void {
    if (disposed) return;
    if (newIndex < 0 || newIndex >= state.results.length) return;

    const oldIndex = state.selectedIndex;
    state = { ...state, selectedIndex: newIndex };

    // Update DOM
    const items = resultsWrap.querySelectorAll('.qp-result');

    if (oldIndex >= 0 && items[oldIndex]) {
      const oldItem = items[oldIndex] as HTMLElement;
      oldItem.dataset.selected = 'false';
      oldItem.setAttribute('aria-selected', 'false');
    }

    if (newIndex >= 0 && items[newIndex]) {
      const newItem = items[newIndex] as HTMLElement;
      newItem.dataset.selected = 'true';
      newItem.setAttribute('aria-selected', 'true');
      newItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // --------------------------------------------------------
  // Result Selection
  // --------------------------------------------------------

  function handleResultSelect(result: SearchResult): void {
    if (disposed) return;

    // Check if it's the AI assistant entry
    if (result.id === AI_ASSISTANT_ID) {
      options.onAiSelect?.();
      return;
    }

    // Regular result
    options.onResultSelect?.(result);
  }

  // --------------------------------------------------------
  // Action Panel
  // --------------------------------------------------------

  function handleActionExecute(action: Action): void {
    if (disposed || !actionPanelResult) return;

    const result = actionPanelResult;

    // Close action panel first
    closeActionPanel();

    // Notify controller
    options.onActionExecute?.(action, result);

    // Execute the action
    try {
      void Promise.resolve(action.execute({ result })).catch((err) => {
        console.warn('[SearchView] Action execution error:', err);
      });
    } catch (err) {
      console.warn('[SearchView] Action execution error:', err);
    }
  }

  function openActionPanel(): void {
    if (disposed) return;
    if (state.selectedIndex < 0 || state.selectedIndex >= state.results.length) return;

    const result = state.results[state.selectedIndex];

    // Don't show action panel for AI assistant entry
    if (result.id === AI_ASSISTANT_ID) {
      options.onAiSelect?.();
      return;
    }

    // Get actions from callback
    const actions = options.onGetActions?.(result) ?? [];

    if (actions.length === 0) {
      // No actions available, notify via onResultAction callback
      options.onResultAction?.(result);
      return;
    }

    actionPanelResult = result;
    actionPanel?.show(result, actions);
    state = { ...state, actionPanelOpen: true };
  }

  function closeActionPanel(): void {
    if (disposed) return;

    actionPanel?.hide();
    actionPanelResult = null;
    state = { ...state, actionPanelOpen: false };
    searchInput?.focus();
  }

  function isActionPanelOpen(): boolean {
    return state.actionPanelOpen;
  }

  function actionPanelSelectPrev(): void {
    if (disposed || !state.actionPanelOpen) return;
    actionPanel?.selectPrev();
  }

  function actionPanelSelectNext(): void {
    if (disposed || !state.actionPanelOpen) return;
    actionPanel?.selectNext();
  }

  function actionPanelExecuteSelected(): void {
    if (disposed || !state.actionPanelOpen) return;
    actionPanel?.executeSelected();
  }

  // --------------------------------------------------------
  // Public API
  // --------------------------------------------------------

  function getState(): QuickPanelSearchViewState {
    return { ...state };
  }

  function focusInput(): void {
    if (disposed) return;
    searchInput?.focus();
  }

  function clearInput(): void {
    if (disposed) return;
    searchInput?.clear({ emit: true });
  }

  function setSelectedIndex(index: number): void {
    if (disposed) return;
    updateSelection(index);
  }

  function selectPrev(): void {
    if (disposed) return;
    if (state.results.length === 0) return;

    const newIndex = state.selectedIndex <= 0 ? state.results.length - 1 : state.selectedIndex - 1;
    updateSelection(newIndex);
  }

  function selectNext(): void {
    if (disposed) return;
    if (state.results.length === 0) return;

    const newIndex = state.selectedIndex >= state.results.length - 1 ? 0 : state.selectedIndex + 1;
    updateSelection(newIndex);
  }

  function executeSelected(): void {
    if (disposed) return;
    if (state.selectedIndex < 0 || state.selectedIndex >= state.results.length) return;

    const result = state.results[state.selectedIndex];
    handleResultSelect(result);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    searchEngine.cancelActive();
    disposer.dispose();
  }

  // Initial view: show recent list (if tracker available) or quick entries
  void refreshRecentList(state.scope);

  return {
    getState,
    focusInput,
    clearInput,
    setSelectedIndex,
    selectPrev,
    selectNext,
    executeSelected,
    openActionPanel,
    closeActionPanel,
    isActionPanelOpen,
    actionPanelSelectPrev,
    actionPanelSelectNext,
    actionPanelExecuteSelected,
    dispose,
  };
}
