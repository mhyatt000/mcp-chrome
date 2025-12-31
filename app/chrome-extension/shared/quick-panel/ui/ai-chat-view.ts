/**
 * Quick Panel AI Chat View
 *
 * An embeddable AI chat view component designed to work within QuickPanelShell.
 * Unlike the standalone ai-chat-panel.ts, this component:
 * - Does NOT create its own overlay/panel container
 * - Renders content into provided mount points from the Shell
 * - Delegates close/ESC handling to the parent controller
 *
 * Features:
 * - Streaming message display with real-time updates
 * - Liquid Glass design with AgentChat token compatibility
 * - Request lifecycle management (send, cancel, cleanup)
 * - Auto-context collection (page URL, text selection)
 */

import type {
  AgentMessage,
  AgentStatusEvent,
  AgentUsageStats,
  RealtimeEvent,
} from 'chrome-mcp-shared';

import type { QuickPanelAIContext, QuickPanelSendToAIPayload } from '@/common/message-types';
import type { QuickPanelAgentBridge } from '../core/agent-bridge';
import { Disposer } from '@/entrypoints/web-editor-v2/utils/disposables';
import {
  createQuickPanelMessageRenderer,
  type QuickPanelMessageRenderer,
} from './message-renderer';

// ============================================================
// Types
// ============================================================

export interface QuickPanelAiChatViewMountPoints {
  /** Mount point for header content (title/subtitle) */
  header: HTMLElement;
  /** Mount point for header right content (stream indicator) */
  headerRight: HTMLElement;
  /** Mount point for main content (messages/empty state) */
  content: HTMLElement;
  /** Mount point for footer content (composer) */
  footer: HTMLElement;
  /** Scroll container for auto-scroll behavior (typically Shell's content element) */
  scrollContainer: HTMLElement;
}

export interface QuickPanelAiChatViewOptions {
  /** Mount points provided by the Shell */
  mountPoints: QuickPanelAiChatViewMountPoints;
  /** Agent bridge for background communication */
  agentBridge: QuickPanelAgentBridge;

  /** Header title. Default: "Agent" */
  title?: string;
  /** Header subtitle. Default: "Quick Panel" */
  subtitle?: string;
  /** Input placeholder. Default: "Ask the agent..." */
  placeholder?: string;
  /** Auto-focus textarea on mount. Default: true */
  autoFocus?: boolean;

  /** Optional context provider for enhanced AI understanding */
  getContext?: () => QuickPanelAIContext | null | Promise<QuickPanelAIContext | null>;

  /** Called when Enter is pressed in textarea (for keyboard controller integration) */
  onSend?: () => void;
}

export interface QuickPanelAiChatViewState {
  sending: boolean;
  streaming: boolean;
  cancelling: boolean;
  currentRequestId: string | null;
  sessionId: string | null;
  lastStatus: AgentStatusEvent['status'] | null;
  lastUsage: AgentUsageStats | null;
  errorMessage: string | null;
}

export interface QuickPanelAiChatViewManager {
  getState: () => QuickPanelAiChatViewState;
  focusInput: () => void;
  clearMessages: () => void;
  hasMessages: () => boolean;
  scrollToBottom: () => void;
  cancelCurrentRequest: () => Promise<void>;
  dispose: () => void;
}

// ============================================================
// Constants
// ============================================================

const LOG_PREFIX = '[QuickPanelAiChatView]';

const DEFAULT_TITLE = 'Agent';
const DEFAULT_SUBTITLE = 'Quick Panel';
const DEFAULT_PLACEHOLDER = 'Ask the agent...';

/** Max chars for selected text context to avoid payload bloat */
const MAX_SELECTED_TEXT_CHARS = 3000;
/** Max chars for error message display */
const MAX_ERROR_DISPLAY_CHARS = 600;

const TEXTAREA_MIN_HEIGHT_PX = 42;
const TEXTAREA_MAX_HEIGHT_PX = 160;

/** Auto-hide duration for success/warning banners */
const BANNER_AUTO_HIDE_MS = 2400;

/** Loading text update interval range (ms) */
const LOADING_TEXT_MIN_INTERVAL_MS = 5000;
const LOADING_TEXT_MAX_INTERVAL_MS = 8000;

/** Random loading texts for streaming status */
const LOADING_TEXTS = [
  '本来应该从从容容游刃有余',
  '现在是匆匆忙忙连滚带爬',
  '我知道你很急，但是先别急',
  '在知识的海洋里狗刨',
  '让子弹再飞一会儿',
  '正在为您手搓答案',
  '浪浪山小妖怪集结中',
  '别催，已经在写了（新建文件夹）',
  '正在汗流浃背地思考中',
  'CPU 都要给我干烧了',
  '村咖慢焙，精华需要时间',
  '知识煎饼翻面中',
  '敬自己一杯，马上好',
  '正在把灵感放入烤箱',
  '让答案再泡一会儿',
  '情绪价值拉满中',
  '正在为您编织语言的毛衣',
  '神经元蹦迪中',
  '熬夜的猫头鹰在思考',
  '给答案上色中',
  '正在疯狂翻阅知识库',
  '大脑马戏团开演',
  '正在把 0 和 1 捏在一起',
  '正在憋个大招',
  '放大镜有点起雾，擦擦',
  '试图理解这个离谱的需求',
  '正在施法，莫打扰',
  '唤醒硅基朋友',
  '正在连接赛博空间的智慧',
  '道友请留步，正在推演',
  '穿越知识黑洞',
  '正在反向解析人类意图',
  '水晶球有点模糊，拍两下',
  '代码跑得比记者还快',
  '主理人已上线，请稍候',
  '快马加鞭赶来中',
  '正在光速搬运知识',
  '拼图最后一块',
  '答案即将杀青',
  '发射倒计时',
  '目标锁定中',
];

function getRandomLoadingText(): string {
  return LOADING_TEXTS[Math.floor(Math.random() * LOADING_TEXTS.length)];
}

// SVG Icons
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;

// ============================================================
// Utility Functions
// ============================================================

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}\u2026`;
}

function safeFocus(element: HTMLElement): void {
  try {
    element.focus();
  } catch {
    // Best-effort focus
  }
}

function isTerminalStatus(status: AgentStatusEvent['status']): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled';
}

/**
 * Collect default context from the current page
 */
function collectDefaultContext(): QuickPanelAIContext {
  const context: QuickPanelAIContext = {
    pageUrl: globalThis.location?.href,
  };

  try {
    const selection = globalThis.getSelection?.();
    const selectedText = selection?.toString()?.trim() ?? '';
    if (selectedText) {
      context.selectedText = truncateText(selectedText, MAX_SELECTED_TEXT_CHARS);
    }
  } catch {
    // Ignore selection access errors
  }

  return context;
}

/**
 * Build a local user message for optimistic rendering
 */
function buildLocalUserMessage(
  sessionId: string,
  requestId: string,
  instruction: string,
): AgentMessage {
  return {
    id: `local-user:${requestId}`,
    sessionId,
    role: 'user',
    content: instruction,
    messageType: 'chat',
    requestId,
    isStreaming: false,
    isFinal: true,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Format usage stats for display
 */
function formatUsageStats(usage: AgentUsageStats | null): string | null {
  if (!usage) return null;

  const parts: string[] = [];

  const inputTokens = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  const outputTokens = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
  parts.push(`in ${inputTokens}`, `out ${outputTokens}`);

  if (Number.isFinite(usage.durationMs) && usage.durationMs > 0) {
    const seconds = Math.max(1, Math.round(usage.durationMs / 1000));
    parts.push(`${seconds}s`);
  }

  if (Number.isFinite(usage.totalCostUsd) && usage.totalCostUsd > 0) {
    parts.push(`$${usage.totalCostUsd.toFixed(4)}`);
  }

  return parts.join(' \u2022 ');
}

// ============================================================
// DOM Builder Functions
// ============================================================

interface ViewDOMElements {
  // Header elements
  brand: HTMLDivElement;
  titleWrap: HTMLDivElement;
  titleNameEl: HTMLDivElement;
  titleSubEl: HTMLDivElement;

  // Header right elements
  streamIndicator: HTMLDivElement;
  streamText: HTMLSpanElement;

  // Content elements
  emptyEl: HTMLDivElement;
  messagesEl: HTMLDivElement;

  // Footer elements
  composerWrap: HTMLDivElement;
  banner: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  actionBtn: HTMLButtonElement;
}

function buildViewDOM(options: QuickPanelAiChatViewOptions): ViewDOMElements {
  const title = options.title?.trim() || DEFAULT_TITLE;
  const subtitle = options.subtitle?.trim() || DEFAULT_SUBTITLE;
  const placeholder = options.placeholder?.trim() || DEFAULT_PLACEHOLDER;

  // ---- Header elements ----
  const brand = document.createElement('div');
  brand.className = 'qp-brand';
  brand.textContent = '\u2726'; // Star symbol

  const titleWrap = document.createElement('div');
  titleWrap.className = 'qp-title';

  const titleNameEl = document.createElement('div');
  titleNameEl.className = 'qp-title-name';
  titleNameEl.textContent = title;

  const titleSubEl = document.createElement('div');
  titleSubEl.className = 'qp-title-sub';
  titleSubEl.textContent = subtitle;

  titleWrap.append(titleNameEl, titleSubEl);

  // ---- Header right elements ----
  const streamIndicator = document.createElement('div');
  streamIndicator.className = 'qp-stream-indicator';
  streamIndicator.hidden = true;

  const streamDot = document.createElement('span');
  streamDot.className = 'qp-stream-dot ac-pulse';

  const streamText = document.createElement('span');
  streamText.textContent = 'Streaming';

  streamIndicator.append(streamDot, streamText);

  // ---- Content elements ----
  const emptyEl = document.createElement('div');
  emptyEl.className = 'qp-empty';

  const emptyIcon = document.createElement('div');
  emptyIcon.className = 'qp-empty-icon';
  emptyIcon.textContent = '\u2726';

  const emptyText = document.createElement('div');
  emptyText.className = 'qp-empty-text';
  emptyText.textContent = 'Ask about this page. Streaming replies appear here.';

  emptyEl.append(emptyIcon, emptyText);

  const messagesEl = document.createElement('div');
  messagesEl.className = 'qp-messages';

  // ---- Footer elements ----
  const composerWrap = document.createElement('div');
  composerWrap.className = 'qp-chat-composer';

  const banner = document.createElement('div');
  banner.className = 'qp-status';
  banner.hidden = true;

  const textarea = document.createElement('textarea');
  textarea.className = 'qp-textarea ac-focus-ring';
  textarea.placeholder = placeholder;
  textarea.rows = 1;

  const actions = document.createElement('div');
  actions.className = 'qp-actions';

  const actionsLeft = document.createElement('div');
  actionsLeft.className = 'qp-actions-left';

  // Keyboard hints
  const hints = [
    { key: 'Enter', label: 'Send' },
    { key: 'Shift+Enter', label: 'New line' },
    { key: 'Esc', label: 'Close' },
  ];

  for (const hint of hints) {
    const keyEl = document.createElement('span');
    keyEl.className = 'qp-kbd';
    keyEl.textContent = hint.key;

    const labelEl = document.createElement('span');
    labelEl.textContent = hint.label;

    actionsLeft.append(keyEl, labelEl);
  }

  const actionsRight = document.createElement('div');
  actionsRight.className = 'qp-actions-right';

  // Unified action button: shows send icon normally, stop icon when loading
  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'qp-icon-btn qp-icon-btn--action qp-icon-btn--primary ac-focus-ring';
  actionBtn.innerHTML = ICON_SEND;
  actionBtn.setAttribute('aria-label', 'Send message');
  actionBtn.dataset.action = 'send';

  actionsRight.append(actionBtn);
  actions.append(actionsLeft, actionsRight);
  composerWrap.append(banner, textarea, actions);

  return {
    brand,
    titleWrap,
    titleNameEl,
    titleSubEl,
    streamIndicator,
    streamText,
    emptyEl,
    messagesEl,
    composerWrap,
    banner,
    textarea,
    actionBtn,
  };
}

// ============================================================
// Main Factory
// ============================================================

/**
 * Mount the Quick Panel AI Chat View into provided mount points.
 *
 * This is designed to work with QuickPanelShell, where the Shell provides
 * the container and this view renders content into specific mount points.
 *
 * @example
 * ```typescript
 * const chatView = mountQuickPanelAiChatView({
 *   mountPoints: {
 *     header: shellElements.headerChatMount,
 *     headerRight: shellElements.headerRightChatMount,
 *     content: shellElements.contentChatMount,
 *     footer: shellElements.footerChatMount,
 *     scrollContainer: shellElements.content,
 *   },
 *   agentBridge,
 * });
 *
 * // Later: clean up
 * chatView.dispose();
 * ```
 */
export function mountQuickPanelAiChatView(
  options: QuickPanelAiChatViewOptions,
): QuickPanelAiChatViewManager {
  const disposer = new Disposer();

  const { mountPoints, agentBridge } = options;
  const defaultSubtitle = options.subtitle?.trim() || DEFAULT_SUBTITLE;

  // --------------------------------------------------------
  // State Management
  // --------------------------------------------------------

  let disposed = false;
  let requestUnsubscribe: (() => void) | null = null;
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  let loadingTextTimer: ReturnType<typeof setTimeout> | null = null;
  let currentLoadingText: string = getRandomLoadingText();

  let state: QuickPanelAiChatViewState = {
    sending: false,
    streaming: false,
    cancelling: false,
    currentRequestId: null,
    sessionId: null,
    lastStatus: null,
    lastUsage: null,
    errorMessage: null,
  };

  // --------------------------------------------------------
  // DOM Setup
  // --------------------------------------------------------

  const dom = buildViewDOM(options);

  // Mount header content
  mountPoints.header.append(dom.brand, dom.titleWrap);
  disposer.add(() => {
    dom.brand.remove();
    dom.titleWrap.remove();
  });

  // Mount header right content
  mountPoints.headerRight.append(dom.streamIndicator);
  disposer.add(() => dom.streamIndicator.remove());

  // Mount main content
  mountPoints.content.append(dom.emptyEl, dom.messagesEl);
  disposer.add(() => {
    dom.emptyEl.remove();
    dom.messagesEl.remove();
  });

  // Mount footer content
  mountPoints.footer.append(dom.composerWrap);
  disposer.add(() => dom.composerWrap.remove());

  // Message renderer - uses Shell's content as scroll container
  const renderer: QuickPanelMessageRenderer = createQuickPanelMessageRenderer({
    container: dom.messagesEl,
    scrollContainer: mountPoints.scrollContainer,
    autoScroll: true,
    autoScrollThresholdPx: 96,
  });
  disposer.add(() => renderer.dispose());

  // --------------------------------------------------------
  // Banner Management
  // --------------------------------------------------------

  function clearBannerTimer(): void {
    if (bannerTimer) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
  }

  function hideBanner(): void {
    clearBannerTimer();
    dom.banner.hidden = true;
    dom.banner.className = 'qp-status';
    dom.banner.textContent = '';
  }

  function showBanner(
    tone: 'info' | 'success' | 'warning' | 'error',
    message: string,
    autoHideMs?: number,
  ): void {
    clearBannerTimer();
    dom.banner.hidden = false;
    dom.banner.className = 'qp-status';

    if (tone === 'error') dom.banner.classList.add('qp-status--error');
    if (tone === 'success') dom.banner.classList.add('qp-status--success');
    if (tone === 'warning') dom.banner.classList.add('qp-status--warning');

    dom.banner.textContent = message;

    if (autoHideMs && autoHideMs > 0) {
      bannerTimer = setTimeout(hideBanner, autoHideMs);
    }
  }

  // --------------------------------------------------------
  // Loading Text Management
  // --------------------------------------------------------

  function clearLoadingTextTimer(): void {
    if (loadingTextTimer) {
      clearTimeout(loadingTextTimer);
      loadingTextTimer = null;
    }
  }

  function startLoadingTextTimer(): void {
    clearLoadingTextTimer();
    const scheduleNext = () => {
      const interval =
        LOADING_TEXT_MIN_INTERVAL_MS +
        Math.random() * (LOADING_TEXT_MAX_INTERVAL_MS - LOADING_TEXT_MIN_INTERVAL_MS);
      loadingTextTimer = setTimeout(() => {
        currentLoadingText = getRandomLoadingText();
        dom.streamText.textContent = currentLoadingText;
        scheduleNext();
      }, interval);
    };
    scheduleNext();
  }

  function stopLoadingTextTimer(): void {
    clearLoadingTextTimer();
  }

  // --------------------------------------------------------
  // Textarea Auto-resize
  // --------------------------------------------------------

  function resizeTextarea(): void {
    try {
      dom.textarea.style.height = 'auto';
      const targetHeight = Math.min(
        TEXTAREA_MAX_HEIGHT_PX,
        Math.max(TEXTAREA_MIN_HEIGHT_PX, dom.textarea.scrollHeight),
      );
      dom.textarea.style.height = `${targetHeight}px`;
    } catch {
      // Ignore resize errors
    }
  }

  // --------------------------------------------------------
  // UI Rendering
  // --------------------------------------------------------

  function renderEmptyState(): void {
    const hasMessages = renderer.getMessageCount() > 0;
    dom.emptyEl.hidden = hasMessages;
    dom.messagesEl.hidden = !hasMessages;
  }

  function renderHeaderSubtitle(): void {
    if (state.errorMessage) {
      dom.titleSubEl.textContent = 'Error';
      return;
    }
    if (state.streaming) {
      dom.titleSubEl.textContent = 'Streaming\u2026';
      return;
    }
    if (state.sending) {
      dom.titleSubEl.textContent = 'Sending\u2026';
      return;
    }

    const usageText = formatUsageStats(state.lastUsage);
    dom.titleSubEl.textContent = usageText ? `Last: ${usageText}` : defaultSubtitle;
  }

  function renderControls(): void {
    const inputText = dom.textarea.value.trim();
    const isLoading = state.sending || state.streaming || state.cancelling;
    const canSend = inputText.length > 0 && !isLoading;
    const canCancel = state.currentRequestId !== null && !state.cancelling;

    // Update action button state and appearance
    if (isLoading) {
      // Show stop icon when loading/streaming
      dom.actionBtn.innerHTML = ICON_STOP;
      dom.actionBtn.setAttribute('aria-label', 'Stop request');
      dom.actionBtn.dataset.action = 'stop';
      dom.actionBtn.disabled = !canCancel;
      dom.actionBtn.classList.remove('qp-icon-btn--primary');
      dom.actionBtn.classList.add('qp-icon-btn--danger');
    } else {
      // Show send icon when idle
      dom.actionBtn.innerHTML = ICON_SEND;
      dom.actionBtn.setAttribute('aria-label', 'Send message');
      dom.actionBtn.dataset.action = 'send';
      dom.actionBtn.disabled = !canSend;
      dom.actionBtn.classList.remove('qp-icon-btn--danger');
      dom.actionBtn.classList.add('qp-icon-btn--primary');
    }

    // Stream indicator with random loading text and shimmer effect
    const wasHidden = dom.streamIndicator.hidden;
    dom.streamIndicator.hidden = !isLoading;

    if (isLoading) {
      // Start timer when transitioning to loading state
      if (wasHidden) {
        currentLoadingText = getRandomLoadingText();
        startLoadingTextTimer();
      }
      dom.streamText.textContent = currentLoadingText;
      dom.streamText.classList.add('text-shimmer');
    } else {
      // Stop timer when not loading
      stopLoadingTextTimer();
      dom.streamText.classList.remove('text-shimmer');
    }

    // Allow typing while streaming; disable only during send/cancel
    dom.textarea.disabled = state.sending || state.cancelling;

    renderHeaderSubtitle();
    renderEmptyState();
  }

  function setState(patch: Partial<QuickPanelAiChatViewState>): void {
    state = { ...state, ...patch };
    renderControls();
  }

  // --------------------------------------------------------
  // Subscription Management
  // --------------------------------------------------------

  function cleanupActiveSubscription(): void {
    if (requestUnsubscribe) {
      try {
        requestUnsubscribe();
      } catch {
        // Ignore cleanup errors
      }
      requestUnsubscribe = null;
    }
  }

  // --------------------------------------------------------
  // Context Resolution
  // --------------------------------------------------------

  async function resolveContext(): Promise<QuickPanelAIContext | undefined> {
    // Try custom context provider
    try {
      if (options.getContext) {
        const provided = await options.getContext();
        if (provided && typeof provided === 'object') {
          return provided;
        }
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} getContext failed:`, err);
    }

    // Fallback to default context
    const fallback = collectDefaultContext();

    // Don't send empty context
    if (!isNonEmptyString(fallback.pageUrl) && !isNonEmptyString(fallback.selectedText)) {
      return undefined;
    }

    return fallback;
  }

  // --------------------------------------------------------
  // Request Lifecycle
  // --------------------------------------------------------

  async function sendCurrentInput(): Promise<void> {
    if (disposed) return;
    if (state.sending || state.streaming || state.cancelling) return;

    const instruction = dom.textarea.value.trim();
    if (!instruction) return;

    // Clear previous errors
    setState({ errorMessage: null, lastUsage: null, lastStatus: null });
    hideBanner();

    // Save input for restoration on failure
    const savedInput = dom.textarea.value;
    dom.textarea.value = '';
    resizeTextarea();

    setState({ sending: true });

    // Resolve context
    const context = await resolveContext();
    if (disposed) return;

    const payload: QuickPanelSendToAIPayload = {
      instruction,
      context: context ?? undefined,
    };

    // Send to agent
    const result = await agentBridge.sendToAI(payload);
    if (disposed) return;

    if (!result.success) {
      // Restore input on failure
      dom.textarea.value = savedInput;
      resizeTextarea();

      const errorMsg = truncateText(result.error, MAX_ERROR_DISPLAY_CHARS);
      setState({ sending: false, errorMessage: errorMsg });
      showBanner('error', errorMsg);
      return;
    }

    // Optimistic user message rendering
    renderer.upsert(buildLocalUserMessage(result.sessionId, result.requestId, instruction));
    renderer.scrollToBottom();

    setState({
      sending: false,
      streaming: true,
      currentRequestId: result.requestId,
      sessionId: result.sessionId,
      lastStatus: 'starting',
    });

    // Subscribe to events
    cleanupActiveSubscription();
    requestUnsubscribe = agentBridge.onRequestEvent(result.requestId, (event) => {
      if (disposed) return;
      handleRequestEvent(event);
    });
  }

  async function cancelCurrentRequest(): Promise<void> {
    if (disposed) return;
    if (!state.currentRequestId) return;
    if (state.cancelling) return;

    const requestId = state.currentRequestId;
    const sessionId = state.sessionId || undefined;

    setState({ cancelling: true });

    const result = await agentBridge.cancelRequest(requestId, sessionId);
    if (disposed) return;

    if (!result.success) {
      const errorMsg = truncateText(result.error, MAX_ERROR_DISPLAY_CHARS);
      setState({ cancelling: false, errorMessage: errorMsg });
      showBanner('error', errorMsg);
      return;
    }

    // Cancellation completion will be driven by the 'cancelled' status event
    setState({ cancelling: false });
  }

  function handleTerminal(status: AgentStatusEvent['status'], message?: string): void {
    cleanupActiveSubscription();

    setState({
      streaming: false,
      sending: false,
      cancelling: false,
      currentRequestId: null,
      sessionId: null,
      lastStatus: status,
    });

    if (status === 'completed') {
      const usageText = formatUsageStats(state.lastUsage);
      const bannerMsg = usageText ? `Completed \u2022 ${usageText}` : 'Completed';
      showBanner('success', bannerMsg, BANNER_AUTO_HIDE_MS);
      return;
    }

    if (status === 'cancelled') {
      showBanner('warning', 'Cancelled', BANNER_AUTO_HIDE_MS);
      return;
    }

    if (status === 'error') {
      const errorMsg = truncateText(
        message || state.errorMessage || 'Request failed',
        MAX_ERROR_DISPLAY_CHARS,
      );
      setState({ errorMessage: errorMsg });
      showBanner('error', errorMsg);
    }
  }

  /**
   * Handle incoming RealtimeEvent with runtime guards for malformed data.
   */
  function handleRequestEvent(event: RealtimeEvent): void {
    if (disposed) return;

    // Runtime guard: validate event structure
    if (!event || typeof event !== 'object' || !('type' in event)) {
      console.warn(`${LOG_PREFIX} Invalid event structure:`, event);
      return;
    }

    try {
      switch (event.type) {
        case 'message': {
          const msg = event.data;

          // Runtime guard: validate message structure
          if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string') {
            console.warn(`${LOG_PREFIX} Invalid message data:`, msg);
            return;
          }

          // For user messages from server, replace local optimistic message
          if (msg.role === 'user') {
            const localUserId = `local-user:${msg.requestId}`;
            renderer.remove(localUserId);
          }

          renderer.upsert(msg);

          if (msg.isStreaming === true && !msg.isFinal) {
            setState({ streaming: true });
          }
          return;
        }

        case 'status': {
          const statusData = event.data;

          // Runtime guard: validate status data
          if (
            !statusData ||
            typeof statusData !== 'object' ||
            typeof statusData.status !== 'string'
          ) {
            console.warn(`${LOG_PREFIX} Invalid status data:`, statusData);
            return;
          }

          setState({ lastStatus: statusData.status });

          if (
            statusData.status === 'starting' ||
            statusData.status === 'ready' ||
            statusData.status === 'running'
          ) {
            setState({ streaming: true });
            return;
          }

          if (isTerminalStatus(statusData.status)) {
            handleTerminal(statusData.status, statusData.message);
          }
          return;
        }

        case 'usage': {
          setState({ lastUsage: event.data });
          return;
        }

        case 'error': {
          const errorMsg = truncateText(event.error || 'Unknown error', MAX_ERROR_DISPLAY_CHARS);
          setState({ errorMessage: errorMsg });
          showBanner('error', errorMsg);

          cleanupActiveSubscription();
          setState({
            streaming: false,
            sending: false,
            cancelling: false,
            currentRequestId: null,
            sessionId: null,
            lastStatus: 'error',
          });
          return;
        }

        case 'connected':
        case 'heartbeat': {
          // These events are typically filtered by background, but handle exhaustively
          return;
        }
      }
    } catch (err) {
      // Catch any unexpected errors to prevent UI crash
      console.warn(`${LOG_PREFIX} Error handling event:`, err, event);
    }
  }

  // --------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------

  // Unified action button handler: send or stop based on current state
  disposer.listen(dom.actionBtn, 'click', () => {
    if (disposed) return;
    const action = dom.actionBtn.dataset.action;
    if (action === 'stop') {
      void cancelCurrentRequest();
    } else {
      void sendCurrentInput();
    }
  });

  disposer.listen(dom.textarea, 'input', () => {
    if (disposed) return;
    resizeTextarea();
    renderControls();
  });

  disposer.listen(dom.textarea, 'keydown', (ev: KeyboardEvent) => {
    if (disposed) return;

    // Enter sends, Shift+Enter inserts newline
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      void sendCurrentInput();
      options.onSend?.();
    }
  });

  // --------------------------------------------------------
  // Public API
  // --------------------------------------------------------

  function focusInput(): void {
    if (disposed) return;
    safeFocus(dom.textarea);
  }

  function clearMessages(): void {
    if (disposed) return;
    renderer.clear();
    hideBanner();
    setState({ lastUsage: null, lastStatus: null, errorMessage: null });
  }

  function hasMessages(): boolean {
    return renderer.getMessageCount() > 0;
  }

  function scrollToBottom(): void {
    if (disposed) return;
    renderer.scrollToBottom();
  }

  function dispose(): void {
    if (disposed) return;

    // Best-effort cancel on dispose (must be called before setting disposed = true)
    const requestIdToCancel = state.currentRequestId;
    const sessionIdToCancel = state.sessionId || undefined;

    disposed = true;

    // Cancel request directly without going through cancelCurrentRequest
    // (which checks `disposed` flag)
    if (requestIdToCancel) {
      void agentBridge.cancelRequest(requestIdToCancel, sessionIdToCancel);
    }

    cleanupActiveSubscription();
    clearBannerTimer();
    clearLoadingTextTimer();
    disposer.dispose();
  }

  // --------------------------------------------------------
  // Initialization
  // --------------------------------------------------------

  resizeTextarea();
  renderControls();

  // Fetch and display project name in subtitle
  void (async () => {
    try {
      const projectInfo = await agentBridge.getProjectInfo();
      if (projectInfo.success && projectInfo.projectName) {
        dom.titleSubEl.textContent = projectInfo.projectName;
      }
    } catch {
      // Ignore errors, keep default subtitle
    }
  })();

  if (options.autoFocus !== false) {
    focusInput();
  }

  return {
    getState: () => ({ ...state }),
    focusInput,
    clearMessages,
    hasMessages,
    scrollToBottom,
    cancelCurrentRequest,
    dispose,
  };
}
