/**
 * Quick Panel AI Chat Panel
 *
 * A complete AI chat interface for Quick Panel, featuring:
 * - Streaming message display with real-time updates
 * - Liquid Glass design with AgentChat token compatibility
 * - Full keyboard navigation (Enter to send, Esc to close)
 * - Request lifecycle management (send, cancel, cleanup)
 * - Auto-context collection (page URL, text selection)
 *
 * This component is framework-agnostic and renders directly to Shadow DOM
 * for optimal isolation and performance in content script context.
 *
 * **Architecture Note (v2):**
 * This module now acts as a **backward-compatible wrapper** that internally uses:
 * - `QuickPanelShell` as the container (overlay/panel/header/content/footer)
 * - `QuickPanelAiChatView` as the chat view content
 *
 * For new implementations, prefer using `mountQuickPanelShell` + `mountQuickPanelAiChatView`
 * directly for better integration with the search/chat dual-view architecture.
 */

import type { QuickPanelAIContext } from '@/common/message-types';
import type { QuickPanelAgentBridge } from '../core/agent-bridge';
import { Disposer } from '@/entrypoints/web-editor-v2/utils/disposables';
import { mountQuickPanelShell, type QuickPanelShellManager } from './panel-shell';
import {
  mountQuickPanelAiChatView,
  type QuickPanelAiChatViewManager,
  type QuickPanelAiChatViewState,
} from './ai-chat-view';

// ============================================================
// Types
// ============================================================

export interface QuickPanelAiChatPanelOptions {
  /** Shadow DOM mount point (typically `elements.root` from shadow-host.ts) */
  mount: HTMLElement;
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

  /** Called when user requests to close the panel */
  onRequestClose?: () => void;
}

/**
 * State exposed by the AI Chat Panel.
 * Re-exports the view state for backward compatibility.
 */
export type QuickPanelAiChatPanelState = QuickPanelAiChatViewState;

export interface QuickPanelAiChatPanelManager {
  getState: () => QuickPanelAiChatPanelState;
  focusInput: () => void;
  clearMessages: () => void;
  close: () => void;
  dispose: () => void;
}

// ============================================================
// Main Factory
// ============================================================

/**
 * Mount the Quick Panel AI Chat interface.
 *
 * This is a backward-compatible wrapper that internally uses Shell + View architecture.
 * The Shell provides the container (overlay/panel), and the View renders chat content.
 *
 * @example
 * ```typescript
 * const chatPanel = mountQuickPanelAiChatPanel({
 *   mount: shadowHostElements.root,
 *   agentBridge,
 *   onRequestClose: () => quickPanel.hide(),
 * });
 *
 * // Later: clean up
 * chatPanel.dispose();
 * ```
 */
export function mountQuickPanelAiChatPanel(
  options: QuickPanelAiChatPanelOptions,
): QuickPanelAiChatPanelManager {
  const disposer = new Disposer();

  let disposed = false;
  let shell: QuickPanelShellManager | null = null;
  let chatView: QuickPanelAiChatViewManager | null = null;

  // --------------------------------------------------------
  // Mount Shell (container)
  // --------------------------------------------------------

  shell = mountQuickPanelShell({
    mount: options.mount,
    defaultView: 'chat', // AI Chat Panel always shows chat view
    ariaLabel: options.title ?? 'Agent',
    closeOnBackdropClick: true,
    onRequestClose: (reason) => {
      // Forward close request to caller
      close();
    },
  });
  disposer.add(() => shell?.dispose());

  const shellElements = shell.getElements();
  if (!shellElements) {
    throw new Error('[QuickPanelAiChatPanel] Shell mount failed - no elements returned');
  }

  // --------------------------------------------------------
  // Mount Chat View (content)
  // --------------------------------------------------------

  chatView = mountQuickPanelAiChatView({
    mountPoints: {
      header: shellElements.headerChatMount,
      headerRight: shellElements.headerRightChatMount,
      content: shellElements.contentChatMount,
      footer: shellElements.footerChatMount,
      scrollContainer: shellElements.content,
    },
    agentBridge: options.agentBridge,
    title: options.title,
    subtitle: options.subtitle,
    placeholder: options.placeholder,
    autoFocus: options.autoFocus,
    getContext: options.getContext,
  });
  disposer.add(() => chatView?.dispose());

  // --------------------------------------------------------
  // Global ESC handler
  // Shell handles close button and backdrop click, but we need
  // global ESC for keyboard accessibility when focus is elsewhere
  // --------------------------------------------------------

  const handleGlobalKeydown = (ev: KeyboardEvent) => {
    if (disposed) return;

    if (ev.key === 'Escape' && !ev.isComposing) {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', handleGlobalKeydown, true);
  disposer.add(() => document.removeEventListener('keydown', handleGlobalKeydown, true));

  // --------------------------------------------------------
  // Public API
  // --------------------------------------------------------

  function getState(): QuickPanelAiChatPanelState {
    if (!chatView) {
      return {
        sending: false,
        streaming: false,
        cancelling: false,
        currentRequestId: null,
        sessionId: null,
        lastStatus: null,
        lastUsage: null,
        errorMessage: null,
      };
    }
    return chatView.getState();
  }

  function focusInput(): void {
    if (disposed || !chatView) return;
    chatView.focusInput();
  }

  function clearMessages(): void {
    if (disposed || !chatView) return;
    chatView.clearMessages();
  }

  function close(): void {
    if (disposed) return;

    // Best-effort cancel on close
    void chatView?.cancelCurrentRequest();

    try {
      options.onRequestClose?.();
    } catch {
      // Best-effort callback
    }

    dispose();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    disposer.dispose();
    shell = null;
    chatView = null;
  }

  return {
    getState,
    focusInput,
    clearMessages,
    close,
    dispose,
  };
}
