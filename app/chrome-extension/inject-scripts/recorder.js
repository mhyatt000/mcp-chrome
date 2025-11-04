/* eslint-disable */
// recorder.js - content script for recording user interactions into steps

(function () {
  if (window.__RR_RECORDER_INSTALLED__) return;
  window.__RR_RECORDER_INSTALLED__ = true;

  // ================================================================
  // 1) CONFIG + STATELESS HELPERS (namespaced)
  // ================================================================
  const CONFIG = {
    // Increase debounce to improve step merging for slow/DOM-replacing inputs
    INPUT_DEBOUNCE_MS: 800,
    BATCH_SEND_MS: 100,
    SCROLL_DEBOUNCE_MS: 350,
    SENSITIVE_INPUT_TYPES: new Set(['password']),
    UI_MAX_STEPS: 30,
  };
  // Cross-frame event channel
  const FRAME_EVENT = 'rr_iframe_event';

  // Memoization caches for selector computations during recording
  const __cacheUnique = new WeakMap();
  const __cachePath = new WeakMap();

  const SelectorEngine = {
    buildTarget(el) {
      const candidates = [];
      const attrNames = ['data-testid', 'data-testId', 'data-test', 'data-qa', 'data-cy'];
      for (const an of attrNames) {
        const v = el.getAttribute && el.getAttribute(an);
        if (v) candidates.push({ type: 'attr', value: `[${an}="${CSS.escape(v)}"]` });
      }
      const classSel = this._uniqueClassSelector(el);
      if (classSel) candidates.push({ type: 'css', value: classSel });
      const css = this._generateSelector(el);
      if (css) candidates.push({ type: 'css', value: css });
      const name = el.getAttribute && el.getAttribute('name');
      if (name) candidates.push({ type: 'attr', value: `[name="${CSS.escape(name)}"]` });
      const title = el.getAttribute && el.getAttribute('title');
      if (title) candidates.push({ type: 'attr', value: `[title="${CSS.escape(title)}"]` });
      const alt = el.getAttribute && el.getAttribute('alt');
      if (alt) candidates.push({ type: 'attr', value: `[alt="${CSS.escape(alt)}"]` });
      const aria = el.getAttribute && el.getAttribute('aria-label');
      const role = el.getAttribute && el.getAttribute('role');
      if (aria) {
        if (role) candidates.push({ type: 'aria', value: `${role}[name=${aria}]` });
        else candidates.push({ type: 'aria', value: `textbox[name=${aria}]` });
      }
      const tag = el.tagName?.toLowerCase?.() || '';
      if (['button', 'a', 'summary'].includes(tag)) {
        const text = (el.textContent || '').trim();
        if (text) candidates.push({ type: 'text', value: text.substring(0, 64) });
      }
      const selector = SelectorEngine._choosePrimary(el, candidates);
      return { selector, candidates, tag };
    },

    _choosePrimary(el, candidates) {
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
        return `#${CSS.escape(el.id)}`;
      }
      const priority = ['attr', 'css'];
      for (const p of priority) {
        const c = candidates.find((c) => c.type === p);
        if (c) {
          try {
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (p === 'attr' && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
              const val = String(c.value || '').trim();
              if (val.startsWith('[')) return `${tag}${val}`;
            }
          } catch {}
          return c.value;
        }
      }
      if (candidates.length) return candidates[0].value;
      return SelectorEngine._generateSelector(el) || '';
    },

    _uniqueClassSelector(el) {
      if (__cacheUnique.has(el)) return __cacheUnique.get(el);
      let result = '';
      try {
        const classes = Array.from(el.classList || []).filter(
          (c) => c && /^[a-zA-Z0-9_-]+$/.test(c),
        );
        for (const cls of classes) {
          const sel = `.${CSS.escape(cls)}`;
          if (document.querySelectorAll(sel).length === 1) {
            result = sel;
            break;
          }
        }
        if (!result) {
          const tag = el.tagName ? el.tagName.toLowerCase() : '';
          for (const cls of classes) {
            const sel = `${tag}.${CSS.escape(cls)}`;
            if (document.querySelectorAll(sel).length === 1) {
              result = sel;
              break;
            }
          }
        }
        if (!result) {
          for (let i = 0; i < Math.min(classes.length, 3) && !result; i++) {
            for (let j = i + 1; j < Math.min(classes.length, 3); j++) {
              const sel = `.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
              if (document.querySelectorAll(sel).length === 1) {
                result = sel;
                break;
              }
            }
          }
        }
      } catch {}
      __cacheUnique.set(el, result);
      return result;
    },

    _generateSelector(el) {
      if (!(el instanceof Element)) return '';
      if (__cachePath.has(el)) return __cachePath.get(el);
      if (el.id) {
        const idSel = `#${CSS.escape(el.id)}`;
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      }
      for (const attr of ['data-testid', 'data-cy', 'name']) {
        const attrValue = el.getAttribute(attr);
        if (attrValue) {
          const s = `[${attr}="${CSS.escape(attrValue)}"]`;
          if (document.querySelectorAll(s).length === 1) return s;
        }
      }
      let path = '';
      let current = el;
      while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'BODY') {
        let selector = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === current.tagName,
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
        path = path ? `${selector} > ${path}` : selector;
        current = parent;
      }
      const res = path ? `body > ${path}` : 'body';
      __cachePath.set(el, res);
      return res;
    },
  };
  // Extend SelectorEngine with a shared ref helper (attached after declaration)
  SelectorEngine._ensureGlobalRef = function (el) {
    try {
      if (!window.__claudeElementMap) window.__claudeElementMap = {};
      if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;
      for (const k in window.__claudeElementMap) {
        const w = window.__claudeElementMap[k];
        if (w && typeof w.deref === 'function' && w.deref() === el) return k;
      }
      const id = `ref_${++window.__claudeRefCounter}`;
      window.__claudeElementMap[id] = new WeakRef(el);
      return id;
    } catch {
      return null;
    }
  };

  // ================================================================
  // 2) UI CLASS (injected via constructor)
  // ================================================================
  class UI {
    constructor(recorder) {
      this.recorder = recorder;
      this._box = null;
      // Timeline elements state
      this._timeline = null;
      this._count = 0;
      this._timelineBox = null;
      this._collapsed = false;
    }
    ensure() {
      const rec = this.recorder;
      if (window !== window.top) return;
      let root = document.getElementById('__rr_rec_overlay');
      if (root) return;
      root = document.createElement('div');
      root.id = '__rr_rec_overlay';
      Object.assign(root.style, {
        position: 'fixed',
        top: '10px',
        right: '10px',
        zIndex: 2147483646,
        fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial',
      });
      root.innerHTML = `
        <div id="__rr_rec_panel" style="background: rgba(220,38,38,0.95); color: #fff; padding:8px 10px; border-radius:8px; display:flex; align-items:center; gap:8px; box-shadow:0 4px 16px rgba(0,0,0,0.2);">
          <span id="__rr_badge" style="font-weight:600;">录制中</span>
          <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px;">
            <input id="__rr_hide_values" type="checkbox" style="vertical-align:middle;" />隐藏输入值
          </label>
          <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px;">
            <input id="__rr_enable_highlight" type="checkbox" style="vertical-align:middle;" />高亮
          </label>
          <button id="__rr_toggle_timeline" style="background:transparent; color:#fff; border:1px solid rgba(255,255,255,0.5); border-radius:6px; padding:2px 6px; cursor:pointer; font-size:12px;">折叠</button>
          <button id="__rr_pause" style="background:#fff; color:#111; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">暂停</button>
          <button id="__rr_stop" style="background:#111; color:#fff; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">停止</button>
        </div>`;
      document.documentElement.appendChild(root);
      // Build timeline container just below the panel
      const timeline = document.createElement('div');
      timeline.id = '__rr_rec_timeline';
      Object.assign(timeline.style, {
        marginTop: '8px',
        width: '360px',
        maxHeight: '220px',
        overflow: 'auto',
        background: 'rgba(17,24,39,0.85)',
        color: '#F9FAFB',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        padding: '8px 10px',
        fontSize: '12px',
        lineHeight: '1.4',
      });
      const header = document.createElement('div');
      header.textContent = '已录制步骤';
      header.style.opacity = '0.8';
      header.style.marginBottom = '4px';
      const list = document.createElement('ol');
      list.id = '__rr_rec_timeline_list';
      list.style.listStyle = 'none';
      list.style.margin = '0';
      list.style.padding = '0';
      list.style.display = 'flex';
      list.style.flexDirection = 'column';
      list.style.gap = '4px';
      timeline.appendChild(header);
      timeline.appendChild(list);
      root.appendChild(timeline);
      this._timeline = list;
      this._timelineBox = timeline;
      const btnPause = root.querySelector('#__rr_pause');
      const btnStop = root.querySelector('#__rr_stop');
      const hideChk = root.querySelector('#__rr_hide_values');
      const highlightChk = root.querySelector('#__rr_enable_highlight');
      const btnToggle = root.querySelector('#__rr_toggle_timeline');
      hideChk.checked = !!rec.hideInputValues;
      hideChk.addEventListener('change', () => (rec.hideInputValues = hideChk.checked));
      highlightChk.checked = !!rec.highlightEnabled;
      highlightChk.addEventListener('change', () => {
        rec.highlightEnabled = !!highlightChk.checked;
        rec._updateHoverListener();
      });
      if (btnToggle) {
        btnToggle.addEventListener('click', () => {
          this._collapsed = !this._collapsed;
          if (this._timelineBox)
            this._timelineBox.style.display = this._collapsed ? 'none' : 'block';
          btnToggle.textContent = this._collapsed ? '展开' : '折叠';
        });
      }
      btnPause.addEventListener('click', () => {
        if (!rec.isPaused) rec.pause();
        else rec.resume();
      });
      btnStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'rr_stop_recording' });
      });
      this._box = document.createElement('div');
      Object.assign(this._box.style, {
        position: 'fixed',
        border: '2px solid rgba(59,130,246,0.9)',
        borderRadius: '4px',
        background: 'rgba(59,130,246,0.15)',
        pointerEvents: 'none',
        zIndex: 2147483645,
      });
      document.documentElement.appendChild(this._box);
      if (rec.highlightEnabled)
        document.addEventListener('mousemove', rec._onMouseMove, { capture: true, passive: true });
      this.updateStatus();
    }
    remove() {
      if (window === window.top) {
        const root = document.getElementById('__rr_rec_overlay');
        if (root) root.remove();
        if (this._box) this._box.remove();
        this._timeline = null;
        this._timelineBox = null;
      }
    }
    updateStatus() {
      const badge = document.getElementById('__rr_badge');
      const pauseBtn = document.getElementById('__rr_pause');
      if (badge) badge.textContent = this.recorder.isPaused ? '已暂停' : '录制中';
      if (pauseBtn) pauseBtn.textContent = this.recorder.isPaused ? '继续' : '暂停';
    }

    // Reset the timeline list content
    resetTimeline() {
      this._count = 0;
      const list = this._timeline || document.getElementById('__rr_rec_timeline_list') || null;
      if (list) list.innerHTML = '';
    }

    // Append a new recorded step into the timeline UI
    appendStep(step) {
      const list = this._timeline || document.getElementById('__rr_rec_timeline_list') || null;
      if (!list) return;
      this._count += 1;
      const item = document.createElement('li');
      const text = this._formatStepText(step, this._count);
      item.setAttribute('data-step-id', step.id || '');
      item.style.display = 'flex';
      item.style.alignItems = 'flex-start';
      item.style.gap = '6px';
      item.innerHTML = `
        <span style="min-width:20px; text-align:right; opacity:0.8;">${this._count}.</span>
        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:310px;">${text}</span>
      `;
      list.appendChild(item);
      while (list.children.length > CONFIG.UI_MAX_STEPS) {
        list.removeChild(list.firstChild);
      }
      const container = list.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
    }

    // Efficiently apply a full timeline update by only appending the delta
    applyTimelineUpdate(steps) {
      try {
        if (window !== window.top) return;
        const list = Array.isArray(steps) ? steps : [];
        const total = list.length;
        // Ensure UI exists
        if (!this._timeline) this.ensure();
        if (!this._timeline) return;
        if (total === 0) {
          this.resetTimeline();
          return;
        }
        // If timeline shrank (e.g., new session), rebuild from tail window
        if (total < this._count) {
          this.resetTimeline();
        }
        const startIdx = Math.max(this._count, total - CONFIG.UI_MAX_STEPS);
        for (let i = startIdx; i < total; i++) {
          this.appendStep(list[i]);
        }
      } catch {}
    }

    // Create a short, human-readable text for a recorded step
    _formatStepText(step, _idx) {
      try {
        if (!step || typeof step !== 'object') return '未知步骤';
        const t = step.type;
        const sel = step.target && step.target.selector ? step.target.selector : '';
        if (t === 'click' || t === 'dblclick') {
          return `${t === 'dblclick' ? '双击' : '点击'}: ${sel || '(document)'}`;
        }
        if (t === 'fill') {
          const val = step.value;
          const shown = typeof val === 'string' && val.length > 0 ? val : String(val);
          return `输入: ${sel} = ${shown}`;
        }
        if (t === 'scroll') {
          const mode = step.mode === 'container' ? '容器' : '页面';
          const off = step.offset || {};
          return `滚动(${mode}): y=${off.y ?? 0}, x=${off.x ?? 0}`;
        }
        if (t === 'openTab') return `打开标签页: ${step.url || ''}`;
        if (t === 'switchTab') return `切换标签页: 包含 ${step.urlContains || ''}`;
        if (t === 'switchFrame')
          return `切换Frame: 包含 ${step.frame && step.frame.urlContains ? step.frame.urlContains : ''}`;
        if (t === 'waitFor') return `等待: ${sel || step.until || ''}`;
        return `${t}`;
      } catch (_) {
        return '步骤';
      }
    }
  }

  // ================================================================
  // 3) MAIN CLASS: ContentRecorder (stateful)
  // ================================================================
  class ContentRecorder {
    constructor() {
      // State
      this.isRecording = false;
      this.isPaused = false;
      this.hideInputValues = false;
      this.highlightEnabled = true;
      this.hoverRAF = 0;
      this.frameSwitchPushed = false;
      this.batch = [];
      this.batchTimer = null;
      this.scrollTimer = null;

      // Local, content-side buffer for batching/merging steps during recording.
      // Not the authoritative Flow (background holds the real one).
      this.sessionBuffer = this._createSessionBuffer();
      this.lastFill = { step: null, ts: 0 };
      // Recording-time element identity map (not persisted)
      this.el2ref = new WeakMap();
      this.refCounter = 0;

      // Bind handlers
      this._onClick = this._onClick.bind(this);
      this._onInput = this._onInput.bind(this);
      this._onDocInput = this._onDocInput.bind(this);
      this._onChange = this._onChange.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onScroll = this._onScroll.bind(this);
      this._onFocusIn = this._onFocusIn.bind(this);
      this._onFocusOut = this._onFocusOut.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onKeyUp = this._onKeyUp.bind(this);
      this._onWindowMessage = this._onWindowMessage.bind(this);
      this.ui = new UI(this);
      this._scrollPending = null;

      // Focus tracking for per-element input listening
      this._focusedEl = null;
      // Keyboard state for combo recording
      this._pressed = new Set();
      this._lastKeyTs = 0;
      // Map to avoid duplicate switchFrame per iframe source (keyed by frame selector)
      this._frameSwitchMap = new Set();
    }

    // Lifecycle
    start(flowMeta) {
      // Idempotent start: if already recording (and not paused), just ensure UI and listeners
      if (this.isRecording && !this.isPaused) {
        this.ui.ensure();
        this._updateHoverListener();
        return;
      }
      // If paused, treat start as resume to avoid resetting local buffer/UI timeline
      if (this.isPaused) {
        this.resume();
        return;
      }
      this._reset(flowMeta || {});
      this.isRecording = true;
      this.isPaused = false;
      this._attach();
      this.ui.ensure();
      this.ui.resetTimeline();
    }

    stop() {
      this.isRecording = false;
      this._detach();
      this.ui.remove();
      if (this.batchTimer) clearTimeout(this.batchTimer);
      this.batchTimer = null;
      if (this.scrollTimer) clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
      if (this.hoverRAF) cancelAnimationFrame(this.hoverRAF);
      this.hoverRAF = 0;
      this.lastFill = { step: null, ts: 0 };
      const ret = this.sessionBuffer;
      this.sessionBuffer.steps = [];
      return ret;
    }

    pause() {
      this.isPaused = true;
      this._detach();
      this.ui.updateStatus();
    }

    resume() {
      this.isRecording = true;
      this.isPaused = false;
      this._attach();
      this.ui.ensure();
      this.ui.updateStatus();
    }

    // DOM listeners
    _attach() {
      document.addEventListener('click', this._onClick, true);
      // Use focusin/out to attach input listener only to focused element
      document.addEventListener('focusin', this._onFocusIn, true);
      document.addEventListener('focusout', this._onFocusOut, true);
      // Document-level input capture to support Shadow DOM (custom elements)
      // Use capture phase + composedPath to find inner editable control
      document.addEventListener('input', this._onDocInput, true);
      document.addEventListener('change', this._onChange, true);
      // capture-phase scroll to catch non-bubbling events on any container (passive to avoid jank)
      document.addEventListener('scroll', this._onScroll, { capture: true, passive: true });
      // Keyboard: record Enter and modifier combos
      document.addEventListener('keydown', this._onKeyDown, true);
      document.addEventListener('keyup', this._onKeyUp, true);
      // Cross-frame: top window aggregates iframe-recorded steps
      if (window === window.top) window.addEventListener('message', this._onWindowMessage, true);
      this._updateHoverListener();
    }

    _detach() {
      document.removeEventListener('click', this._onClick, true);
      document.removeEventListener('focusin', this._onFocusIn, true);
      document.removeEventListener('focusout', this._onFocusOut, true);
      document.removeEventListener('input', this._onDocInput, true);
      document.removeEventListener('change', this._onChange, true);
      document.removeEventListener('scroll', this._onScroll, { capture: true });
      document.removeEventListener('keydown', this._onKeyDown, true);
      document.removeEventListener('keyup', this._onKeyUp, true);
      document.removeEventListener('mousemove', this._onMouseMove, { capture: true });
      if (window === window.top) window.removeEventListener('message', this._onWindowMessage, true);
      // Detach per-element input listener if any
      if (this._focusedEl) this._focusedEl.removeEventListener('input', this._onInput, true);
      this._focusedEl = null;
      // Best-effort cleanup for timers/raf when detaching
      if (this.batchTimer) clearTimeout(this.batchTimer);
      this.batchTimer = null;
      if (this.scrollTimer) clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
      if (this.hoverRAF) cancelAnimationFrame(this.hoverRAF);
      this.hoverRAF = 0;
    }

    _updateHoverListener() {
      if (window !== window.top) return;
      document.removeEventListener('mousemove', this._onMouseMove, { capture: true });
      if (this.isRecording && !this.isPaused && this.highlightEnabled) {
        document.addEventListener('mousemove', this._onMouseMove, { capture: true, passive: true });
      }
    }

    // Flow helpers (content-side buffer only)
    _createSessionBuffer() {
      const nowIso = new Date().toISOString();
      return {
        id: `flow_${Date.now()}`,
        name: '未命名录制',
        version: 1,
        steps: [],
        variables: [],
        meta: { createdAt: nowIso, updatedAt: nowIso },
      };
    }

    _reset(meta) {
      this.sessionBuffer = this._createSessionBuffer();
      try {
        if (meta && typeof meta === 'object') {
          if (meta.id) this.sessionBuffer.id = String(meta.id);
          if (meta.name) this.sessionBuffer.name = String(meta.name);
          if (meta.description) this.sessionBuffer.description = String(meta.description);
        }
      } catch {}
      this.lastFill = { step: null, ts: 0 };
      this.frameSwitchPushed = false;
    }

    _pushStep(step) {
      step.id = step.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      // In iframes, forward to top for aggregation (compute frame selector there)
      if (window !== window.top) {
        try {
          const payload = {
            kind: 'iframeStep',
            href: String(location && location.href ? location.href : ''),
            step,
          };
          window.top.postMessage({ type: FRAME_EVENT, payload }, '*');
          return; // Do not push locally in subframe
        } catch {}
      }
      // Top window: optionally insert a switchFrame if this step originated from an iframe message
      this.sessionBuffer.steps.push(step);
      this.sessionBuffer.meta.updatedAt = new Date().toISOString();
      this.batch.push(step);
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
      }
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this._flush();
      }, CONFIG.BATCH_SEND_MS);
    }

    _flush() {
      if (!this.batch.length) return;
      const steps = this.batch.map((s) => {
        // sanitize internal fields before sending to background
        const { _recordingRef, ...rest } = s || {};
        return rest;
      });
      this.batch.length = 0;
      this._send({ kind: 'steps', steps });
    }

    _send(payload) {
      chrome.runtime.sendMessage({ type: 'rr_recorder_event', payload });
    }

    _addVariable(key, sensitive, defVal) {
      if (!this.sessionBuffer.variables) this.sessionBuffer.variables = [];
      if (this.sessionBuffer.variables.find((v) => v.key === key)) return;
      this.sessionBuffer.variables.push({ key, sensitive: !!sensitive, default: defVal || '' });
    }

    // Handlers
    _onClick(e) {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      try {
        if (el instanceof HTMLInputElement) {
          const t = (el.getAttribute && el.getAttribute('type')) || '';
          const tt = String(t).toLowerCase();
          if (tt === 'checkbox' || tt === 'radio') return; // avoid duplicate with change
        }
        const overlay = document.getElementById('__rr_rec_overlay');
        if (overlay && (el === overlay || (el.closest && el.closest('#__rr_rec_overlay')))) return;
        const a = el.closest && el.closest('a[href]');
        const href = a && a.getAttribute && a.getAttribute('href');
        const tgt = a && a.getAttribute && a.getAttribute('target');
        if (a && href && tgt && tgt.toLowerCase() === '_blank') {
          try {
            const abs = new URL(href, location.href).href;
            this._pushStep({ type: 'openTab', url: abs });
            this._pushStep({ type: 'switchTab', urlContains: abs });
            return;
          } catch (_) {
            this._pushStep({ type: 'openTab', url: href });
            this._pushStep({ type: 'switchTab', urlContains: href });
            return;
          }
        }
      } catch {}
      const target = SelectorEngine.buildTarget(el);
      try {
        const gref = SelectorEngine._ensureGlobalRef && SelectorEngine._ensureGlobalRef(el);
        if (gref) target.ref = gref;
      } catch {}
      this._pushStep({
        type: e.detail >= 2 ? 'dblclick' : 'click',
        target,
        screenshotOnFail: true,
      });
    }

    // Per-element input handler (attached on focusin for native inputs/textarea)
    _onInput(e) {
      if (!this.isRecording || this.isPaused) return;
      // Avoid mid-composition spam (IME): handle final committed value
      try {
        if (e && typeof e.isComposing === 'boolean' && e.isComposing) return;
      } catch {}
      const el =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
          ? e.target
          : null;
      if (!el) return;
      this._handleInputForElement(el);
    }

    // Document-level input handler: supports composed events from Shadow DOM (custom elements)
    _onDocInput(e) {
      if (!this.isRecording || this.isPaused) return;
      try {
        if (e && typeof e.isComposing === 'boolean' && e.isComposing) return;
      } catch {}
      // Avoid double handling when per-element listener already attached to same element
      if (this._focusedEl && e.target === this._focusedEl) return;
      // Find the innermost editable element from composedPath
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      let el = null;
      for (let i = 0; i < path.length; i++) {
        const n = path[i];
        if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
          el = n;
          break;
        }
      }
      // As a fallback, walk down activeElement chain (deep active element via shadow roots)
      if (!el) {
        try {
          let ae = document.activeElement;
          let guard = 0;
          while (ae && guard++ < 10) {
            if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) {
              el = ae;
              break;
            }
            const anyAe = ae;
            if (anyAe && anyAe.shadowRoot && anyAe.shadowRoot.activeElement) {
              ae = anyAe.shadowRoot.activeElement;
              continue;
            }
            break;
          }
        } catch {}
      }
      if (!el) return;
      this._handleInputForElement(el);
    }

    // Shared input processing logic (debounce/merge/sensitivity)
    _handleInputForElement(el) {
      try {
        const t = (el.getAttribute && el.getAttribute('type')) || '';
        const tt = String(t).toLowerCase();
        if (tt === 'checkbox' || tt === 'radio' || tt === 'file') return;
      } catch {}
      const elRef = this._getElRef(el);
      const target = SelectorEngine.buildTarget(el);
      const isSensitive =
        this.hideInputValues ||
        CONFIG.SENSITIVE_INPUT_TYPES.has(
          ((el.getAttribute && el.getAttribute('type')) || '').toLowerCase(),
        );
      let value = el.value || '';
      if (isSensitive) {
        const varKey = el.name ? el.name : `var_${Math.random().toString(36).slice(2, 6)}`;
        this._addVariable(varKey, true, '');
        value = `{${varKey}}`;
      }
      const nowTs = Date.now();
      const last = this.lastFill.step;
      const sameRef = !!(last && last._recordingRef === elRef);
      const sameSelector = !!(
        last &&
        last.target &&
        last.target.selector &&
        target &&
        target.selector &&
        last.target.selector === target.selector
      );
      const within = nowTs - this.lastFill.ts <= CONFIG.INPUT_DEBOUNCE_MS;
      if ((sameRef || sameSelector) && within) {
        this.lastFill.step.value = value;
        this.sessionBuffer.meta.updatedAt = new Date().toISOString();
        this.lastFill.ts = nowTs;
        return;
      }
      const newStep = { type: 'fill', target, value, screenshotOnFail: true };
      newStep._recordingRef = elRef;
      this._pushStep(newStep);
      this.lastFill = { step: newStep, ts: nowTs };
    }

    _onChange(e) {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target;
      if (el instanceof HTMLSelectElement) {
        const val = el.value;
        const nowTs = Date.now();
        const elRef = this._getElRef(el);
        const sameRef = !!(this.lastFill.step && this.lastFill.step._recordingRef === elRef);
        const within = nowTs - this.lastFill.ts <= CONFIG.INPUT_DEBOUNCE_MS;
        if (sameRef && within) {
          this.lastFill.step.value = val;
          this.sessionBuffer.meta.updatedAt = new Date().toISOString();
          this.lastFill.ts = nowTs;
          return;
        }
        const target = SelectorEngine.buildTarget(el);
        try {
          const gref = SelectorEngine._ensureGlobalRef && SelectorEngine._ensureGlobalRef(el);
          if (gref) target.ref = gref;
        } catch {}
        const st = { type: 'fill', target, value: val, screenshotOnFail: true };
        st._recordingRef = elRef;
        this._pushStep(st);
        this.lastFill = { step: st, ts: nowTs };
        return;
      }
      if (el instanceof HTMLInputElement) {
        const t = (el.getAttribute && el.getAttribute('type')) || '';
        const tt = String(t).toLowerCase();
        const target = SelectorEngine.buildTarget(el);
        try {
          const gref = SelectorEngine._ensureGlobalRef && SelectorEngine._ensureGlobalRef(el);
          if (gref) target.ref = gref;
        } catch {}
        const elRef = this._getElRef(el);
        if (tt === 'checkbox') {
          const st = { type: 'fill', target, value: !!el.checked, screenshotOnFail: true };
          st._recordingRef = elRef;
          this._pushStep(st);
          return;
        }
        if (tt === 'radio') {
          const st = { type: 'fill', target, value: true, screenshotOnFail: true };
          st._recordingRef = elRef;
          this._pushStep(st);
          return;
        }
        if (tt === 'file') {
          const varKey = el.name ? el.name : `file_${Math.random().toString(36).slice(2, 6)}`;
          this._addVariable(varKey, false, '');
          this._pushStep({ type: 'fill', target, value: `{${varKey}}`, screenshotOnFail: true });
          return;
        }
      }
    }

    _getElRef(el) {
      try {
        let ref = this.el2ref.get(el);
        if (ref) return ref;
        ref = `ref_${++this.refCounter}`;
        this.el2ref.set(el, ref);
        return ref;
      } catch {
        // Fallback to timestamp-based ref if WeakMap fails (should not happen)
        return `ref_${Date.now()}`;
      }
    }

    // UI handled by injected UI class

    _onFocusIn(e) {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target;
      const isEditable =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el && el.nodeType === 1 && /** @type {HTMLElement} */ (el).isContentEditable === true);
      if (!isEditable) return;
      if (this._focusedEl && this._focusedEl !== el)
        this._focusedEl.removeEventListener('input', this._onInput, true);
      el.addEventListener('input', this._onInput, true);
      this._focusedEl = el;
    }

    _onFocusOut(e) {
      const el = e.target;
      if (!el) return;
      if (this._focusedEl === el) {
        el.removeEventListener('input', this._onInput, true);
        this._focusedEl = null;
      }
    }

    _onMouseMove(e) {
      if (!this.highlightEnabled || !this.ui._box || !this.isRecording || this.isPaused) return;
      if (this.hoverRAF) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      this.hoverRAF = requestAnimationFrame(() => {
        try {
          const r = el.getBoundingClientRect();
          Object.assign(this.ui._box.style, {
            left: `${Math.round(r.left)}px`,
            top: `${Math.round(r.top)}px`,
            width: `${Math.round(Math.max(0, r.width))}px`,
            height: `${Math.round(Math.max(0, r.height))}px`,
            display: r.width > 0 && r.height > 0 ? 'block' : 'none',
          });
        } catch {}
        this.hoverRAF = 0;
      });
    }

    _onScroll(e) {
      if (!this.isRecording || this.isPaused) return;
      try {
        const overlay = document.getElementById('__rr_rec_overlay');
        if (overlay) {
          // Use composedPath for shadow DOM compatibility, fallback to target
          const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
          for (const element of path) {
            // If the event path contains our overlay, ignore this scroll event
            if (element === overlay) {
              return;
            }
          }
        }
      } catch {
        // ignore
      }
      // Determine scroll source and positions
      const isDoc = e.target === document;
      const el = isDoc ? document.documentElement : e.target instanceof Element ? e.target : null;
      if (!el) return;
      let top = 0,
        left = 0;
      try {
        if (isDoc) {
          top =
            typeof window.scrollY === 'number'
              ? window.scrollY
              : document.documentElement.scrollTop || 0;
          left =
            typeof window.scrollX === 'number'
              ? window.scrollX
              : document.documentElement.scrollLeft || 0;
        } else {
          top = el.scrollTop || 0;
          left = el.scrollLeft || 0;
        }
      } catch {}
      const target = isDoc ? null : SelectorEngine.buildTarget(el);
      // Debounce/coalesce
      this._scrollPending = { isDoc, target, top, left };
      if (this.scrollTimer) {
        clearTimeout(this.scrollTimer);
      }
      this.scrollTimer = setTimeout(() => {
        this.scrollTimer = null;
        const pending = this._scrollPending;
        this._scrollPending = null;
        if (!pending) return;
        const { isDoc: pDoc, target: pTarget, top: pTop, left: pLeft } = pending;
        // Try merge with last step
        const steps = this.sessionBuffer.steps;
        const last = steps.length ? steps[steps.length - 1] : null;
        if (last && last.type === 'scroll') {
          const sameDoc = pDoc && !last.target && last.mode === 'offset';
          const sameEl =
            !pDoc &&
            last.target &&
            last.target.selector &&
            pTarget &&
            last.target.selector === pTarget.selector &&
            last.mode === 'container';
          if (sameDoc || sameEl) {
            last.offset = { y: pTop, x: pLeft };
            this.sessionBuffer.meta.updatedAt = new Date().toISOString();
            return;
          }
        }
        // New scroll step
        if (pDoc) {
          this._pushStep({
            type: 'scroll',
            mode: 'offset',
            offset: { y: pTop, x: pLeft },
            screenshotOnFail: false,
          });
        } else {
          this._pushStep({
            type: 'scroll',
            mode: 'container',
            target: pTarget,
            offset: { y: pTop, x: pLeft },
            screenshotOnFail: false,
          });
        }
      }, CONFIG.SCROLL_DEBOUNCE_MS);
    }

    // Minimal key recorder: record Enter and modifier combos; avoid plain typing
    _onKeyDown(e) {
      if (!this.isRecording || this.isPaused) return;
      try {
        // Ignore autorepeat to prevent spam
        if (e.repeat) return;
        const key = String(e.key || '').toLowerCase();
        const isModifier = key === 'shift' || key === 'control' || key === 'meta' || key === 'alt';
        const isEditable =
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target &&
            e.target.nodeType === 1 &&
            /** @type {HTMLElement} */ (e.target).isContentEditable === true);
        const enterKey = key === 'enter';

        // Track pressed modifiers
        if (isModifier) this._pressed.add(key);

        // Handle Enter in editable contexts (including contenteditable)
        if (isEditable && enterKey) {
          // prevent duplicate with input handler; record explicit key action with target
          const target = SelectorEngine.buildTarget(/** @type {Element} */ (e.target));
          const combo = this._formatKeysCombo(e, 'Enter');
          this._pushStep({ type: 'key', keys: combo, target, screenshotOnFail: false });
          this._lastKeyTs = Date.now();
          return;
        }

        // For non-text fields: record modifier combos and special keys
        const special = enterKey || key === 'escape' || key === 'tab';
        if (special || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
          const comboName = this._formatKeysCombo(e, e.key);
          this._pushStep({ type: 'key', keys: comboName, screenshotOnFail: false });
          this._lastKeyTs = Date.now();
        }
      } catch {}
    }

    _onKeyUp(e) {
      const key = String(e.key || '').toLowerCase();
      if (key === 'shift' || key === 'control' || key === 'meta' || key === 'alt')
        this._pressed.delete(key);
    }

    _formatKeysCombo(e, mainKey) {
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      const mk = String(mainKey || '').trim();
      // Normalize common names to match keyboard-helper parsing
      const norm = (s) => {
        const k = s.toLowerCase();
        if (k === 'escape') return 'Esc';
        if (k === ' ') return 'Space';
        if (k.length === 1) return k.toUpperCase();
        return s;
      };
      parts.push(norm(mk));
      return parts.join('+');
    }

    // Top-level aggregator: receives iframe events and merges into session
    _onWindowMessage(ev) {
      try {
        const d = ev && ev.data;
        if (!d || d.type !== FRAME_EVENT || !d.payload) return;
        const { step, href } = d.payload || {};
        if (!step || typeof step !== 'object') return;

        // Identify iframe element by event.source
        let frameEl = null;
        try {
          const frames = document.querySelectorAll('iframe,frame');
          for (let i = 0; i < frames.length; i++) {
            const f = frames[i];
            if (f && f.contentWindow === ev.source) {
              frameEl = f;
              break;
            }
          }
        } catch {}

        // Stateless: compose composite selector and push single step
        if (frameEl && step && step.target) {
          const frameTarget = SelectorEngine.buildTarget(frameEl);
          const frameSel = frameTarget?.selector || '';
          const inner = String(step.target.selector || '').trim();
          if (frameSel && inner) {
            const composite = `${frameSel} |> ${inner}`;
            step.target.selector = composite;
            if (Array.isArray(step.target.candidates)) {
              step.target.candidates.unshift({ type: 'css', value: composite });
            }
          }
          this._pushStep(step);
        }
      } catch {}
    }
  }

  // ================================================================
  // 3) SINGLETON + MESSAGE HANDLERS
  // ================================================================
  let recorderInstance = null;
  function getRecorder() {
    if (!recorderInstance) recorderInstance = new ContentRecorder();
    return recorderInstance;
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (!request || !request.action) return false;
      if (request.action === 'rr_timeline_update') {
        const rec = getRecorder();
        // Only respond to timeline updates when recording is active
        if (!rec.isRecording) {
          sendResponse({ ok: true, ignored: true });
          return true;
        }
        // Replace entire timeline to avoid divergence across tabs
        const steps = Array.isArray(request.steps) ? request.steps : [];
        rec.ui.applyTimelineUpdate(steps);
        sendResponse({ ok: true });
        return true;
      }
      if (request.action === 'rr_recorder_control') {
        const rec = getRecorder();
        const cmd = request.cmd;
        if (cmd === 'start') {
          rec.start(request.meta || {});
          sendResponse({ success: true });
          return true;
        }
        if (cmd === 'pause') {
          rec.pause();
          sendResponse({ success: true });
          return true;
        }
        if (cmd === 'resume') {
          rec.resume();
          sendResponse({ success: true });
          return true;
        }
        if (cmd === 'stop') {
          const flow = rec.stop();
          sendResponse({ success: true, flow });
          return true;
        }
        sendResponse({ success: false, error: 'Unknown command' });
        return true;
      }
      if (request.action === 'rr_recorder_ping') {
        sendResponse({ status: 'pong' });
        return false;
      }
    } catch (e) {
      sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      return true;
    }
    return false;
  });

  console.log('Record & Replay recorder.js loaded');
})();
