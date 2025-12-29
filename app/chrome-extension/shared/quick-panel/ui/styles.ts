/**
 * Quick Panel AI Chat Styles
 *
 * This stylesheet is injected into the Quick Panel's Shadow DOM (content script).
 * It intentionally reuses AgentChat token names (--ac-*) to maintain visual consistency
 * with the sidepanel AgentChat component.
 *
 * Design System:
 * - Source of truth: app/chrome-extension/entrypoints/sidepanel/styles/agent-chat.css
 * - This file extracts a minimal token + utility subset for content script use
 * - Liquid Glass styling follows quick-panel-prd.md V6 spec
 *
 * Note: Content Script Shadow DOM cannot directly import sidepanel CSS (not web_accessible).
 * We maintain a synced subset here to balance visual consistency with bundle size.
 */

export const QUICK_PANEL_STYLES = /* css */ `
  /* ============================================================
   * Reset & Box Sizing
   * ============================================================ */

  :host {
    all: initial;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  /* ============================================================
   * Root Container & Theme Tokens
   * Subset of AgentChat tokens for Quick Panel use
   * ============================================================ */

  .qp-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    font-family: var(--ac-font-body, ui-sans-serif, system-ui);
    color: var(--ac-text, #111827);
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .qp-root.agent-theme {
    /* ===========================================
     * Font Stacks
     * =========================================== */
    --ac-font-sans:
      'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial,
      'Apple Color Emoji', 'Segoe UI Emoji';
    --ac-font-serif: 'Newsreader', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
    --ac-font-mono:
      'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
    --ac-font-grotesk:
      'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial;

    --ac-font-body: var(--ac-font-sans);
    --ac-font-heading: var(--ac-font-serif);
    --ac-font-code: var(--ac-font-mono);

    /* ===========================================
     * Geometry & Spacing
     * =========================================== */
    --ac-border-width: 1px;
    --ac-border-width-strong: 2px;
    --ac-radius-container: 0px;
    --ac-radius-card: 12px;
    --ac-radius-inner: 8px;
    --ac-radius-button: 8px;

    /* ===========================================
     * Motion
     * =========================================== */
    --ac-motion-fast: 120ms;
    --ac-motion-normal: 180ms;

    /* ===========================================
     * Warm Editorial Theme (Default)
     * =========================================== */
    --ac-bg: transparent;
    --ac-bg-pattern: none;
    --ac-bg-pattern-size: 16px 16px;

    --ac-header-bg: rgba(253, 252, 248, 0.95);
    --ac-header-border: rgba(245, 245, 244, 0.5);

    --ac-surface: #ffffff;
    --ac-surface-muted: #f2f0eb;
    --ac-surface-inset: #f2f0eb;

    --ac-text: #1a1a1a;
    --ac-text-muted: #6e6e6e;
    --ac-text-subtle: #a8a29e;
    --ac-text-inverse: #ffffff;
    --ac-text-placeholder: #a8a29e;

    --ac-border: #e7e5e4;
    --ac-border-strong: #d6d3d1;

    --ac-hover-bg: #f5f5f4;
    --ac-hover-bg-subtle: #fafaf9;

    --ac-accent: #d97757;
    --ac-accent-hover: #c4664a;
    --ac-accent-subtle: rgba(217, 119, 87, 0.12);
    --ac-accent-contrast: #ffffff;

    --ac-link: var(--ac-accent);
    --ac-link-hover: var(--ac-accent-hover);

    --ac-selection-bg: #ffedd5;
    --ac-selection-text: #7c2d12;

    --ac-shadow-card: 0 1px 3px rgba(0, 0, 0, 0.08);
    --ac-shadow-float: 0 4px 20px -2px rgba(0, 0, 0, 0.05);

    --ac-focus-ring: rgba(214, 211, 209, 0.9);

    --ac-timeline-node-pulse-shadow:
      0 0 0 2px rgba(217, 119, 87, 0.25), 0 0 12px rgba(217, 119, 87, 0.2);

    /* Status Colors */
    --ac-success: #22c55e;
    --ac-warning: #f59e0b;
    --ac-danger: #ef4444;

    /* Scrollbar */
    --ac-scrollbar-size: 4px;
    --ac-scrollbar-thumb: rgba(0, 0, 0, 0.25);
    --ac-scrollbar-thumb-hover: rgba(0, 0, 0, 0.4);

    /* ===========================================
     * Liquid Glass Tokens (Quick Panel Specific)
     * =========================================== */
    --qp-glass-bg: rgba(255, 255, 255, 0.25);
    --qp-glass-border: rgba(255, 255, 255, 0.4);
    --qp-glass-shadow:
      0 8px 32px rgba(0, 0, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      inset 0 -1px 0 rgba(255, 255, 255, 0.1);
    --qp-glass-divider: rgba(255, 255, 255, 0.28);
    --qp-glass-input-bg: rgba(255, 255, 255, 0.22);
    --qp-glass-input-border: rgba(255, 255, 255, 0.35);
  }

  /* ===========================================
   * Dark Console Theme
   * =========================================== */
  .qp-root.agent-theme[data-agent-theme='dark-console'] {
    --ac-font-body: var(--ac-font-mono);
    --ac-font-heading: var(--ac-font-mono);
    --ac-font-code: var(--ac-font-mono);

    --ac-surface: #0f1117;
    --ac-surface-muted: #0a0c10;
    --ac-surface-inset: #1a1d26;

    --ac-text: #e5e7eb;
    --ac-text-muted: #9ca3af;
    --ac-text-subtle: #6b7280;
    --ac-text-inverse: #0a0c10;
    --ac-text-placeholder: #4b5563;

    --ac-border: #1f2937;
    --ac-border-strong: #374151;

    --ac-hover-bg: rgba(255, 255, 255, 0.06);
    --ac-hover-bg-subtle: rgba(255, 255, 255, 0.04);

    --ac-accent: #d97757;
    --ac-accent-hover: #e8956f;
    --ac-accent-subtle: rgba(217, 119, 87, 0.18);
    --ac-accent-contrast: #ffffff;

    --ac-focus-ring: rgba(217, 119, 87, 0.4);
    --ac-timeline-node-pulse-shadow:
      0 0 0 2px rgba(217, 119, 87, 0.35), 0 0 14px rgba(217, 119, 87, 0.25);

    --ac-scrollbar-thumb: rgba(255, 255, 255, 0.12);
    --ac-scrollbar-thumb-hover: rgba(255, 255, 255, 0.22);

    --qp-glass-bg: rgba(15, 23, 42, 0.6);
    --qp-glass-border: rgba(255, 255, 255, 0.1);
    --qp-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    --qp-glass-divider: rgba(255, 255, 255, 0.12);
    --qp-glass-input-bg: rgba(255, 255, 255, 0.06);
    --qp-glass-input-border: rgba(255, 255, 255, 0.12);
  }

  .qp-root ::selection {
    background: var(--ac-selection-bg);
    color: var(--ac-selection-text);
  }

  /* ============================================================
   * Utility Classes (AgentChat Subset)
   * ============================================================ */

  /* Scrollbar Styling */
  .qp-root .ac-scroll {
    scrollbar-width: thin;
    scrollbar-color: var(--ac-scrollbar-thumb) transparent;
  }

  .qp-root .ac-scroll::-webkit-scrollbar {
    width: var(--ac-scrollbar-size);
    height: var(--ac-scrollbar-size);
  }

  .qp-root .ac-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .qp-root .ac-scroll::-webkit-scrollbar-thumb {
    background-color: var(--ac-scrollbar-thumb);
    border-radius: 999px;
  }

  .qp-root .ac-scroll::-webkit-scrollbar-thumb:hover {
    background-color: var(--ac-scrollbar-thumb-hover);
  }

  /* Focus Ring */
  .qp-root .ac-focus-ring:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--ac-focus-ring);
  }

  /* Button Base */
  .qp-root .ac-btn {
    transition:
      background-color var(--ac-motion-fast),
      color var(--ac-motion-fast);
  }

  .qp-root .ac-btn:hover {
    background-color: var(--ac-hover-bg);
  }

  /* Pulse Animation (Streaming Indicator) */
  @keyframes ac-pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .qp-root .ac-pulse {
    animation: ac-pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .qp-root .ac-pulse {
      animation: none;
    }
  }

  /* Text Shimmer (Streaming Status) */
  .qp-root .text-shimmer {
    background: linear-gradient(
      90deg,
      var(--ac-accent, #d97757) 0%,
      var(--ac-accent-hover, #ffcab0) 50%,
      var(--ac-accent, #d97757) 100%
    );
    background-size: 200% auto;
    color: transparent;
    -webkit-background-clip: text;
    background-clip: text;
    animation: ac-shimmer 3s linear infinite;
  }

  @keyframes ac-shimmer {
    to {
      background-position: 200% center;
    }
  }

  /* ============================================================
   * Liquid Glass Panel (PRD V6)
   * ============================================================ */

  .qp-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    pointer-events: auto;
  }

  .qp-panel {
    width: min(760px, calc(100vw - 48px));
    max-height: min(720px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    border-radius: 24px;
    overflow: hidden;
    pointer-events: auto;

    background: var(--qp-glass-bg);
    backdrop-filter: blur(40px) saturate(180%);
    -webkit-backdrop-filter: blur(40px) saturate(180%);
    border: 1px solid var(--qp-glass-border);
    box-shadow: var(--qp-glass-shadow);
  }

  /* Shimmer Effect on Glass */
  .qp-liquid-shimmer {
    position: relative;
    overflow: hidden;
  }

  .qp-liquid-shimmer::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.1),
      transparent
    );
    animation: qp-shimmer 3s infinite;
    pointer-events: none;
  }

  @keyframes qp-shimmer {
    0% {
      left: -100%;
    }
    100% {
      left: 100%;
    }
  }

  /* ============================================================
   * AI Chat Layout Components
   * ============================================================ */

  /* Header */
  .qp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--qp-glass-divider);
  }

  .qp-header-left {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .qp-brand {
    width: 34px;
    height: 34px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.35);
    font-size: 16px;
  }

  .qp-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .qp-title-name {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.2px;
    color: var(--ac-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qp-title-sub {
    font-size: 11px;
    color: var(--ac-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qp-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }

  .qp-stream-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--ac-text-muted);
    user-select: none;
  }

  .qp-stream-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ac-accent);
    box-shadow: var(--ac-timeline-node-pulse-shadow);
  }

  /* Buttons */
  .qp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid var(--qp-glass-divider);
    background: rgba(255, 255, 255, 0.14);
    color: var(--ac-text);
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    font-family: inherit;
  }

  .qp-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .qp-btn--primary {
    background: var(--ac-accent);
    border-color: rgba(0, 0, 0, 0.08);
    color: var(--ac-accent-contrast);
  }

  .qp-btn--danger {
    background: var(--ac-danger);
    border-color: rgba(0, 0, 0, 0.08);
    color: #ffffff;
  }

  /* Content Area */
  .qp-content {
    flex: 1;
    overflow: auto;
    padding: 14px;
    min-height: 0;
  }

  .qp-messages {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Message Bubbles */
  .qp-msg {
    display: flex;
    gap: 10px;
  }

  .qp-msg--user {
    justify-content: flex-end;
  }

  .qp-msg--assistant {
    justify-content: flex-start;
  }

  .qp-bubble {
    max-width: 90%;
    border-radius: var(--ac-radius-card);
    border: var(--ac-border-width) solid var(--ac-border);
    box-shadow: var(--ac-shadow-card);
    padding: 10px 12px;
    background: var(--ac-surface);
  }

  .qp-bubble--user {
    background: color-mix(in srgb, var(--ac-accent-subtle) 80%, transparent);
    border-color: color-mix(in srgb, var(--ac-border) 70%, transparent);
  }

  .qp-msg-text {
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ac-text);
  }

  .qp-msg-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 6px;
    font-size: 10px;
    color: var(--ac-text-subtle);
  }

  .qp-msg-meta code {
    font-family: var(--ac-font-code);
    font-size: 10px;
  }

  .qp-msg-stream-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ac-accent);
    box-shadow: var(--ac-timeline-node-pulse-shadow);
    flex: none;
  }

  /* Status Indicators */
  .qp-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 999px;
    border: var(--ac-border-width) solid var(--ac-border);
    background: rgba(255, 255, 255, 0.14);
    color: var(--ac-text-muted);
    font-size: 11px;
    user-select: none;
    align-self: center;
  }

  .qp-status--error {
    border-color: color-mix(in srgb, var(--ac-danger) 55%, var(--ac-border));
    color: var(--ac-danger);
    background: color-mix(in srgb, var(--ac-danger) 12%, transparent);
  }

  .qp-status--success {
    border-color: color-mix(in srgb, var(--ac-success) 55%, var(--ac-border));
    color: color-mix(in srgb, var(--ac-success) 85%, var(--ac-text));
    background: color-mix(in srgb, var(--ac-success) 10%, transparent);
  }

  .qp-status--warning {
    border-color: color-mix(in srgb, var(--ac-warning) 55%, var(--ac-border));
    color: color-mix(in srgb, var(--ac-warning) 85%, var(--ac-text));
    background: color-mix(in srgb, var(--ac-warning) 10%, transparent);
  }

  /* Composer */
  .qp-composer {
    padding: 12px 14px;
    border-top: 1px solid var(--qp-glass-divider);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .qp-textarea {
    width: 100%;
    min-height: 42px;
    max-height: 160px;
    resize: none;
    padding: 10px 10px;
    border-radius: var(--ac-radius-card);
    border: 1px solid var(--qp-glass-input-border);
    background: var(--qp-glass-input-bg);
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    font-size: 13px;
    line-height: 1.35;
    outline: none;
  }

  .qp-textarea::placeholder {
    color: var(--ac-text-placeholder);
  }

  .qp-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .qp-actions-left {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: var(--ac-text-subtle);
    user-select: none;
  }

  .qp-actions-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .qp-kbd {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--qp-glass-divider);
    background: rgba(255, 255, 255, 0.12);
    padding: 4px 8px;
    border-radius: 999px;
    font-family: var(--ac-font-code);
    font-size: 10px;
    color: var(--ac-text-muted);
  }

  /* Empty State */
  .qp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
    text-align: center;
    color: var(--ac-text-muted);
  }

  .qp-empty-icon {
    font-size: 32px;
    opacity: 0.6;
  }

  .qp-empty-text {
    font-size: 13px;
    line-height: 1.5;
  }

  /* ============================================================
   * Search UI (Phase 1)
   * ============================================================ */

  /* Search Input Container */
  .qp-search {
    min-width: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Scope Chip */
  .qp-scope-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--qp-glass-divider);
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 6px 10px;
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    flex: none;
    transition: background-color var(--ac-motion-fast);
  }

  .qp-scope-chip:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .qp-scope-chip__icon {
    font-size: 12px;
    line-height: 1;
  }

  .qp-scope-chip__label {
    font-weight: 600;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .qp-scope-chip__prefix {
    font-family: var(--ac-font-code);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid var(--qp-glass-divider);
    background: rgba(255, 255, 255, 0.1);
    color: var(--ac-text-muted);
  }

  /* Search Input */
  .qp-search-input {
    flex: 1;
    min-width: 0;
    height: 38px;
    padding: 0 12px;
    border-radius: var(--ac-radius-card);
    border: 1px solid var(--qp-glass-input-border);
    background: var(--qp-glass-input-bg);
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    font-size: 14px;
    line-height: 1.2;
    outline: none;
    transition: border-color var(--ac-motion-fast);
  }

  .qp-search-input:focus {
    border-color: var(--ac-accent);
  }

  .qp-search-input::placeholder {
    color: var(--ac-text-placeholder);
  }

  /* Icon Button (Clear, etc.) */
  .qp-icon-btn {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--qp-glass-divider);
    background: rgba(255, 255, 255, 0.12);
    color: var(--ac-text-muted);
    border-radius: 10px;
    cursor: pointer;
    user-select: none;
    font-family: var(--ac-font-body);
    font-size: 16px;
    line-height: 1;
    flex: none;
    transition: background-color var(--ac-motion-fast), color var(--ac-motion-fast);
  }

  .qp-icon-btn:hover {
    background: rgba(255, 255, 255, 0.18);
    color: var(--ac-text);
  }

  /* Quick Entries Grid */
  .qp-entries {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 10px 2px;
  }

  .qp-entry {
    border: 1px solid var(--qp-glass-divider);
    background: rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 14px 10px;
    cursor: pointer;
    user-select: none;
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transition:
      background-color var(--ac-motion-fast),
      border-color var(--ac-motion-fast),
      transform var(--ac-motion-fast);
  }

  .qp-entry:hover {
    background: rgba(255, 255, 255, 0.16);
    transform: translateY(-1px);
  }

  .qp-entry:active {
    transform: translateY(0);
  }

  .qp-entry:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .qp-entry[data-active='true'] {
    border-color: color-mix(in srgb, var(--ac-accent) 50%, var(--qp-glass-divider));
    background: color-mix(in srgb, var(--ac-accent-subtle) 60%, rgba(255, 255, 255, 0.08));
  }

  .qp-entry__icon {
    width: 40px;
    height: 40px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.22);
    font-size: 16px;
  }

  .qp-entry__label {
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.2px;
  }

  .qp-entry__prefix {
    font-family: var(--ac-font-code);
    font-size: 10px;
    color: var(--ac-text-muted);
    border: 1px solid var(--qp-glass-divider);
    border-radius: 999px;
    padding: 2px 8px;
    background: rgba(255, 255, 255, 0.08);
  }

  /* View Mount Points */
  .qp-header-mount,
  .qp-header-right-mount,
  .qp-content-mount,
  .qp-footer-mount {
    display: contents;
  }

  .qp-header-mount[hidden],
  .qp-header-right-mount[hidden],
  .qp-content-mount[hidden],
  .qp-footer-mount[hidden] {
    display: none;
  }

  /* Footer Hints */
  .qp-footer-hints {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 8px 0;
    font-size: 11px;
    color: var(--ac-text-muted);
  }

  .qp-footer-hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* ============================================================
   * Markdown Content Styles (for markstream-vue)
   * ============================================================ */

  .qp-markdown-content {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ac-text);
  }

  .qp-markdown-content pre {
    background-color: var(--ac-surface-muted);
    border: var(--ac-border-width) solid var(--ac-border);
    border-radius: var(--ac-radius-inner);
    padding: 12px;
    overflow-x: auto;
    margin: 0.5em 0;
  }

  .qp-markdown-content code {
    font-family: var(--ac-font-code);
    font-size: 0.875em;
    color: var(--ac-text);
  }

  .qp-markdown-content :not(pre) > code {
    background-color: var(--ac-surface-muted);
    padding: 0.125em 0.25em;
    border-radius: 4px;
  }

  .qp-markdown-content p {
    margin: 0.5em 0;
  }

  .qp-markdown-content p:first-child {
    margin-top: 0;
  }

  .qp-markdown-content p:last-child {
    margin-bottom: 0;
  }

  .qp-markdown-content ul,
  .qp-markdown-content ol {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .qp-markdown-content li {
    margin: 0.25em 0;
  }

  .qp-markdown-content h1,
  .qp-markdown-content h2,
  .qp-markdown-content h3,
  .qp-markdown-content h4,
  .qp-markdown-content h5,
  .qp-markdown-content h6 {
    margin: 0.75em 0 0.5em;
    font-weight: 600;
    line-height: 1.3;
  }

  .qp-markdown-content h1 { font-size: 1.5em; }
  .qp-markdown-content h2 { font-size: 1.3em; }
  .qp-markdown-content h3 { font-size: 1.15em; }
  .qp-markdown-content h4 { font-size: 1em; }

  .qp-markdown-content blockquote {
    border-left: 3px solid var(--ac-border-strong);
    padding-left: 1em;
    margin: 0.5em 0;
    color: var(--ac-text-muted);
  }

  .qp-markdown-content a {
    color: var(--ac-link);
    text-decoration: underline;
  }

  .qp-markdown-content a:hover {
    color: var(--ac-link-hover);
  }

  .qp-markdown-content table {
    border-collapse: collapse;
    margin: 0.5em 0;
    width: 100%;
    font-size: 0.9em;
  }

  .qp-markdown-content th,
  .qp-markdown-content td {
    border: var(--ac-border-width) solid var(--ac-border);
    padding: 0.5em;
    text-align: left;
  }

  .qp-markdown-content th {
    background-color: var(--ac-surface-muted);
    font-weight: 600;
  }

  .qp-markdown-content hr {
    border: none;
    border-top: var(--ac-border-width) solid var(--ac-border);
    margin: 1em 0;
  }

  .qp-markdown-content img {
    max-width: 100%;
    height: auto;
    border-radius: var(--ac-radius-inner);
  }

  .qp-markdown-content strong {
    font-weight: 600;
  }

  .qp-markdown-content em {
    font-style: italic;
  }
`;
