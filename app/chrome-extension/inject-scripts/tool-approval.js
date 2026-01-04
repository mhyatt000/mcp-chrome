/* eslint-disable */
/**
 * Tool Approval Inject Script
 *
 * A lightweight, human-in-the-loop confirmation UI used by Phase 14 "Agent Mode"
 * to gate risky MCP tool calls before execution.
 *
 * Design goals:
 * - Single-purpose, self-contained overlay UI (Shadow DOM isolation)
 * - Best-effort: if UI cannot render, background will deny by timeout
 * - Minimal page interference (captured events stay inside overlay)
 */

(function () {
  'use strict';

  if (window.__MCP_TOOL_APPROVAL_INITIALIZED__) return;
  window.__MCP_TOOL_APPROVAL_INITIALIZED__ = true;

  const UI_HOST_ID = '__mcp_tool_approval_host__';

  const STATE = {
    sessionId: null,
    deadlineTs: null,
    keydownAttached: false,
  };

  function normalizeString(v) {
    return typeof v === 'string' ? v : '';
  }

  function removeHost() {
    const existing = document.getElementById(UI_HOST_ID);
    if (existing) existing.remove();
  }

  function sendDecision(decision) {
    if (!STATE.sessionId) return;
    try {
      chrome.runtime.sendMessage({
        type: 'tool_approval_ui_event',
        sessionId: STATE.sessionId,
        event: decision === 'approve' ? 'approve' : 'deny',
      });
    } catch {
      // Best effort
    }
  }

  function formatTimeLeft(deadlineTs) {
    const now = Date.now();
    const remaining = Math.max(0, (deadlineTs || 0) - now);
    const sec = Math.ceil(remaining / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}m ${s}s`;
  }

  function render(payload) {
    removeHost();

    const host = document.createElement('div');
    host.id = UI_HOST_ID;
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'auto';

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      }
      .card {
        width: min(620px, calc(100vw - 32px));
        background: #111827;
        color: #f9fafb;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.45);
        overflow: hidden;
      }
      .header {
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .title {
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.02em;
      }
      .meta {
        font-size: 12px;
        color: rgba(255,255,255,0.72);
      }
      .body {
        padding: 14px 16px;
        display: grid;
        gap: 10px;
      }
      .rowLabel {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255,255,255,0.55);
      }
      .monoBox {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 10px 12px;
        max-height: 220px;
        overflow: auto;
      }
      .footer {
        padding: 14px 16px;
        border-top: 1px solid rgba(255,255,255,0.08);
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .btn {
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.08);
        color: #f9fafb;
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .btn:hover { background: rgba(255,255,255,0.12); }
      .btn:active { transform: translateY(1px); }
      .btnDanger {
        background: #ef4444;
        border-color: rgba(239,68,68,0.85);
      }
      .btnDanger:hover { background: #dc2626; }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.82);
      }
      .pillHigh { border-color: rgba(239,68,68,0.55); }
      .pillMedium { border-color: rgba(245,158,11,0.55); }
      .pillLow { border-color: rgba(34,197,94,0.45); }
      .desc { color: rgba(255,255,255,0.72); font-size: 12px; line-height: 1.4; }
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Tool approval');

    const header = document.createElement('div');
    header.className = 'header';

    const toolName = normalizeString(payload.toolName).trim() || 'Unknown tool';
    const risk = payload.risk || {};
    const level = normalizeString(risk.level).trim().toLowerCase();

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `Approve tool call: ${toolName}`;

    const desc = document.createElement('div');
    desc.className = 'desc';
    const toolDescription = normalizeString(payload.toolDescription).trim();
    desc.textContent = toolDescription || 'This action was requested by the agent.';

    left.append(title, desc);

    const right = document.createElement('div');
    const pill = document.createElement('div');
    pill.className = `pill ${level === 'high' ? 'pillHigh' : level === 'medium' ? 'pillMedium' : 'pillLow'}`;
    pill.textContent = `Risk: ${level || 'unknown'}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const deadlineTs = typeof payload.deadlineTs === 'number' ? payload.deadlineTs : null;
    if (deadlineTs) meta.textContent = `Auto-deny in ${formatTimeLeft(deadlineTs)}`;
    right.append(pill, meta);

    header.append(left, right);

    const body = document.createElement('div');
    body.className = 'body';

    const argsLabel = document.createElement('div');
    argsLabel.className = 'rowLabel';
    argsLabel.textContent = 'Arguments';

    const argsBox = document.createElement('div');
    argsBox.className = 'monoBox';
    argsBox.textContent = normalizeString(payload.argsSummary) || '(no arguments)';

    body.append(argsLabel, argsBox);

    const footer = document.createElement('div');
    footer.className = 'footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Deny (Esc)';
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendDecision('deny');
      removeHost();
    });

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'btn btnDanger';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendDecision('approve');
      removeHost();
    });

    footer.append(cancelBtn, approveBtn);

    card.append(header, body, footer);
    backdrop.append(card);
    shadow.append(style, backdrop);

    backdrop.addEventListener('click', (e) => {
      // Clicking the backdrop denies by default.
      if (e.target !== backdrop) return;
      e.preventDefault();
      e.stopPropagation();
      sendDecision('deny');
      removeHost();
    });

    if (!STATE.keydownAttached) {
      STATE.keydownAttached = true;
      window.addEventListener(
        'keydown',
        (ev) => {
          if (!STATE.sessionId) return;
          if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            sendDecision('deny');
            removeHost();
          }
        },
        true,
      );
    }

    // Focus for immediate keyboard use
    setTimeout(() => {
      try {
        approveBtn.focus();
      } catch {
        // Ignore
      }
    }, 0);

    document.documentElement.appendChild(host);
  }

  function hide(sessionId) {
    if (sessionId && STATE.sessionId && sessionId !== STATE.sessionId) return;
    STATE.sessionId = null;
    STATE.deadlineTs = null;
    removeHost();
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      // Ping used by BaseBrowserToolExecutor.injectContentScript
      if (request && request.action === 'tool_approval_ping') {
        sendResponse({ status: 'pong' });
        return;
      }

      if (request && request.action === 'toolApprovalShow') {
        const sessionId = normalizeString(request.sessionId).trim();
        if (!sessionId) {
          sendResponse({ success: false, error: 'sessionId is required' });
          return;
        }
        STATE.sessionId = sessionId;
        STATE.deadlineTs = typeof request.deadlineTs === 'number' ? request.deadlineTs : null;
        render(request);
        sendResponse({ success: true });
        return;
      }

      if (request && request.action === 'toolApprovalHide') {
        hide(normalizeString(request.sessionId).trim());
        sendResponse({ success: true });
        return;
      }
    } catch (e) {
      try {
        sendResponse({ success: false, error: String(e) });
      } catch {}
    }
  });
})();
