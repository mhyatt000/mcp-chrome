/**
 * Quick Panel Page Tools
 *
 * Implements Phase 10 "page tools" as best-effort, reversible toggles:
 * - Reader Mode (overlay, no page DOM rewrite)
 * - Zen Mode (hide common distractions via CSS)
 * - Force Dark (simple invert-based darkening)
 * - Allow Copy (override user-select + stop common blocking events)
 * - Privacy Curtain (full-page masking overlay for screen sharing)
 *
 * 中文说明（设计理由）：
 * 这些能力采用“overlay + attribute + injected CSS”的策略，避免直接重写原页面 DOM。
 * 这样可以做到可逆（关闭即恢复）、低侵入（不污染页面布局），并在受限页面上保持 best-effort 失败隔离。
 */

import { TOOL_MESSAGE_TYPES, type QuickPanelPageCommandResponse } from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelPageTools]';

// ============================================================
// Constants
// ============================================================

// Keep below Quick Panel overlay (2147483647).
const PAGE_TOOL_Z_INDEX = '2147483646';

const READER_HOST_ID = '__mcp_qp_reader_host__';
const PRIVACY_CURTAIN_HOST_ID = '__mcp_qp_privacy_curtain_host__';

const ZEN_ATTR = 'data-mcp-qp-zen';
const FORCE_DARK_ATTR = 'data-mcp-qp-force-dark';
const ALLOW_COPY_ATTR = 'data-mcp-qp-allow-copy';

const ZEN_CSS = /* css */ `
  /* Quick Panel Zen Mode (best-effort) */
  body[${ZEN_ATTR}] header,
  body[${ZEN_ATTR}] nav,
  body[${ZEN_ATTR}] footer,
  body[${ZEN_ATTR}] aside,
  body[${ZEN_ATTR}] [role='banner'],
  body[${ZEN_ATTR}] [role='navigation'],
  body[${ZEN_ATTR}] [role='complementary'],
  body[${ZEN_ATTR}] [aria-label*='cookie' i],
  body[${ZEN_ATTR}] [id*='cookie' i],
  body[${ZEN_ATTR}] [class*='cookie' i],
  body[${ZEN_ATTR}] [class*='advert' i],
  body[${ZEN_ATTR}] [id*='advert' i],
  body[${ZEN_ATTR}] [class*='ads' i],
  body[${ZEN_ATTR}] [id*='ads' i],
  body[${ZEN_ATTR}] [class*='sidebar' i],
  body[${ZEN_ATTR}] [id*='sidebar' i] {
    display: none !important;
  }

  body[${ZEN_ATTR}] {
    scroll-behavior: auto !important;
  }
`;

const FORCE_DARK_CSS = /* css */ `
  /* Quick Panel Force Dark (best-effort) */
  body[${FORCE_DARK_ATTR}] {
    filter: invert(1) hue-rotate(180deg) !important;
    background: #0b0b0b !important;
  }

  /* Re-invert media so images/videos look natural-ish. */
  body[${FORCE_DARK_ATTR}] img,
  body[${FORCE_DARK_ATTR}] video,
  body[${FORCE_DARK_ATTR}] svg,
  body[${FORCE_DARK_ATTR}] canvas,
  body[${FORCE_DARK_ATTR}] picture {
    filter: invert(1) hue-rotate(180deg) !important;
  }
`;

const ALLOW_COPY_CSS = /* css */ `
  /* Quick Panel Allow Copy (best-effort) */
  body[${ALLOW_COPY_ATTR}] * {
    user-select: text !important;
    -webkit-user-select: text !important;
    -webkit-touch-callout: default !important;
  }
`;

// ============================================================
// Helpers
// ============================================================

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function toggleBodyAttribute(tabId: number, attr: string, css: string): Promise<void> {
  await chrome.scripting.insertCSS({ target: { tabId }, css });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (a: string) => {
      try {
        const body = document.body;
        if (!body) return;
        if (body.hasAttribute(a)) body.removeAttribute(a);
        else body.setAttribute(a, '');
      } catch {
        // Best-effort
      }
    },
    args: [attr],
  });
}

async function ensureWebFetcherHelper(tabId: number): Promise<void> {
  // Try a lightweight ping first.
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: 'search_tabs_content_ping' });
    if (resp && isRecord(resp) && resp.status === 'pong') return;
  } catch {
    // Fall through to injection
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['inject-scripts/web-fetcher-helper.js'],
  });
}

async function closeOverlayHost(tabId: number, hostId: string, stateKey: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (id: string, key: string) => {
      try {
        const win = window as any;
        const state = win[key];
        if (state && typeof state.close === 'function') {
          state.close();
          return;
        }

        const existing = document.getElementById(id);
        existing?.remove();
      } catch {
        // Best-effort
      }
    },
    args: [hostId, stateKey],
  });
}

// ============================================================
// Public API
// ============================================================

export async function toggleQuickPanelZenMode(
  tabId: number,
): Promise<QuickPanelPageCommandResponse> {
  try {
    await toggleBodyAttribute(tabId, ZEN_ATTR, ZEN_CSS);
    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to toggle zen mode:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to toggle zen mode' };
  }
}

export async function toggleQuickPanelForceDark(
  tabId: number,
): Promise<QuickPanelPageCommandResponse> {
  try {
    await toggleBodyAttribute(tabId, FORCE_DARK_ATTR, FORCE_DARK_CSS);
    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to toggle force dark:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to toggle force dark' };
  }
}

export async function toggleQuickPanelAllowCopy(
  tabId: number,
): Promise<QuickPanelPageCommandResponse> {
  const stateKey = '__mcp_qp_allow_copy_state__';

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, css: ALLOW_COPY_CSS });

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (attr: string, key: string) => {
        try {
          const body = document.body;
          if (!body) return;

          const win = window as any;
          const enabled = body.hasAttribute(attr);

          if (enabled) {
            body.removeAttribute(attr);
            const state = win[key];
            if (state && typeof state.handler === 'function' && Array.isArray(state.types)) {
              for (const t of state.types) {
                try {
                  document.removeEventListener(t, state.handler, true);
                } catch {
                  // Best-effort
                }
              }
            }
            delete win[key];
            return;
          }

          body.setAttribute(attr, '');

          const handler = (event: Event) => {
            try {
              event.stopImmediatePropagation();
            } catch {
              // Best-effort
            }
          };

          const types = ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'];
          for (const t of types) {
            try {
              document.addEventListener(t, handler, true);
            } catch {
              // Best-effort
            }
          }

          win[key] = { handler, types };
        } catch {
          // Best-effort
        }
      },
      args: [ALLOW_COPY_ATTR, stateKey],
    });

    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to toggle allow copy:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to toggle allow copy' };
  }
}

export async function toggleQuickPanelPrivacyCurtain(
  tabId: number,
): Promise<QuickPanelPageCommandResponse> {
  const stateKey = '__mcp_qp_privacy_curtain_state__';

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (hostId: string) => Boolean(document.getElementById(hostId)),
      args: [PRIVACY_CURTAIN_HOST_ID],
    });

    if (normalizeBoolean(result)) {
      await closeOverlayHost(tabId, PRIVACY_CURTAIN_HOST_ID, stateKey);
      return { success: true };
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (hostId: string, key: string, zIndex: string) => {
        try {
          const root = document.documentElement;
          if (!root) return;

          if (document.getElementById(hostId)) return;

          const host = document.createElement('div');
          host.id = hostId;
          host.style.position = 'fixed';
          host.style.inset = '0';
          host.style.zIndex = zIndex;
          host.style.pointerEvents = 'auto';
          root.appendChild(host);

          const shadow = host.attachShadow({ mode: 'open' });

          const style = document.createElement('style');
          style.textContent = `
            :host { all: initial; }
            .backdrop {
              position: fixed;
              inset: 0;
              background: rgba(0, 0, 0, 0.78);
              backdrop-filter: blur(14px);
              -webkit-backdrop-filter: blur(14px);
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
            }
            .panel {
              max-width: 560px;
              width: 100%;
              color: rgba(255, 255, 255, 0.92);
              font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial,
                'Apple Color Emoji', 'Segoe UI Emoji';
              background: rgba(17, 24, 39, 0.72);
              border: 1px solid rgba(255, 255, 255, 0.14);
              border-radius: 14px;
              padding: 18px 18px 14px;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
            }
            .titleRow {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              margin-bottom: 10px;
            }
            .title {
              font-size: 14px;
              font-weight: 700;
              letter-spacing: 0.2px;
            }
            .btn {
              all: unset;
              cursor: pointer;
              padding: 6px 10px;
              border-radius: 999px;
              border: 1px solid rgba(255, 255, 255, 0.16);
              background: rgba(255, 255, 255, 0.08);
              font-size: 12px;
            }
            .hint {
              font-size: 12px;
              opacity: 0.88;
              line-height: 1.5;
            }
            .kbd {
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
                'Courier New', monospace;
              font-size: 12px;
              padding: 2px 6px;
              border-radius: 6px;
              border: 1px solid rgba(255, 255, 255, 0.18);
              background: rgba(0, 0, 0, 0.18);
            }
          `;

          const backdrop = document.createElement('div');
          backdrop.className = 'backdrop';

          const panel = document.createElement('div');
          panel.className = 'panel';

          const titleRow = document.createElement('div');
          titleRow.className = 'titleRow';

          const title = document.createElement('div');
          title.className = 'title';
          title.textContent = 'Privacy curtain';

          const closeBtn = document.createElement('button');
          closeBtn.className = 'btn';
          closeBtn.type = 'button';
          closeBtn.textContent = 'Hide';
          closeBtn.setAttribute('aria-label', 'Hide privacy curtain');

          titleRow.append(title, closeBtn);

          const hint = document.createElement('div');
          hint.className = 'hint';
          hint.innerHTML = `Screen sharing safe mode is active. Press <span class="kbd">Esc</span> to hide.`;

          panel.append(titleRow, hint);
          backdrop.append(panel);

          shadow.append(style, backdrop);

          const close = () => {
            try {
              const win = window as any;
              const state = win[key];
              if (state && typeof state.onKeyDown === 'function') {
                window.removeEventListener('keydown', state.onKeyDown, true);
              }
              delete win[key];
            } catch {
              // Best-effort
            }
            host.remove();
          };

          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close();
          };

          try {
            window.addEventListener('keydown', onKeyDown, true);
            (window as any)[key] = { onKeyDown, close };
          } catch {
            // Best-effort
          }

          closeBtn.addEventListener('click', close);
          // Click outside panel closes too
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close();
          });

          // Focus the close button for keyboard users
          try {
            closeBtn.focus();
          } catch {
            // Best-effort
          }
        } catch {
          // Best-effort
        }
      },
      args: [PRIVACY_CURTAIN_HOST_ID, stateKey, PAGE_TOOL_Z_INDEX],
    });

    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to toggle privacy curtain:`, err);
    return {
      success: false,
      error: safeErrorMessage(err) || 'Failed to toggle privacy curtain',
    };
  }
}

export async function toggleQuickPanelReaderMode(
  tabId: number,
): Promise<QuickPanelPageCommandResponse> {
  const stateKey = '__mcp_qp_reader_state__';

  try {
    const [{ result: isOpen }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (hostId: string) => Boolean(document.getElementById(hostId)),
      args: [READER_HOST_ID],
    });

    if (normalizeBoolean(isOpen)) {
      await closeOverlayHost(tabId, READER_HOST_ID, stateKey);
      return { success: true };
    }

    await ensureWebFetcherHelper(tabId);

    const resp = await chrome.tabs.sendMessage(tabId, {
      action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
    });

    if (!resp || !isRecord(resp) || resp.success !== true) {
      const err = isRecord(resp) && typeof resp.error === 'string' ? resp.error : undefined;
      return { success: false, error: err || 'Failed to extract readable content' };
    }

    const article = isRecord(resp.article) ? resp.article : null;
    const metadata = isRecord(resp.metadata) ? resp.metadata : null;

    const title =
      (article && typeof article.title === 'string' && article.title.trim()) ||
      (metadata && typeof metadata.title === 'string' && metadata.title.trim()) ||
      '';
    const byline = article && typeof article.byline === 'string' ? article.byline : '';
    const siteName =
      (article && typeof article.siteName === 'string' && article.siteName.trim()) ||
      (metadata && typeof metadata.siteName === 'string' && metadata.siteName.trim()) ||
      '';
    const excerpt = article && typeof article.excerpt === 'string' ? article.excerpt : '';

    const htmlContent = article && typeof article.content === 'string' ? article.content : '';
    const textFallback = typeof resp.textContent === 'string' ? resp.textContent : '';

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        hostId: string,
        key: string,
        zIndex: string,
        payload: {
          title: string;
          byline: string;
          siteName: string;
          excerpt: string;
          html: string;
          text: string;
        },
      ) => {
        try {
          const root = document.documentElement;
          if (!root) return;

          if (document.getElementById(hostId)) return;

          const host = document.createElement('div');
          host.id = hostId;
          host.style.position = 'fixed';
          host.style.inset = '0';
          host.style.zIndex = zIndex;
          host.style.pointerEvents = 'auto';
          root.appendChild(host);

          const shadow = host.attachShadow({ mode: 'open' });

          const style = document.createElement('style');
          style.textContent = `
            :host { all: initial; }
            .backdrop {
              position: fixed;
              inset: 0;
              background: rgba(0, 0, 0, 0.62);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              overflow: auto;
              overscroll-behavior: contain;
              padding: 28px 18px;
              box-sizing: border-box;
            }
            .sheet {
              max-width: 860px;
              margin: 0 auto;
              border-radius: 16px;
              border: 1px solid rgba(255, 255, 255, 0.14);
              background: rgba(255, 255, 255, 0.92);
              color: rgba(0, 0, 0, 0.88);
              box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5);
              font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial,
                'Apple Color Emoji', 'Segoe UI Emoji';
            }
            @media (prefers-color-scheme: dark) {
              .sheet {
                background: rgba(17, 24, 39, 0.92);
                color: rgba(255, 255, 255, 0.9);
                border-color: rgba(255, 255, 255, 0.12);
              }
            }
            .header {
              padding: 18px 20px 12px;
              border-bottom: 1px solid rgba(0, 0, 0, 0.08);
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 12px;
            }
            @media (prefers-color-scheme: dark) {
              .header { border-bottom-color: rgba(255, 255, 255, 0.1); }
            }
            .title {
              font-size: 18px;
              font-weight: 750;
              line-height: 1.25;
              letter-spacing: 0.2px;
              margin: 0;
            }
            .meta {
              margin-top: 6px;
              font-size: 12px;
              opacity: 0.78;
              line-height: 1.4;
            }
            .btn {
              all: unset;
              cursor: pointer;
              padding: 6px 10px;
              border-radius: 999px;
              border: 1px solid rgba(0, 0, 0, 0.12);
              background: rgba(0, 0, 0, 0.04);
              font-size: 12px;
              user-select: none;
              white-space: nowrap;
            }
            @media (prefers-color-scheme: dark) {
              .btn {
                border-color: rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.08);
              }
            }
            .content {
              padding: 16px 20px 20px;
            }
            .article :where(p, ul, ol, pre, blockquote) {
              margin: 12px 0;
            }
            .article :where(h1, h2, h3) {
              margin: 18px 0 10px;
              line-height: 1.25;
            }
            .article :where(img, video) {
              max-width: 100%;
              height: auto;
              border-radius: 12px;
            }
            .article :where(pre, code) {
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
                'Courier New', monospace;
              font-size: 13px;
            }
            .article :where(pre) {
              padding: 12px;
              border-radius: 12px;
              background: rgba(0, 0, 0, 0.05);
              overflow: auto;
            }
            @media (prefers-color-scheme: dark) {
              .article :where(pre) { background: rgba(255, 255, 255, 0.06); }
            }
          `;

          const backdrop = document.createElement('div');
          backdrop.className = 'backdrop';

          const sheet = document.createElement('div');
          sheet.className = 'sheet';
          sheet.setAttribute('role', 'dialog');
          sheet.setAttribute('aria-modal', 'true');
          sheet.setAttribute('aria-label', 'Reader mode');

          const header = document.createElement('div');
          header.className = 'header';

          const left = document.createElement('div');

          const hTitle = document.createElement('h1');
          hTitle.className = 'title';
          hTitle.textContent = payload.title || document.title || 'Reader';

          const meta = document.createElement('div');
          meta.className = 'meta';
          const metaParts = [payload.siteName, payload.byline, payload.excerpt].filter(Boolean);
          meta.textContent = metaParts.join(' \u00B7 ');

          left.append(hTitle, meta);

          const closeBtn = document.createElement('button');
          closeBtn.className = 'btn';
          closeBtn.type = 'button';
          closeBtn.textContent = 'Close';
          closeBtn.setAttribute('aria-label', 'Close reader mode');

          header.append(left, closeBtn);

          const content = document.createElement('div');
          content.className = 'content';

          const article = document.createElement('article');
          article.className = 'article';

          if (payload.html && payload.html.trim()) {
            article.innerHTML = payload.html;
          } else {
            const pre = document.createElement('pre');
            pre.textContent = payload.text || '';
            article.append(pre);
          }

          content.append(article);
          sheet.append(header, content);
          backdrop.append(sheet);
          shadow.append(style, backdrop);

          const close = () => {
            try {
              const win = window as any;
              const state = win[key];
              if (state && typeof state.onKeyDown === 'function') {
                window.removeEventListener('keydown', state.onKeyDown, true);
              }
              delete win[key];
            } catch {
              // Best-effort
            }
            host.remove();
          };

          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close();
          };

          try {
            window.addEventListener('keydown', onKeyDown, true);
            (window as any)[key] = { onKeyDown, close };
          } catch {
            // Best-effort
          }

          closeBtn.addEventListener('click', close);
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close();
          });

          try {
            closeBtn.focus();
          } catch {
            // Best-effort
          }
        } catch {
          // Best-effort
        }
      },
      args: [
        READER_HOST_ID,
        stateKey,
        PAGE_TOOL_Z_INDEX,
        { title, byline, siteName, excerpt, html: htmlContent, text: textFallback },
      ],
    });

    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to toggle reader mode:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to toggle reader mode' };
  }
}
