/* eslint-disable */
// recorder.js - content script for recording user interactions into steps

(function () {
  if (window.__RR_RECORDER_INSTALLED__) return;
  window.__RR_RECORDER_INSTALLED__ = true;

  // ================================================================
  // 1) CONFIG + STATELESS HELPERS (namespaced)
  // ================================================================
  const CONFIG = {
    INPUT_DEBOUNCE_MS: 500,
    BATCH_SEND_MS: 80,
    SCROLL_DEBOUNCE_MS: 350,
    SENSITIVE_INPUT_TYPES: new Set(['password']),
  };

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
      try {
        if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
          return `#${CSS.escape(el.id)}`;
        }
      } catch {}
      const priority = ['attr', 'css'];
      for (const p of priority) {
        const c = candidates.find((c) => c.type === p);
        if (c) return c.value;
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

  // ================================================================
  // 2) UI CLASS (injected via constructor)
  // ================================================================
  class UI {
    constructor(recorder) {
      this.recorder = recorder;
      this._box = null;
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
          <button id="__rr_pause" style="background:#fff; color:#111; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">暂停</button>
          <button id="__rr_stop" style="background:#111; color:#fff; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">停止</button>
        </div>`;
      document.documentElement.appendChild(root);
      const btnPause = root.querySelector('#__rr_pause');
      const btnStop = root.querySelector('#__rr_stop');
      const hideChk = root.querySelector('#__rr_hide_values');
      const highlightChk = root.querySelector('#__rr_enable_highlight');
      hideChk.checked = !!rec.hideInputValues;
      hideChk.addEventListener('change', () => (rec.hideInputValues = hideChk.checked));
      highlightChk.checked = !!rec.highlightEnabled;
      highlightChk.addEventListener('change', () => {
        rec.highlightEnabled = !!highlightChk.checked;
        rec._updateHoverListener();
      });
      btnPause.addEventListener('click', () => {
        if (!rec.isPaused) rec.pause();
        else rec.resume();
      });
      btnStop.addEventListener('click', () => {
        rec.stop();
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
      if (rec.highlightEnabled) document.addEventListener('mousemove', rec._onMouseMove, true);
      this.updateStatus();
    }
    remove() {
      try {
        if (window === window.top) {
          const root = document.getElementById('__rr_rec_overlay');
          if (root) root.remove();
          if (this._box) this._box.remove();
        }
      } catch {}
    }
    updateStatus() {
      const badge = document.getElementById('__rr_badge');
      const pauseBtn = document.getElementById('__rr_pause');
      if (badge) badge.textContent = this.recorder.isPaused ? '已暂停' : '录制中';
      if (pauseBtn) pauseBtn.textContent = this.recorder.isPaused ? '继续' : '暂停';
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

      this.pendingFlow = this._createEmptyFlow();
      this.lastFill = { step: null, ts: 0 };
      // Recording-time element identity map (not persisted)
      this.el2ref = new WeakMap();
      this.refCounter = 0;

      // Bind handlers
      this._onClick = this._onClick.bind(this);
      this._onInput = this._onInput.bind(this);
      this._onChange = this._onChange.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onScroll = this._onScroll.bind(this);
      this.ui = new UI(this);
      this._scrollPending = null;
    }

    // Lifecycle
    start(flowMeta) {
      this._reset(flowMeta || {});
      this.isRecording = true;
      this.isPaused = false;
      this._attach();
      this.ui.ensure();
      this._send({ kind: 'start', flow: this.pendingFlow });
    }

    stop() {
      this.isRecording = false;
      this._detach();
      this.ui.remove();
      try {
        if (this.scrollTimer) clearTimeout(this.scrollTimer);
      } catch {}
      this.scrollTimer = null;
      this.lastFill = { step: null, ts: 0 };
      const ret = this.pendingFlow;
      try {
        this.pendingFlow.steps = [];
      } catch {}
      this._send({ kind: 'stop', flow: ret });
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
      document.addEventListener('input', this._onInput, true);
      document.addEventListener('change', this._onChange, true);
      // capture-phase scroll to catch non-bubbling events on any container
      document.addEventListener('scroll', this._onScroll, true);
      this._updateHoverListener();
    }

    _detach() {
      document.removeEventListener('click', this._onClick, true);
      document.removeEventListener('input', this._onInput, true);
      document.removeEventListener('change', this._onChange, true);
      document.removeEventListener('scroll', this._onScroll, true);
      try {
        document.removeEventListener('mousemove', this._onMouseMove, true);
      } catch {}
    }

    _updateHoverListener() {
      try {
        if (window !== window.top) return;
        try {
          document.removeEventListener('mousemove', this._onMouseMove, true);
        } catch {}
        if (this.isRecording && !this.isPaused && this.highlightEnabled) {
          document.addEventListener('mousemove', this._onMouseMove, true);
        }
      } catch {}
    }

    // Flow helpers
    _createEmptyFlow() {
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
      this.pendingFlow = this._createEmptyFlow();
      try {
        if (meta && typeof meta === 'object') {
          if (meta.id) this.pendingFlow.id = String(meta.id);
          if (meta.name) this.pendingFlow.name = String(meta.name);
          if (meta.description) this.pendingFlow.description = String(meta.description);
        }
      } catch {}
      this.lastFill = { step: null, ts: 0 };
      this.frameSwitchPushed = false;
    }

    _pushStep(step) {
      step.id = step.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      try {
        if (window !== window.top && !this.frameSwitchPushed) {
          const href = String(location && location.href ? location.href : '');
          this.pendingFlow.steps.push({ type: 'switchFrame', frame: { urlContains: href } });
          this.frameSwitchPushed = true;
        }
      } catch {}
      this.pendingFlow.steps.push(step);
      this.pendingFlow.meta.updatedAt = new Date().toISOString();
      this.batch.push(step);
      if (this.batchTimer) {
        try {
          clearTimeout(this.batchTimer);
        } catch {}
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
      try {
        chrome.runtime.sendMessage({ type: 'rr_recorder_event', payload });
      } catch {}
    }

    _addVariable(key, sensitive, defVal) {
      if (!this.pendingFlow.variables) this.pendingFlow.variables = [];
      if (this.pendingFlow.variables.find((v) => v.key === key)) return;
      this.pendingFlow.variables.push({ key, sensitive: !!sensitive, default: defVal || '' });
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
      } catch {}
      try {
        const overlay = document.getElementById('__rr_rec_overlay');
        if (overlay && (el === overlay || (el.closest && el.closest('#__rr_rec_overlay')))) return;
      } catch {}
      try {
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
      this._pushStep({
        type: e.detail >= 2 ? 'dblclick' : 'click',
        target,
        screenshotOnFail: true,
      });
    }

    _onInput(e) {
      if (!this.isRecording || this.isPaused) return;
      const el =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
          ? e.target
          : null;
      if (!el) return;
      try {
        const t = (el.getAttribute && el.getAttribute('type')) || '';
        const tt = String(t).toLowerCase();
        if (tt === 'checkbox' || tt === 'radio' || tt === 'file') return;
      } catch {}
      const target = SelectorEngine.buildTarget(el);
      const elRef = this._getElRef(el);
      const isSensitive =
        this.hideInputValues ||
        CONFIG.SENSITIVE_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
      let value = el.value || '';
      if (isSensitive) {
        const varKey = el.name ? el.name : `var_${Math.random().toString(36).slice(2, 6)}`;
        this._addVariable(varKey, true, '');
        value = `{${varKey}}`;
      }
      const nowTs = Date.now();
      const sameRef = !!(this.lastFill.step && this.lastFill.step._recordingRef === elRef);
      const within = nowTs - this.lastFill.ts <= CONFIG.INPUT_DEBOUNCE_MS;
      if (sameRef && within) {
        try {
          this.lastFill.step.value = value;
          this.pendingFlow.meta.updatedAt = new Date().toISOString();
          this.lastFill.ts = nowTs;
          return;
        } catch {}
      }
      const newStep = { type: 'fill', target, value, screenshotOnFail: true };
      // attach recording-time identity only in memory (not persisted)
      newStep._recordingRef = elRef;
      this._pushStep(newStep);
      this.lastFill = { step: newStep, ts: nowTs };
    }

    _onChange(e) {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target;
      if (el instanceof HTMLSelectElement) {
        const target = SelectorEngine.buildTarget(el);
        const val = el.value;
        const nowTs = Date.now();
        const elRef = this._getElRef(el);
        const sameRef = !!(this.lastFill.step && this.lastFill.step._recordingRef === elRef);
        const within = nowTs - this.lastFill.ts <= CONFIG.INPUT_DEBOUNCE_MS;
        if (sameRef && within) {
          try {
            this.lastFill.step.value = val;
            this.pendingFlow.meta.updatedAt = new Date().toISOString();
            this.lastFill.ts = nowTs;
            return;
          } catch {}
        }
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
          top = /** @type {any} */ (el).scrollTop || 0;
          left = /** @type {any} */ (el).scrollLeft || 0;
        }
      } catch {}
      const target = isDoc ? null : SelectorEngine.buildTarget(el);
      // Debounce/coalesce
      this._scrollPending = { isDoc, target, top, left };
      if (this.scrollTimer) {
        try {
          clearTimeout(this.scrollTimer);
        } catch {}
      }
      this.scrollTimer = setTimeout(() => {
        this.scrollTimer = null;
        const pending = this._scrollPending;
        this._scrollPending = null;
        if (!pending) return;
        const { isDoc: pDoc, target: pTarget, top: pTop, left: pLeft } = pending;
        // Try merge with last step
        const steps = this.pendingFlow.steps;
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
            try {
              last.offset = { y: pTop, x: pLeft };
              this.pendingFlow.meta.updatedAt = new Date().toISOString();
              return;
            } catch {}
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
      try {
        sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      } catch {}
      return true;
    }
    return false;
  });

  console.log('Record & Replay recorder.js loaded');
})();
