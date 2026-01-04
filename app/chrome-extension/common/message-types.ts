/**
 * Consolidated message type constants for Chrome extension communication
 * Note: Native message types are imported from the shared package
 */

import type { RealtimeEvent } from 'chrome-mcp-shared';

// Message targets for routing
export enum MessageTarget {
  Offscreen = 'offscreen',
  ContentScript = 'content_script',
  Background = 'background',
}

// Background script message types
export const BACKGROUND_MESSAGE_TYPES = {
  SWITCH_SEMANTIC_MODEL: 'switch_semantic_model',
  GET_MODEL_STATUS: 'get_model_status',
  UPDATE_MODEL_STATUS: 'update_model_status',
  GET_STORAGE_STATS: 'get_storage_stats',
  CLEAR_ALL_DATA: 'clear_all_data',
  GET_SERVER_STATUS: 'get_server_status',
  REFRESH_SERVER_STATUS: 'refresh_server_status',
  SERVER_STATUS_CHANGED: 'server_status_changed',
  INITIALIZE_SEMANTIC_ENGINE: 'initialize_semantic_engine',
  // Record & Replay background control and queries
  RR_START_RECORDING: 'rr_start_recording',
  RR_STOP_RECORDING: 'rr_stop_recording',
  RR_PAUSE_RECORDING: 'rr_pause_recording',
  RR_RESUME_RECORDING: 'rr_resume_recording',
  RR_GET_RECORDING_STATUS: 'rr_get_recording_status',
  RR_LIST_FLOWS: 'rr_list_flows',
  RR_FLOWS_CHANGED: 'rr_flows_changed',
  RR_GET_FLOW: 'rr_get_flow',
  RR_DELETE_FLOW: 'rr_delete_flow',
  RR_PUBLISH_FLOW: 'rr_publish_flow',
  RR_UNPUBLISH_FLOW: 'rr_unpublish_flow',
  RR_RUN_FLOW: 'rr_run_flow',
  RR_SAVE_FLOW: 'rr_save_flow',
  RR_EXPORT_FLOW: 'rr_export_flow',
  RR_EXPORT_ALL: 'rr_export_all',
  RR_IMPORT_FLOW: 'rr_import_flow',
  RR_LIST_RUNS: 'rr_list_runs',
  // Triggers
  RR_LIST_TRIGGERS: 'rr_list_triggers',
  RR_SAVE_TRIGGER: 'rr_save_trigger',
  RR_DELETE_TRIGGER: 'rr_delete_trigger',
  RR_REFRESH_TRIGGERS: 'rr_refresh_triggers',
  // Scheduling
  RR_SCHEDULE_FLOW: 'rr_schedule_flow',
  RR_UNSCHEDULE_FLOW: 'rr_unschedule_flow',
  RR_LIST_SCHEDULES: 'rr_list_schedules',
  // Element marker management
  ELEMENT_MARKER_LIST_ALL: 'element_marker_list_all',
  ELEMENT_MARKER_LIST_FOR_URL: 'element_marker_list_for_url',
  ELEMENT_MARKER_SAVE: 'element_marker_save',
  ELEMENT_MARKER_UPDATE: 'element_marker_update',
  ELEMENT_MARKER_DELETE: 'element_marker_delete',
  ELEMENT_MARKER_VALIDATE: 'element_marker_validate',
  ELEMENT_MARKER_START: 'element_marker_start_from_popup',
  // Element picker (human-in-the-loop element selection)
  ELEMENT_PICKER_UI_EVENT: 'element_picker_ui_event',
  ELEMENT_PICKER_FRAME_EVENT: 'element_picker_frame_event',
  // Tool approval (human-in-the-loop confirmation for risky tool calls)
  TOOL_APPROVAL_UI_EVENT: 'tool_approval_ui_event',
  // Web editor (in-page visual editing)
  WEB_EDITOR_TOGGLE: 'web_editor_toggle',
  WEB_EDITOR_APPLY: 'web_editor_apply',
  WEB_EDITOR_STATUS_QUERY: 'web_editor_status_query',
  // Web editor <-> AgentChat integration (Phase 1.1)
  WEB_EDITOR_APPLY_BATCH: 'web_editor_apply_batch',
  WEB_EDITOR_TX_CHANGED: 'web_editor_tx_changed',
  WEB_EDITOR_HIGHLIGHT_ELEMENT: 'web_editor_highlight_element',
  // Web editor <-> AgentChat integration (Phase 2 - Revert)
  WEB_EDITOR_REVERT_ELEMENT: 'web_editor_revert_element',
  // Web editor <-> AgentChat integration - Selection sync
  WEB_EDITOR_SELECTION_CHANGED: 'web_editor_selection_changed',
  // Web editor <-> AgentChat integration - Clear selection (sidepanel -> web-editor)
  WEB_EDITOR_CLEAR_SELECTION: 'web_editor_clear_selection',
  // Web editor <-> AgentChat integration - Cancel execution
  WEB_EDITOR_CANCEL_EXECUTION: 'web_editor_cancel_execution',
  // Web editor props (Phase 7.1.6 early injection)
  WEB_EDITOR_PROPS_REGISTER_EARLY_INJECTION: 'web_editor_props_register_early_injection',
  // Web editor props - open source file in VSCode
  WEB_EDITOR_OPEN_SOURCE: 'web_editor_open_source',
  // Quick Panel <-> AgentChat integration
  QUICK_PANEL_SEND_TO_AI: 'quick_panel_send_to_ai',
  QUICK_PANEL_CANCEL_AI: 'quick_panel_cancel_ai',
  QUICK_PANEL_GET_PROJECT_INFO: 'quick_panel_get_project_info',
  // Quick Panel Search - Tabs bridge
  QUICK_PANEL_TABS_QUERY: 'quick_panel_tabs_query',
  QUICK_PANEL_TAB_ACTIVATE: 'quick_panel_tab_activate',
  QUICK_PANEL_TAB_CLOSE: 'quick_panel_tab_close',
  // Quick Panel Search - Tabs secondary actions
  QUICK_PANEL_TAB_SET_PINNED: 'quick_panel_tab_set_pinned',
  QUICK_PANEL_TAB_SET_MUTED: 'quick_panel_tab_set_muted',
  // Quick Panel Search - Bookmarks bridge
  QUICK_PANEL_BOOKMARKS_QUERY: 'quick_panel_bookmarks_query',
  QUICK_PANEL_BOOKMARK_REMOVE: 'quick_panel_bookmark_remove',
  // Quick Panel Search - History bridge
  QUICK_PANEL_HISTORY_QUERY: 'quick_panel_history_query',
  QUICK_PANEL_HISTORY_DELETE: 'quick_panel_history_delete',
  // Quick Panel Search - Content bridge
  QUICK_PANEL_CONTENT_QUERY: 'quick_panel_content_query',
  // Quick Panel Navigation & Commands
  QUICK_PANEL_OPEN_URL: 'quick_panel_open_url',
  QUICK_PANEL_PAGE_COMMAND: 'quick_panel_page_command',
  // Quick Panel Diagnostics - API Detective
  QUICK_PANEL_API_DETECTIVE_START: 'quick_panel_api_detective_start',
  QUICK_PANEL_API_DETECTIVE_STOP: 'quick_panel_api_detective_stop',
  QUICK_PANEL_API_DETECTIVE_STATUS: 'quick_panel_api_detective_status',
  QUICK_PANEL_API_DETECTIVE_LIST: 'quick_panel_api_detective_list',
  QUICK_PANEL_API_DETECTIVE_GET_REQUEST: 'quick_panel_api_detective_get_request',
  QUICK_PANEL_API_DETECTIVE_REPLAY_REQUEST: 'quick_panel_api_detective_replay_request',
  // Quick Panel Clipboard History
  QUICK_PANEL_CLIPBOARD_RECORD: 'quick_panel_clipboard_record',
  QUICK_PANEL_CLIPBOARD_LIST: 'quick_panel_clipboard_list',
  QUICK_PANEL_CLIPBOARD_GET: 'quick_panel_clipboard_get',
  QUICK_PANEL_CLIPBOARD_SET_PINNED: 'quick_panel_clipboard_set_pinned',
  QUICK_PANEL_CLIPBOARD_DELETE: 'quick_panel_clipboard_delete',
  // Quick Panel Audit Log (Agent Mode)
  QUICK_PANEL_AUDIT_LOG_LIST: 'quick_panel_audit_log_list',
  QUICK_PANEL_AUDIT_LOG_CLEAR: 'quick_panel_audit_log_clear',
  // Quick Panel Notes
  QUICK_PANEL_NOTES_LIST: 'quick_panel_notes_list',
  QUICK_PANEL_NOTES_GET: 'quick_panel_notes_get',
  QUICK_PANEL_NOTES_CREATE: 'quick_panel_notes_create',
  QUICK_PANEL_NOTES_DELETE: 'quick_panel_notes_delete',
  // Quick Panel Focus Mode (Pomodoro / Focus)
  QUICK_PANEL_FOCUS_STATUS: 'quick_panel_focus_status',
  QUICK_PANEL_FOCUS_START: 'quick_panel_focus_start',
  QUICK_PANEL_FOCUS_STOP: 'quick_panel_focus_stop',
  QUICK_PANEL_FOCUS_PAUSE: 'quick_panel_focus_pause',
  QUICK_PANEL_FOCUS_RESUME: 'quick_panel_focus_resume',
  QUICK_PANEL_FOCUS_EXTEND: 'quick_panel_focus_extend',
  QUICK_PANEL_FOCUS_SET_BLOCKLIST: 'quick_panel_focus_set_blocklist',
  QUICK_PANEL_FOCUS_SET_BLOCKING_ENABLED: 'quick_panel_focus_set_blocking_enabled',
  QUICK_PANEL_FOCUS_SNOOZE_BLOCKING: 'quick_panel_focus_snooze_blocking',
  QUICK_PANEL_FOCUS_RESUME_BLOCKING: 'quick_panel_focus_resume_blocking',
  // Quick Panel Web Monitor / Price Track (optional)
  QUICK_PANEL_MONITOR_LIST: 'quick_panel_monitor_list',
  QUICK_PANEL_MONITOR_CREATE: 'quick_panel_monitor_create',
  QUICK_PANEL_MONITOR_DELETE: 'quick_panel_monitor_delete',
  QUICK_PANEL_MONITOR_SET_ENABLED: 'quick_panel_monitor_set_enabled',
  QUICK_PANEL_MONITOR_CHECK_NOW: 'quick_panel_monitor_check_now',
  QUICK_PANEL_MONITOR_ALERT_MARK_READ: 'quick_panel_monitor_alert_mark_read',
  QUICK_PANEL_MONITOR_ALERT_DELETE: 'quick_panel_monitor_alert_delete',
  // Quick Panel Workspaces (session snapshots)
  QUICK_PANEL_WORKSPACES_LIST: 'quick_panel_workspaces_list',
  QUICK_PANEL_WORKSPACES_SAVE: 'quick_panel_workspaces_save',
  QUICK_PANEL_WORKSPACES_OPEN: 'quick_panel_workspaces_open',
  QUICK_PANEL_WORKSPACES_DELETE: 'quick_panel_workspaces_delete',
  // Quick Panel Usage History (Frecency) - IndexedDB bridge
  QUICK_PANEL_USAGE_RECORD: 'quick_panel_usage_record',
  QUICK_PANEL_USAGE_GET_ENTRIES: 'quick_panel_usage_get_entries',
  QUICK_PANEL_USAGE_LIST_RECENT: 'quick_panel_usage_list_recent',
} as const;

// Offscreen message types
export const OFFSCREEN_MESSAGE_TYPES = {
  SIMILARITY_ENGINE_INIT: 'similarityEngineInit',
  SIMILARITY_ENGINE_COMPUTE: 'similarityEngineCompute',
  SIMILARITY_ENGINE_BATCH_COMPUTE: 'similarityEngineBatchCompute',
  SIMILARITY_ENGINE_STATUS: 'similarityEngineStatus',
  // Web Monitor / Price Track (fetch + extract via DOMParser in offscreen document)
  WEB_MONITOR_FETCH_EXTRACT: 'webMonitorFetchExtract',
  // GIF encoding
  GIF_ADD_FRAME: 'gifAddFrame',
  GIF_FINISH: 'gifFinish',
  GIF_RESET: 'gifReset',
} as const;

// Content script message types
export const CONTENT_MESSAGE_TYPES = {
  WEB_FETCHER_GET_TEXT_CONTENT: 'webFetcherGetTextContent',
  WEB_FETCHER_GET_HTML_CONTENT: 'getHtmlContent',
  NETWORK_CAPTURE_PING: 'network_capture_ping',
  CLICK_HELPER_PING: 'click_helper_ping',
  FILL_HELPER_PING: 'fill_helper_ping',
  KEYBOARD_HELPER_PING: 'keyboard_helper_ping',
  SCREENSHOT_HELPER_PING: 'screenshot_helper_ping',
  INTERACTIVE_ELEMENTS_HELPER_PING: 'interactive_elements_helper_ping',
  ACCESSIBILITY_TREE_HELPER_PING: 'chrome_read_page_ping',
  WAIT_HELPER_PING: 'wait_helper_ping',
  DOM_OBSERVER_PING: 'dom_observer_ping',
} as const;

// Tool action message types (for chrome.runtime.sendMessage)
export const TOOL_MESSAGE_TYPES = {
  // Screenshot related
  SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE: 'preparePageForCapture',
  SCREENSHOT_GET_PAGE_DETAILS: 'getPageDetails',
  SCREENSHOT_GET_ELEMENT_DETAILS: 'getElementDetails',
  SCREENSHOT_SCROLL_PAGE: 'scrollPage',
  SCREENSHOT_RESET_PAGE_AFTER_CAPTURE: 'resetPageAfterCapture',

  // Web content fetching
  WEB_FETCHER_GET_HTML_CONTENT: 'getHtmlContent',
  WEB_FETCHER_GET_TEXT_CONTENT: 'getTextContent',

  // User interactions
  CLICK_ELEMENT: 'clickElement',
  FILL_ELEMENT: 'fillElement',
  SIMULATE_KEYBOARD: 'simulateKeyboard',

  // Interactive elements
  GET_INTERACTIVE_ELEMENTS: 'getInteractiveElements',

  // Accessibility tree
  GENERATE_ACCESSIBILITY_TREE: 'generateAccessibilityTree',
  RESOLVE_REF: 'resolveRef',
  ENSURE_REF_FOR_SELECTOR: 'ensureRefForSelector',
  VERIFY_FINGERPRINT: 'verifyFingerprint',
  DISPATCH_HOVER_FOR_REF: 'dispatchHoverForRef',

  // Network requests
  NETWORK_SEND_REQUEST: 'sendPureNetworkRequest',

  // Wait helper
  WAIT_FOR_TEXT: 'waitForText',

  // Semantic similarity engine
  SIMILARITY_ENGINE_INIT: 'similarityEngineInit',
  SIMILARITY_ENGINE_COMPUTE_BATCH: 'similarityEngineComputeBatch',
  // Record & Replay content script bridge
  RR_RECORDER_CONTROL: 'rr_recorder_control',
  RR_RECORDER_EVENT: 'rr_recorder_event',
  // Record & Replay timeline feed (background -> content overlay)
  RR_TIMELINE_UPDATE: 'rr_timeline_update',
  // Quick Panel AI streaming events (background -> content script)
  QUICK_PANEL_AI_EVENT: 'quick_panel_ai_event',
  // DOM observer trigger bridge
  SET_DOM_TRIGGERS: 'set_dom_triggers',
  DOM_TRIGGER_FIRED: 'dom_trigger_fired',
  // Record & Replay overlay: variable collection
  COLLECT_VARIABLES: 'collectVariables',
  // Element marker overlay control (content-side)
  ELEMENT_MARKER_START: 'element_marker_start',
  // Element picker (tool-driven, background <-> content scripts)
  ELEMENT_PICKER_START: 'elementPickerStart',
  ELEMENT_PICKER_STOP: 'elementPickerStop',
  ELEMENT_PICKER_SET_ACTIVE_REQUEST: 'elementPickerSetActiveRequest',
  ELEMENT_PICKER_UI_PING: 'elementPickerUiPing',
  ELEMENT_PICKER_UI_SHOW: 'elementPickerUiShow',
  ELEMENT_PICKER_UI_UPDATE: 'elementPickerUiUpdate',
  ELEMENT_PICKER_UI_HIDE: 'elementPickerUiHide',
  // Tool approval prompt (background -> content scripts)
  TOOL_APPROVAL_SHOW: 'toolApprovalShow',
  TOOL_APPROVAL_HIDE: 'toolApprovalHide',
} as const;

// Type unions for type safety
export type BackgroundMessageType =
  (typeof BACKGROUND_MESSAGE_TYPES)[keyof typeof BACKGROUND_MESSAGE_TYPES];
export type OffscreenMessageType =
  (typeof OFFSCREEN_MESSAGE_TYPES)[keyof typeof OFFSCREEN_MESSAGE_TYPES];
export type ContentMessageType = (typeof CONTENT_MESSAGE_TYPES)[keyof typeof CONTENT_MESSAGE_TYPES];
export type ToolMessageType = (typeof TOOL_MESSAGE_TYPES)[keyof typeof TOOL_MESSAGE_TYPES];

// Legacy enum for backward compatibility (will be deprecated)
export enum SendMessageType {
  // Screenshot related message types
  ScreenshotPreparePageForCapture = 'preparePageForCapture',
  ScreenshotGetPageDetails = 'getPageDetails',
  ScreenshotGetElementDetails = 'getElementDetails',
  ScreenshotScrollPage = 'scrollPage',
  ScreenshotResetPageAfterCapture = 'resetPageAfterCapture',

  // Web content fetching related message types
  WebFetcherGetHtmlContent = 'getHtmlContent',
  WebFetcherGetTextContent = 'getTextContent',

  // Click related message types
  ClickElement = 'clickElement',

  // Input filling related message types
  FillElement = 'fillElement',

  // Interactive elements related message types
  GetInteractiveElements = 'getInteractiveElements',

  // Network request capture related message types
  NetworkSendRequest = 'sendPureNetworkRequest',

  // Keyboard event related message types
  SimulateKeyboard = 'simulateKeyboard',

  // Semantic similarity engine related message types
  SimilarityEngineInit = 'similarityEngineInit',
  SimilarityEngineComputeBatch = 'similarityEngineComputeBatch',
}

// ============================================================
// Quick Panel <-> AgentChat Message Contracts
// ============================================================

/**
 * Context information that can be attached to a Quick Panel AI request.
 * Allows passing page-specific data to enhance the AI's understanding.
 */
export interface QuickPanelAIContext {
  /** Current page URL */
  pageUrl?: string;
  /** User's text selection on the page */
  selectedText?: string;
  /**
   * Optional element metadata from the page.
   * Kept as unknown to avoid tight coupling with specific element types.
   */
  elementInfo?: unknown;
}

/**
 * Payload for sending a message to AI via Quick Panel.
 */
export interface QuickPanelSendToAIPayload {
  /** The user's instruction/question for the AI */
  instruction: string;
  /** Optional contextual information from the page */
  context?: QuickPanelAIContext;
}

/**
 * Response from QUICK_PANEL_SEND_TO_AI message handler.
 */
export type QuickPanelSendToAIResponse =
  | { success: true; requestId: string; sessionId: string }
  | { success: false; error: string };

/**
 * Message structure for sending to AI.
 */
export interface QuickPanelSendToAIMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_SEND_TO_AI;
  payload: QuickPanelSendToAIPayload;
}

/**
 * Payload for cancelling an active AI request.
 */
export interface QuickPanelCancelAIPayload {
  /** The request ID to cancel */
  requestId: string;
  /**
   * Optional session ID for fallback when background state is missing.
   * This can happen after MV3 Service Worker restarts.
   */
  sessionId?: string;
}

/**
 * Response from QUICK_PANEL_CANCEL_AI message handler.
 */
export type QuickPanelCancelAIResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for cancelling AI request.
 */
export interface QuickPanelCancelAIMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CANCEL_AI;
  payload: QuickPanelCancelAIPayload;
}

/**
 * Message pushed from background to content script with AI streaming events.
 * Uses the same RealtimeEvent type as AgentChat for consistency.
 */
export interface QuickPanelAIEventMessage {
  action: typeof TOOL_MESSAGE_TYPES.QUICK_PANEL_AI_EVENT;
  requestId: string;
  sessionId: string;
  event: RealtimeEvent;
}

/**
 * Response from QUICK_PANEL_GET_PROJECT_INFO message handler.
 */
export type QuickPanelGetProjectInfoResponse =
  | {
      success: true;
      sessionId: string | null;
      projectId: string | null;
      projectName: string | null;
    }
  | { success: false; error: string };

/**
 * Message structure for getting current project info.
 */
export interface QuickPanelGetProjectInfoMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_GET_PROJECT_INFO;
}

// ============================================================
// Quick Panel Search - Tabs Bridge Contracts
// ============================================================

/**
 * Payload for querying open tabs.
 */
export interface QuickPanelTabsQueryPayload {
  /**
   * When true (default), query tabs across all windows.
   * When false, restrict results to the sender's window.
   */
  includeAllWindows?: boolean;
}

/**
 * Summary of a single tab returned from the background.
 */
export interface QuickPanelTabSummary {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  index: number;
  lastAccessed?: number;
}

/**
 * Response from QUICK_PANEL_TABS_QUERY message handler.
 */
export type QuickPanelTabsQueryResponse =
  | {
      success: true;
      tabs: QuickPanelTabSummary[];
      currentTabId: number | null;
      currentWindowId: number | null;
    }
  | { success: false; error: string };

/**
 * Message structure for querying tabs.
 */
export interface QuickPanelTabsQueryMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TABS_QUERY;
  payload?: QuickPanelTabsQueryPayload;
}

/**
 * Payload for activating a tab.
 */
export interface QuickPanelActivateTabPayload {
  tabId: number;
  windowId?: number;
}

/**
 * Response from QUICK_PANEL_TAB_ACTIVATE message handler.
 */
export type QuickPanelActivateTabResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for activating a tab.
 */
export interface QuickPanelActivateTabMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_ACTIVATE;
  payload: QuickPanelActivateTabPayload;
}

/**
 * Payload for closing a tab.
 */
export interface QuickPanelCloseTabPayload {
  tabId: number;
}

/**
 * Response from QUICK_PANEL_TAB_CLOSE message handler.
 */
export type QuickPanelCloseTabResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for closing a tab.
 */
export interface QuickPanelCloseTabMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_CLOSE;
  payload: QuickPanelCloseTabPayload;
}

// ============================================================
// Quick Panel Search - Tabs Secondary Actions Contracts
// ============================================================

/**
 * Payload for setting a tab's pinned state.
 */
export interface QuickPanelTabSetPinnedPayload {
  tabId: number;
  pinned: boolean;
}

/**
 * Response from QUICK_PANEL_TAB_SET_PINNED message handler.
 */
export type QuickPanelTabSetPinnedResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for setting tab pinned state.
 */
export interface QuickPanelTabSetPinnedMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_SET_PINNED;
  payload: QuickPanelTabSetPinnedPayload;
}

/**
 * Payload for setting a tab's muted state.
 */
export interface QuickPanelTabSetMutedPayload {
  tabId: number;
  muted: boolean;
}

/**
 * Response from QUICK_PANEL_TAB_SET_MUTED message handler.
 */
export type QuickPanelTabSetMutedResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for setting tab muted state.
 */
export interface QuickPanelTabSetMutedMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_TAB_SET_MUTED;
  payload: QuickPanelTabSetMutedPayload;
}

// ============================================================
// Quick Panel Search - Bookmarks Bridge Contracts
// ============================================================

/**
 * Payload for querying bookmarks.
 */
export interface QuickPanelBookmarksQueryPayload {
  query: string;
  maxResults?: number;
}

/**
 * Summary of a single bookmark returned from the background.
 */
export interface QuickPanelBookmarkSummary {
  id: string;
  title: string;
  url: string;
  dateAdded?: number;
  parentId?: string;
}

/**
 * Response from QUICK_PANEL_BOOKMARKS_QUERY message handler.
 */
export type QuickPanelBookmarksQueryResponse =
  | { success: true; bookmarks: QuickPanelBookmarkSummary[] }
  | { success: false; error: string };

/**
 * Message structure for querying bookmarks.
 */
export interface QuickPanelBookmarksQueryMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_BOOKMARKS_QUERY;
  payload: QuickPanelBookmarksQueryPayload;
}

/**
 * Payload for removing a bookmark.
 */
export interface QuickPanelBookmarkRemovePayload {
  bookmarkId: string;
}

/**
 * Response from QUICK_PANEL_BOOKMARK_REMOVE message handler.
 */
export type QuickPanelBookmarkRemoveResponse =
  | { success: true }
  | { success: false; error: string };

/**
 * Message structure for removing a bookmark.
 */
export interface QuickPanelBookmarkRemoveMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_BOOKMARK_REMOVE;
  payload: QuickPanelBookmarkRemovePayload;
}

// ============================================================
// Quick Panel Search - History Bridge Contracts
// ============================================================

/**
 * Payload for querying history.
 */
export interface QuickPanelHistoryQueryPayload {
  query: string;
  maxResults?: number;
}

/**
 * Summary of a single history item returned from the background.
 */
export interface QuickPanelHistorySummary {
  id: string;
  url: string;
  title: string;
  lastVisitTime?: number;
  visitCount?: number;
  typedCount?: number;
}

/**
 * Response from QUICK_PANEL_HISTORY_QUERY message handler.
 */
export type QuickPanelHistoryQueryResponse =
  | { success: true; items: QuickPanelHistorySummary[] }
  | { success: false; error: string };

/**
 * Message structure for querying history.
 */
export interface QuickPanelHistoryQueryMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_HISTORY_QUERY;
  payload: QuickPanelHistoryQueryPayload;
}

/**
 * Payload for deleting a history entry (by URL).
 */
export interface QuickPanelHistoryDeletePayload {
  url: string;
}

/**
 * Response from QUICK_PANEL_HISTORY_DELETE message handler.
 */
export type QuickPanelHistoryDeleteResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for deleting a history entry.
 */
export interface QuickPanelHistoryDeleteMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_HISTORY_DELETE;
  payload: QuickPanelHistoryDeletePayload;
}

// ============================================================
// Quick Panel Search - Content Bridge Contracts
// ============================================================

/**
 * Payload for querying cached tab content.
 */
export interface QuickPanelContentQueryPayload {
  query: string;
  maxResults?: number;
}

/**
 * Summary of a single content match returned from the background.
 */
export interface QuickPanelContentMatchSummary {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
  snippet: string;
  score: number;
}

/**
 * Response from QUICK_PANEL_CONTENT_QUERY message handler.
 */
export type QuickPanelContentQueryResponse =
  | { success: true; items: QuickPanelContentMatchSummary[] }
  | { success: false; error: string };

/**
 * Message structure for querying cached tab content.
 */
export interface QuickPanelContentQueryMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CONTENT_QUERY;
  payload: QuickPanelContentQueryPayload;
}

// ============================================================
// Quick Panel Navigation Contracts
// ============================================================

/**
 * URL opening disposition.
 */
export type QuickPanelOpenUrlDisposition = 'current_tab' | 'new_tab' | 'background_tab';

/**
 * Payload for opening a URL.
 */
export interface QuickPanelOpenUrlPayload {
  url: string;
  disposition?: QuickPanelOpenUrlDisposition;
}

/**
 * Response from QUICK_PANEL_OPEN_URL message handler.
 */
export type QuickPanelOpenUrlResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for opening a URL.
 */
export interface QuickPanelOpenUrlMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_OPEN_URL;
  payload: QuickPanelOpenUrlPayload;
}

// ============================================================
// Quick Panel Page Commands Contracts
// ============================================================

/**
 * Available page commands.
 */
export type QuickPanelPageCommand =
  | 'reload'
  | 'back'
  | 'forward'
  | 'stop'
  | 'screenshot'
  | 'dev_console_snapshot_export'
  | 'dev_console_errors_export'
  | 'dev_read_page_export'
  | 'dev_network_capture_10s_export'
  | 'dev_performance_trace_5s_export'
  | 'dev_debug_bundle_create'
  | 'dev_debug_bundle_cancel'
  | 'close_tab'
  | 'duplicate_tab'
  | 'toggle_pin'
  | 'toggle_mute'
  | 'close_other_tabs'
  | 'close_tabs_to_right'
  | 'discard_inactive_tabs'
  | 'merge_all_windows'
  | 'skin_vscode'
  | 'skin_terminal'
  | 'skin_retro'
  | 'skin_paper'
  | 'skin_off'
  | 'zen_mode_toggle'
  | 'force_dark_toggle'
  | 'allow_copy_toggle'
  | 'privacy_curtain_toggle'
  | 'reader_mode_toggle'
  | 'new_tab'
  | 'new_window'
  | 'new_incognito_window';

/**
 * Payload for executing a page command.
 */
export interface QuickPanelPageCommandPayload {
  command: QuickPanelPageCommand;
}

export interface QuickPanelPageCommandInfo {
  message?: string;
  download?: {
    downloadId?: number;
    filename?: string;
    fullPath?: string;
  };
}

/**
 * Response from QUICK_PANEL_PAGE_COMMAND message handler.
 */
export type QuickPanelPageCommandResponse =
  | { success: true; info?: QuickPanelPageCommandInfo }
  | { success: false; error: string };

/**
 * Message structure for executing a page command.
 */
export interface QuickPanelPageCommandMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_PAGE_COMMAND;
  payload: QuickPanelPageCommandPayload;
}

// ============================================================
// Quick Panel API Detective (Diagnostics) Contracts
// ============================================================

export type QuickPanelApiDetectiveBackend = 'webRequest' | 'debugger';
// eslint-disable-next-line
export interface QuickPanelApiDetectiveStatusPayload {}

export type QuickPanelApiDetectiveStatusResponse =
  | {
      success: true;
      active: boolean;
      backend: QuickPanelApiDetectiveBackend | null;
      startedAt: number | null;
      lastCaptureAt: number | null;
      lastRequestCount: number;
    }
  | { success: false; error: string };

export interface QuickPanelApiDetectiveStatusMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STATUS;
  payload: QuickPanelApiDetectiveStatusPayload;
}

export interface QuickPanelApiDetectiveStartPayload {
  /**
   * When true, uses the debugger backend and captures response bodies (high risk).
   * Default: false (webRequest backend, no response body).
   */
  needResponseBody?: boolean;
  /** Include static resources such as images/scripts/styles. Default: false. */
  includeStatic?: boolean;
  /** Max capture time in milliseconds. Default: 180000 (3 minutes). */
  maxCaptureTimeMs?: number;
}

export type QuickPanelApiDetectiveStartResponse =
  | {
      success: true;
      active: true;
      backend: QuickPanelApiDetectiveBackend;
      startedAt: number;
    }
  | { success: false; error: string };

export interface QuickPanelApiDetectiveStartMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_START;
  payload: QuickPanelApiDetectiveStartPayload;
}

// eslint-disable-next-line
export interface QuickPanelApiDetectiveStopPayload {}

export type QuickPanelApiDetectiveStopResponse =
  | {
      success: true;
      active: false;
      backend: QuickPanelApiDetectiveBackend;
      capturedAt: number;
      requestCount: number;
    }
  | { success: false; error: string };

export interface QuickPanelApiDetectiveStopMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_STOP;
  payload: QuickPanelApiDetectiveStopPayload;
}

export interface QuickPanelApiDetectiveRequestSummary {
  requestId: string;
  method: string;
  url: string;
  type?: string;
  status?: number;
  mimeType?: string;
  requestBodyPreview?: string;
}

export interface QuickPanelApiDetectiveListPayload {
  /** Optional query for server-side filtering (best-effort). */
  query?: string;
  /** Max results requested (best-effort). */
  maxResults?: number;
}

export type QuickPanelApiDetectiveListResponse =
  | {
      success: true;
      active: boolean;
      backend: QuickPanelApiDetectiveBackend | null;
      capturedAt: number | null;
      tabUrl: string | null;
      items: QuickPanelApiDetectiveRequestSummary[];
    }
  | { success: false; error: string };

export interface QuickPanelApiDetectiveListMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_LIST;
  payload: QuickPanelApiDetectiveListPayload;
}

export interface QuickPanelApiDetectiveRequestDetail {
  requestId: string;
  method: string;
  url: string;
  type?: string;
  status?: number;
  mimeType?: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
}

export interface QuickPanelApiDetectiveGetRequestPayload {
  requestId: string;
}

export type QuickPanelApiDetectiveGetRequestResponse =
  | { success: true; request: QuickPanelApiDetectiveRequestDetail }
  | { success: false; error: string };

export interface QuickPanelApiDetectiveGetRequestMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_GET_REQUEST;
  payload: QuickPanelApiDetectiveGetRequestPayload;
}

export interface QuickPanelApiDetectiveReplayRequestPayload {
  requestId: string;
  timeoutMs?: number;
}

export type QuickPanelApiDetectiveReplayRequestResponse =
  | { success: true; result: unknown }
  | { success: false; error: string };

export interface QuickPanelApiDetectiveReplayRequestMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_API_DETECTIVE_REPLAY_REQUEST;
  payload: QuickPanelApiDetectiveReplayRequestPayload;
}

// ============================================================
// Quick Panel Clipboard History Contracts
// ============================================================

export interface QuickPanelClipboardItemSummary {
  id: string;
  preview: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  incognito: boolean;
  /** Best-effort source tag (e.g. "commands.copy.url", "toolbox.jwt.payload"). */
  source?: string;
  /** Best-effort label (e.g. page title or output title). */
  label?: string;
  /** Best-effort origin URL (tab where the copy happened). */
  originUrl?: string;
  /** Best-effort origin title (tab where the copy happened). */
  originTitle?: string;
  /** Original UTF-8 byte length (may exceed stored length). */
  byteLength: number;
  /** Whether the full value is stored and retrievable. */
  stored: boolean;
  /** Copy count for dedupe + ranking. */
  copyCount: number;
}

export interface QuickPanelClipboardItemDetail extends QuickPanelClipboardItemSummary {
  /** Full stored value. Null when not stored (e.g. too large). */
  value: string | null;
}

export interface QuickPanelClipboardRecordPayload {
  text: string;
  source?: string;
  label?: string;
  originUrl?: string;
  originTitle?: string;
}

export type QuickPanelClipboardRecordResponse =
  | { success: true }
  | { success: false; error: string };

export interface QuickPanelClipboardRecordMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_RECORD;
  payload: QuickPanelClipboardRecordPayload;
}

export interface QuickPanelClipboardListPayload {
  query?: string;
  maxResults?: number;
}

export type QuickPanelClipboardListResponse =
  | { success: true; items: QuickPanelClipboardItemSummary[] }
  | { success: false; error: string };

export interface QuickPanelClipboardListMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_LIST;
  payload: QuickPanelClipboardListPayload;
}

export interface QuickPanelClipboardGetPayload {
  id: string;
}

export type QuickPanelClipboardGetResponse =
  | { success: true; item: QuickPanelClipboardItemDetail }
  | { success: false; error: string };

export interface QuickPanelClipboardGetMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_GET;
  payload: QuickPanelClipboardGetPayload;
}

export interface QuickPanelClipboardSetPinnedPayload {
  id: string;
  pinned: boolean;
}

export type QuickPanelClipboardSetPinnedResponse =
  | { success: true }
  | { success: false; error: string };

export interface QuickPanelClipboardSetPinnedMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_SET_PINNED;
  payload: QuickPanelClipboardSetPinnedPayload;
}

export interface QuickPanelClipboardDeletePayload {
  id: string;
}

export type QuickPanelClipboardDeleteResponse =
  | { success: true }
  | { success: false; error: string };

export interface QuickPanelClipboardDeleteMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CLIPBOARD_DELETE;
  payload: QuickPanelClipboardDeletePayload;
}

// ============================================================
// Quick Panel Notes Contracts
// ============================================================

export interface QuickPanelNoteSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  incognito: boolean;
}

export interface QuickPanelNoteDetail extends QuickPanelNoteSummary {
  content: string;
}

export interface QuickPanelNotesListPayload {
  query?: string;
  maxResults?: number;
}

export type QuickPanelNotesListResponse =
  | { success: true; items: QuickPanelNoteSummary[] }
  | { success: false; error: string };

export interface QuickPanelNotesListMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_LIST;
  payload: QuickPanelNotesListPayload;
}

export interface QuickPanelNotesGetPayload {
  id: string;
}

export type QuickPanelNotesGetResponse =
  | { success: true; note: QuickPanelNoteDetail }
  | { success: false; error: string };

export interface QuickPanelNotesGetMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_GET;
  payload: QuickPanelNotesGetPayload;
}

export interface QuickPanelNotesCreatePayload {
  title?: string;
  content: string;
}

export type QuickPanelNotesCreateResponse =
  | { success: true; note: QuickPanelNoteSummary }
  | { success: false; error: string };

export interface QuickPanelNotesCreateMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_CREATE;
  payload: QuickPanelNotesCreatePayload;
}

export interface QuickPanelNotesDeletePayload {
  id: string;
}

export type QuickPanelNotesDeleteResponse = { success: true } | { success: false; error: string };

export interface QuickPanelNotesDeleteMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_NOTES_DELETE;
  payload: QuickPanelNotesDeletePayload;
}

// ============================================================
// Quick Panel Focus Mode Contracts
// ============================================================

export type QuickPanelFocusPhase = 'idle' | 'running' | 'paused';

export interface QuickPanelFocusSession {
  phase: QuickPanelFocusPhase;
  /** When the focus session was started. */
  startedAt: number;
  /** When the focus session will end (only meaningful when running). */
  endsAt: number;
  /**
   * Remaining milliseconds.
   * - When running: best-effort computed at response time.
   * - When paused: persisted remaining time.
   */
  remainingMs: number;
  /** Total planned duration (initial duration + extensions). */
  durationMs: number;
  /** Updated timestamp for UI ordering/debug. */
  updatedAt: number;
}

export interface QuickPanelFocusStatus {
  incognito: boolean;
  now: number;
  session: QuickPanelFocusSession;
  blockingEnabled: boolean;
  blockingActive: boolean;
  /**
   * Temporary blocking override (timestamp in ms).
   * When `now < blockingSnoozedUntil`, blocking rules are suspended even if enabled.
   */
  blockingSnoozedUntil: number;
  blocklist: string[];
}

export type QuickPanelFocusStatusResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusStatusMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STATUS;
  payload?: Record<string, never>;
}

export interface QuickPanelFocusStartPayload {
  /** Focus duration in minutes. */
  durationMinutes: number;
}

export type QuickPanelFocusStartResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusStartMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_START;
  payload: QuickPanelFocusStartPayload;
}

export type QuickPanelFocusStopResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusStopMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_STOP;
  payload?: Record<string, never>;
}

export type QuickPanelFocusPauseResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusPauseMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_PAUSE;
  payload?: Record<string, never>;
}

export type QuickPanelFocusResumeResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusResumeMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME;
  payload?: Record<string, never>;
}

export interface QuickPanelFocusExtendPayload {
  /** Extend duration in minutes. */
  minutes: number;
}

export type QuickPanelFocusExtendResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusExtendMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_EXTEND;
  payload: QuickPanelFocusExtendPayload;
}

export interface QuickPanelFocusSetBlocklistPayload {
  /** Hostname list (e.g. "youtube.com"). */
  domains: string[];
}

export type QuickPanelFocusSetBlocklistResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusSetBlocklistMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKLIST;
  payload: QuickPanelFocusSetBlocklistPayload;
}

export interface QuickPanelFocusSetBlockingEnabledPayload {
  enabled: boolean;
}

export type QuickPanelFocusSetBlockingEnabledResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusSetBlockingEnabledMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SET_BLOCKING_ENABLED;
  payload: QuickPanelFocusSetBlockingEnabledPayload;
}

export interface QuickPanelFocusSnoozeBlockingPayload {
  /** Snooze duration in minutes. Extends if already snoozed. */
  minutes: number;
}

export type QuickPanelFocusSnoozeBlockingResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusSnoozeBlockingMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_SNOOZE_BLOCKING;
  payload: QuickPanelFocusSnoozeBlockingPayload;
}

export type QuickPanelFocusResumeBlockingResponse =
  | { success: true; status: QuickPanelFocusStatus }
  | { success: false; error: string };

export interface QuickPanelFocusResumeBlockingMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_FOCUS_RESUME_BLOCKING;
  payload?: Record<string, never>;
}

// ============================================================
// Quick Panel Web Monitor / Price Track Contracts
// ============================================================

export type QuickPanelMonitorExtractorKind = 'selector_text' | 'selector_attr';

export interface QuickPanelMonitorSummary {
  id: string;
  url: string;
  extractor: QuickPanelMonitorExtractorKind;
  selector: string;
  attribute?: string;
  intervalMinutes: number;
  enabled: boolean;
  incognito: boolean;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number;
  lastChangedAt: number;
  lastValuePreview?: string;
  lastError?: string;
  unreadAlerts: number;
}

// ============================================================
// Quick Panel Audit Log Contracts (Phase 14 - Agent Mode)
// ============================================================

export type QuickPanelAuditLogRiskLevel = 'low' | 'medium' | 'high';

export type QuickPanelAuditLogStatus = 'success' | 'error' | 'denied';

export interface QuickPanelAuditLogEntry {
  id: string;
  toolName: string;
  toolDescription?: string;
  riskLevel: QuickPanelAuditLogRiskLevel;
  riskCategories: string[];
  source: 'native_host' | 'extension_ui' | 'internal';
  incognito: boolean;
  status: QuickPanelAuditLogStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  argsSummary: string;
  resultSummary: string;
}

export interface QuickPanelAuditLogListPayload {
  query?: string;
  maxResults?: number;
}

export type QuickPanelAuditLogListResponse =
  | { success: true; entries: QuickPanelAuditLogEntry[] }
  | { success: false; error: string };

export interface QuickPanelAuditLogListMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_LIST;
  payload: QuickPanelAuditLogListPayload;
}

export type QuickPanelAuditLogClearResponse = { success: true } | { success: false; error: string };

export interface QuickPanelAuditLogClearMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_AUDIT_LOG_CLEAR;
  payload?: Record<string, never>;
}

export interface QuickPanelMonitorAlert {
  id: string;
  monitorId: string;
  incognito: boolean;
  createdAt: number;
  url: string;
  selector: string;
  oldValue: string | null;
  newValue: string | null;
  read: boolean;
}

export interface QuickPanelMonitorListPayload {
  /** Optional search query (best-effort). */
  query?: string;
  /** Max monitors requested (best-effort). */
  maxMonitors?: number;
  /** Max alerts requested (best-effort). */
  maxAlerts?: number;
}

export type QuickPanelMonitorListResponse =
  | {
      success: true;
      monitors: QuickPanelMonitorSummary[];
      alerts: QuickPanelMonitorAlert[];
      unreadCount: number;
    }
  | { success: false; error: string };

export interface QuickPanelMonitorListMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_LIST;
  payload: QuickPanelMonitorListPayload;
}

export interface QuickPanelMonitorCreatePayload {
  url: string;
  selector: string;
  extractor?: QuickPanelMonitorExtractorKind;
  attribute?: string;
  intervalMinutes?: number;
  /** If true, run an immediate baseline fetch. Default: true. */
  fetchNow?: boolean;
}

export type QuickPanelMonitorCreateResponse =
  | { success: true; monitor: QuickPanelMonitorSummary }
  | { success: false; error: string };

export interface QuickPanelMonitorCreateMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CREATE;
  payload: QuickPanelMonitorCreatePayload;
}

export interface QuickPanelMonitorDeletePayload {
  id: string;
}

export type QuickPanelMonitorDeleteResponse = { success: true } | { success: false; error: string };

export interface QuickPanelMonitorDeleteMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_DELETE;
  payload: QuickPanelMonitorDeletePayload;
}

export interface QuickPanelMonitorSetEnabledPayload {
  id: string;
  enabled: boolean;
}

export type QuickPanelMonitorSetEnabledResponse =
  | { success: true; monitor: QuickPanelMonitorSummary }
  | { success: false; error: string };

export interface QuickPanelMonitorSetEnabledMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_SET_ENABLED;
  payload: QuickPanelMonitorSetEnabledPayload;
}

export interface QuickPanelMonitorCheckNowPayload {
  id: string;
}

export type QuickPanelMonitorCheckNowResponse =
  | {
      success: true;
      monitor: QuickPanelMonitorSummary;
      alertCreated?: QuickPanelMonitorAlert;
    }
  | { success: false; error: string };

export interface QuickPanelMonitorCheckNowMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_CHECK_NOW;
  payload: QuickPanelMonitorCheckNowPayload;
}

export interface QuickPanelMonitorAlertMarkReadPayload {
  id: string;
  read: boolean;
}

export type QuickPanelMonitorAlertMarkReadResponse =
  | { success: true; unreadCount: number }
  | { success: false; error: string };

export interface QuickPanelMonitorAlertMarkReadMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_MARK_READ;
  payload: QuickPanelMonitorAlertMarkReadPayload;
}

export interface QuickPanelMonitorAlertDeletePayload {
  id: string;
}

export type QuickPanelMonitorAlertDeleteResponse =
  | { success: true; unreadCount: number }
  | { success: false; error: string };

export interface QuickPanelMonitorAlertDeleteMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_MONITOR_ALERT_DELETE;
  payload: QuickPanelMonitorAlertDeletePayload;
}

// ============================================================
// Quick Panel Workspaces (Session Snapshots) Contracts
// ============================================================

/**
 * Minimal workspace snapshot summary for list/search UI.
 */
export interface QuickPanelWorkspaceSummary {
  id: string;
  name: string;
  tabCount: number;
  createdAt: number;
  updatedAt: number;
  incognito: boolean;
}

/**
 * Payload for listing workspace snapshots.
 */
export interface QuickPanelWorkspacesListPayload {
  /**
   * Optional filter query.
   * Background may ignore and return recent list; UI can apply additional scoring.
   */
  query?: string;
  /** Max results requested (best-effort). */
  maxResults?: number;
}

/**
 * Response from QUICK_PANEL_WORKSPACES_LIST message handler.
 */
export type QuickPanelWorkspacesListResponse =
  | { success: true; items: QuickPanelWorkspaceSummary[] }
  | { success: false; error: string };

/**
 * Message structure for listing workspaces.
 */
export interface QuickPanelWorkspacesListMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_LIST;
  payload: QuickPanelWorkspacesListPayload;
}

/**
 * Payload for saving a snapshot of the current window session.
 */
export interface QuickPanelWorkspacesSavePayload {
  /** Optional user-provided name. Background will generate a default when empty. */
  name?: string;
}

/**
 * Response from QUICK_PANEL_WORKSPACES_SAVE message handler.
 */
export type QuickPanelWorkspacesSaveResponse =
  | { success: true; workspace: QuickPanelWorkspaceSummary }
  | { success: false; error: string };

/**
 * Message structure for saving a workspace snapshot.
 */
export interface QuickPanelWorkspacesSaveMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_SAVE;
  payload: QuickPanelWorkspacesSavePayload;
}

/**
 * Where to open a workspace snapshot.
 */
export type QuickPanelWorkspacesOpenTarget = 'current_window' | 'new_window';

/**
 * Payload for opening a workspace snapshot.
 */
export interface QuickPanelWorkspacesOpenPayload {
  workspaceId: string;
  target: QuickPanelWorkspacesOpenTarget;
}

/**
 * Response from QUICK_PANEL_WORKSPACES_OPEN message handler.
 */
export type QuickPanelWorkspacesOpenResponse =
  | { success: true; openedCount: number; totalCount: number; windowId?: number }
  | { success: false; error: string };

/**
 * Message structure for opening a workspace snapshot.
 */
export interface QuickPanelWorkspacesOpenMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_OPEN;
  payload: QuickPanelWorkspacesOpenPayload;
}

/**
 * Payload for deleting a workspace snapshot.
 */
export interface QuickPanelWorkspacesDeletePayload {
  workspaceId: string;
}

/**
 * Response from QUICK_PANEL_WORKSPACES_DELETE message handler.
 */
export type QuickPanelWorkspacesDeleteResponse =
  | { success: true }
  | { success: false; error: string };

/**
 * Message structure for deleting a workspace snapshot.
 */
export interface QuickPanelWorkspacesDeleteMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_WORKSPACES_DELETE;
  payload: QuickPanelWorkspacesDeletePayload;
}

// ============================================================
// Quick Panel Usage History (Frecency) Contracts
// ============================================================

/**
 * Summary of a single usage entry returned from the background.
 */
export interface QuickPanelUsageEntrySummary {
  key: string;
  lastUsedAt: number;
  count: number;
}

/**
 * Payload for recording a single usage event.
 */
export interface QuickPanelUsageRecordPayload {
  /** History namespace (legacy chrome.storage.local key). */
  namespace: string;
  /** Usage key (e.g. `url:https://...` or `cmd:reload`). */
  key: string;
  /** Optional cap for entries in this namespace. */
  maxEntries?: number;
}

/**
 * Response from QUICK_PANEL_USAGE_RECORD message handler.
 */
export type QuickPanelUsageRecordResponse = { success: true } | { success: false; error: string };

/**
 * Message structure for recording usage.
 */
export interface QuickPanelUsageRecordMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_RECORD;
  payload: QuickPanelUsageRecordPayload;
}

/**
 * Payload for fetching multiple usage entries by key.
 */
export interface QuickPanelUsageGetEntriesPayload {
  namespace: string;
  keys: string[];
}

/**
 * Response from QUICK_PANEL_USAGE_GET_ENTRIES message handler.
 */
export type QuickPanelUsageGetEntriesResponse =
  | { success: true; entries: QuickPanelUsageEntrySummary[] }
  | { success: false; error: string };

/**
 * Message structure for fetching usage entries by key.
 */
export interface QuickPanelUsageGetEntriesMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_GET_ENTRIES;
  payload: QuickPanelUsageGetEntriesPayload;
}

/**
 * Payload for listing recent usage entries.
 */
export interface QuickPanelUsageListRecentPayload {
  namespace: string;
  /** Maximum items to return (sorted by lastUsedAt DESC). */
  limit?: number;
}

/**
 * Response from QUICK_PANEL_USAGE_LIST_RECENT message handler.
 */
export type QuickPanelUsageListRecentResponse =
  | { success: true; items: QuickPanelUsageEntrySummary[] }
  | { success: false; error: string };

/**
 * Message structure for listing recent usage entries.
 */
export interface QuickPanelUsageListRecentMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_USAGE_LIST_RECENT;
  payload: QuickPanelUsageListRecentPayload;
}
