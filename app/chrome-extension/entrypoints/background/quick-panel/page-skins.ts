/**
 * Quick Panel Page Skins
 *
 * Implements "Page Skins" as a fun visual effect that can be toggled via Quick Panel commands.
 *
 * Design goals:
 * - Runs entirely locally (no network) and does not rewrite page content.
 * - Applies styles only to `body` subtree so the Quick Panel overlay (attached to `documentElement`)
 *   remains readable and unaffected.
 * - Always shows a visible "Skin mode" watermark to avoid ambiguous "disguise" behavior.
 * - Best-effort persistence within the current browser session via `chrome.storage.session`.
 */

import type { QuickPanelPageCommandResponse } from '@/common/message-types';

const LOG_PREFIX = '[QuickPanelPageSkins]';

// ============================================================
// Types
// ============================================================

export type QuickPanelPageSkinId = 'vscode' | 'terminal' | 'retro' | 'paper';

// ============================================================
// CSS
// ============================================================

const PAGE_SKINS_CSS = /* css */ `
  /* Quick Panel Page Skins (best-effort) */
  body[data-mcp-qp-skin] {
    transition: filter 160ms ease, background-color 160ms ease, color 160ms ease;
  }

  /* ----------------------------
   * VS Code-inspired (dark mono)
   * ---------------------------- */
  body[data-mcp-qp-skin='vscode'] {
    background: #1e1e1e !important;
    color: #d4d4d4 !important;
  }

  body[data-mcp-qp-skin='vscode'] * {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace !important;
  }

  body[data-mcp-qp-skin='vscode'] a {
    color: #4fc1ff !important;
  }

  body[data-mcp-qp-skin='vscode'] img,
  body[data-mcp-qp-skin='vscode'] video,
  body[data-mcp-qp-skin='vscode'] svg,
  body[data-mcp-qp-skin='vscode'] canvas {
    filter: saturate(0.95) contrast(1.03) !important;
  }

  /* ----------------------------
   * Terminal (green on black)
   * ---------------------------- */
  body[data-mcp-qp-skin='terminal'] {
    background: #050505 !important;
    color: #00ff9a !important;
  }

  body[data-mcp-qp-skin='terminal'] * {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace !important;
    color: #00ff9a !important;
  }

  body[data-mcp-qp-skin='terminal'] a {
    color: #7cffc6 !important;
    text-decoration: underline !important;
  }

  body[data-mcp-qp-skin='terminal']::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    background: repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0) 0px,
      rgba(0, 0, 0, 0) 2px,
      rgba(0, 0, 0, 0.16) 3px
    );
    mix-blend-mode: multiply;
    opacity: 0.55;
  }

  /* ----------------------------
   * Retro (warm CRT-ish)
   * ---------------------------- */
  body[data-mcp-qp-skin='retro'] {
    filter: sepia(0.55) contrast(1.08) saturate(0.9);
  }

  body[data-mcp-qp-skin='retro']::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    background:
      radial-gradient(circle at 50% 20%, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0) 55%),
      repeating-linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.06) 0px,
        rgba(0, 0, 0, 0.06) 1px,
        rgba(0, 0, 0, 0) 3px
      );
    opacity: 0.6;
  }

  /* ----------------------------
   * Paper (light serif)
   * ---------------------------- */
  body[data-mcp-qp-skin='paper'] {
    background: #f6f1e6 !important;
    color: #1c1b18 !important;
  }

  body[data-mcp-qp-skin='paper'] * {
    font-family: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif !important;
  }

  body[data-mcp-qp-skin='paper'] a {
    color: #1f5fbf !important;
  }
`;

// ============================================================
// Watermark (Shadow DOM)
// ============================================================

const WATERMARK_HOST_ID = '__mcp_qp_skin_watermark_host__';
const BODY_ATTR = 'data-mcp-qp-skin';

function watermarkLabelForSkinId(skinId: QuickPanelPageSkinId): string {
  switch (skinId) {
    case 'vscode':
      return 'VS Code';
    case 'terminal':
      return 'Terminal';
    case 'retro':
      return 'Retro';
    case 'paper':
      return 'Paper';
  }
}

// ============================================================
// Session Persistence (best-effort)
// ============================================================

const SESSION_STORAGE_KEY = 'quick_panel_page_skins_by_tab_v1';
const skinByTabId = new Map<number, QuickPanelPageSkinId>();

let sessionLoaded = false;
let sessionLoadPromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function normalizeSkinId(value: unknown): QuickPanelPageSkinId | null {
  if (value === 'vscode' || value === 'terminal' || value === 'retro' || value === 'paper') {
    return value;
  }
  return null;
}

async function ensureSessionLoaded(): Promise<void> {
  if (sessionLoaded) return;
  if (sessionLoadPromise) return sessionLoadPromise;

  sessionLoadPromise = (async () => {
    try {
      if (!chrome.storage?.session) {
        sessionLoaded = true;
        return;
      }

      const stored = (await chrome.storage.session.get([SESSION_STORAGE_KEY])) as Record<
        string,
        unknown
      >;
      const raw = stored?.[SESSION_STORAGE_KEY];
      if (!isRecord(raw)) {
        sessionLoaded = true;
        return;
      }

      const openTabs = await chrome.tabs.query({});
      const openIds = new Set(openTabs.map((t) => t.id).filter(isValidTabId));

      skinByTabId.clear();
      for (const [k, v] of Object.entries(raw)) {
        const tabId = Number(k);
        if (!isValidTabId(tabId)) continue;
        if (!openIds.has(tabId)) continue;
        const skinId = normalizeSkinId(v);
        if (!skinId) continue;
        skinByTabId.set(tabId, skinId);
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to load session state:`, err);
    } finally {
      sessionLoaded = true;
    }
  })().finally(() => {
    sessionLoadPromise = null;
  });

  return sessionLoadPromise;
}

function scheduleSessionPersist(): void {
  if (!chrome.storage?.session) return;
  if (persistTimer) return;

  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushSessionPersist();
  }, 250);
}

async function flushSessionPersist(): Promise<void> {
  if (!chrome.storage?.session) return;

  const snapshot: Record<string, QuickPanelPageSkinId> = {};
  for (const [tabId, skinId] of skinByTabId.entries()) {
    snapshot[String(tabId)] = skinId;
  }

  try {
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: snapshot });
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to persist session state:`, err);
  }
}

// ============================================================
// Injection Helpers
// ============================================================

async function ensureCssInjected(tabId: number): Promise<void> {
  await chrome.scripting.insertCSS({
    target: { tabId },
    css: PAGE_SKINS_CSS,
  });
}

async function setBodySkinAttr(tabId: number, skinId: QuickPanelPageSkinId): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (attr: string, value: string) => {
      try {
        if (!document.body) return;
        document.body.setAttribute(attr, value);
      } catch {
        // Best-effort
      }
    },
    args: [BODY_ATTR, skinId],
  });
}

async function clearBodySkinAttr(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (attr: string) => {
      try {
        if (!document.body) return;
        document.body.removeAttribute(attr);
      } catch {
        // Best-effort
      }
    },
    args: [BODY_ATTR],
  });
}

async function ensureWatermark(tabId: number, skinId: QuickPanelPageSkinId): Promise<void> {
  const label = watermarkLabelForSkinId(skinId);

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (hostId: string, title: string) => {
      try {
        const root = document.documentElement;
        if (!root) return;

        let host = document.getElementById(hostId) as HTMLElement | null;
        if (!host) {
          host = document.createElement('div');
          host.id = hostId;
          root.appendChild(host);
        }

        // Ensure host is outside page layout and above body effects.
        host.style.position = 'fixed';
        host.style.top = '12px';
        host.style.right = '12px';
        host.style.zIndex = '2147483646'; // below Quick Panel host (2147483647)
        host.style.pointerEvents = 'none';

        const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
          <style>
            .wm {
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
                'Courier New', monospace;
              font-size: 12px;
              line-height: 1;
              letter-spacing: 0.2px;
              color: rgba(255, 255, 255, 0.92);
              background: rgba(17, 24, 39, 0.72);
              border: 1px solid rgba(255, 255, 255, 0.16);
              backdrop-filter: blur(6px);
              -webkit-backdrop-filter: blur(6px);
              border-radius: 999px;
              padding: 8px 10px;
              box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
              user-select: none;
              white-space: nowrap;
            }
            .wm strong {
              font-weight: 600;
              margin-right: 6px;
            }
          </style>
          <div class="wm" aria-label="Quick Panel skin mode watermark">
            <strong>Skin mode</strong>${title}
          </div>
        `;
      } catch {
        // Best-effort
      }
    },
    args: [WATERMARK_HOST_ID, label],
  });
}

async function removeWatermark(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (hostId: string) => {
      try {
        const el = document.getElementById(hostId);
        el?.remove();
      } catch {
        // Best-effort
      }
    },
    args: [WATERMARK_HOST_ID],
  });
}

// ============================================================
// Public API (called by page-commands-handler)
// ============================================================

export async function applyQuickPanelPageSkin(
  tabId: number,
  skinId: QuickPanelPageSkinId,
): Promise<QuickPanelPageCommandResponse> {
  try {
    await ensureSessionLoaded();

    await ensureCssInjected(tabId);
    await setBodySkinAttr(tabId, skinId);
    await ensureWatermark(tabId, skinId);

    skinByTabId.set(tabId, skinId);
    scheduleSessionPersist();

    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to apply skin:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to apply skin' };
  }
}

export async function clearQuickPanelPageSkin(
  tabId: number,
): Promise<QuickPanelPageCommandResponse> {
  try {
    await ensureSessionLoaded();

    await clearBodySkinAttr(tabId);
    await removeWatermark(tabId);

    skinByTabId.delete(tabId);
    scheduleSessionPersist();

    return { success: true };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to clear skin:`, err);
    return { success: false, error: safeErrorMessage(err) || 'Failed to clear skin' };
  }
}

// ============================================================
// Lifecycle hooks (called by page-commands-handler init)
// ============================================================

let lifecycleInitialized = false;

export function initQuickPanelPageSkinsLifecycle(): void {
  // Avoid duplicate listener registration if module is initialized multiple times.
  // We intentionally tie this to the page-commands-handler init lifecycle.
  if (lifecycleInitialized) return;
  lifecycleInitialized = true;

  // Reapply skin on full navigations (content is per-document).
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo?.status !== 'complete') return;

    void (async () => {
      try {
        await ensureSessionLoaded();
        const skinId = skinByTabId.get(tabId);
        if (!skinId) return;

        await ensureCssInjected(tabId);
        await setBodySkinAttr(tabId, skinId);
        await ensureWatermark(tabId, skinId);
      } catch {
        // Best-effort
      }
    })();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (skinByTabId.delete(tabId)) {
      scheduleSessionPersist();
    }
  });

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    const existing = skinByTabId.get(removedTabId);
    if (!existing) return;

    skinByTabId.delete(removedTabId);
    skinByTabId.set(addedTabId, existing);
    scheduleSessionPersist();
  });

  console.debug(`${LOG_PREFIX} Initialized lifecycle`);
}
