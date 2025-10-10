/* eslint-disable */
// recorder.js - content script for recording user interactions into steps
// Notes: Designed to run in ISOLATED world. Communicates via chrome.runtime messages.

(function () {
  if (window.__RR_RECORDER_INSTALLED__) return;
  window.__RR_RECORDER_INSTALLED__ = true;

  const SENSITIVE_INPUT_TYPES = new Set(['password']);
  const THROTTLE_SCROLL_MS = 200;
  const sampledDrag = [];

  let isRecording = false;
  let pendingFlow = {
    id: `flow_${Date.now()}`,
    name: '未命名录制',
    version: 1,
    steps: [],
    variables: [],
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };

  function now() {
    return Date.now();
  }

  function toRef(el) {
    if (!window.__claudeElementMap) window.__claudeElementMap = {};
    if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;
    for (const k in window.__claudeElementMap) {
      if (window.__claudeElementMap[k].deref && window.__claudeElementMap[k].deref() === el)
        return k;
    }
    const id = `ref_${++window.__claudeRefCounter}`;
    window.__claudeElementMap[id] = new WeakRef(el);
    return id;
  }

  function generateSelector(el) {
    if (!(el instanceof Element)) return '';
    if (/** @type {HTMLElement} */ (el).id) {
      const idSel = `#${CSS.escape(/** @type {HTMLElement} */ (el).id)}`;
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
    return path ? `body > ${path}` : 'body';
  }

  function buildTarget(el) {
    const ref = toRef(el);
    const candidates = [];
    const css = generateSelector(el);
    if (css) candidates.push({ type: 'css', value: css });
    const name = el.getAttribute && el.getAttribute('name');
    if (name) candidates.push({ type: 'attr', value: `[name="${name}"]` });
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) candidates.push({ type: 'aria', value: `textbox[name=${aria}]` });
    // Fallback to text for clickable elements
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'summary'].includes(tag)) {
      const text = (el.textContent || '').trim();
      if (text) candidates.push({ type: 'text', value: text.substring(0, 64) });
    }
    return { ref, candidates };
  }

  function addVariable(key, sensitive, defaultValue) {
    if (!pendingFlow.variables) pendingFlow.variables = [];
    if (pendingFlow.variables.find((v) => v.key === key)) return;
    pendingFlow.variables.push({ key, sensitive: !!sensitive, default: defaultValue || '' });
  }

  function pushStep(step) {
    step.id = step.id || `step_${now()}_${Math.random().toString(36).slice(2, 6)}`;
    pendingFlow.steps.push(step);
    pendingFlow.meta.updatedAt = new Date().toISOString();
    chrome.runtime.sendMessage({
      type: 'rr_recorder_event',
      payload: { kind: 'step', step },
    });
  }

  function onClick(e) {
    if (!isRecording) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const target = buildTarget(el);
    pushStep({ type: e.detail >= 2 ? 'dblclick' : 'click', target, screenshotOnFail: true });
  }

  function onInput(e) {
    if (!isRecording) return;
    const el =
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
        ? e.target
        : null;
    if (!el) return;
    const target = buildTarget(el);
    const isSensitive = SENSITIVE_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
    let value = el.value || '';
    if (isSensitive) {
      const varKey = el.name ? el.name : `var_${Math.random().toString(36).slice(2, 6)}`;
      addVariable(varKey, true, '');
      value = `{${varKey}}`;
    }
    pushStep({ type: 'fill', target, value, screenshotOnFail: true });
  }

  function onKeydown(e) {
    if (!isRecording) return;
    // modifier+key or Enter/Backspace etc
    const mods = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.metaKey) mods.push('cmd');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey) mods.push('shift');
    let keyToken = e.key || '';
    // normalize
    keyToken = keyToken.length === 1 ? keyToken.toLowerCase() : keyToken.toLowerCase();
    const keys = mods.length ? `${mods.join('+')}+${keyToken}` : keyToken;
    pushStep({ type: 'key', keys, screenshotOnFail: false });
  }

  let lastScrollAt = 0;
  function onScroll(e) {
    if (!isRecording) return;
    const nowTs = now();
    if (nowTs - lastScrollAt < THROTTLE_SCROLL_MS) return;
    lastScrollAt = nowTs;
    const targetEl = e.target === document ? document.documentElement : e.target;
    const target = targetEl instanceof Element ? buildTarget(targetEl) : undefined;
    const top = window.scrollY || document.documentElement.scrollTop || 0;
    pushStep({ type: 'scroll', mode: 'offset', offset: { x: 0, y: top }, target });
  }

  let dragging = false;
  function onMouseDown(e) {
    if (!isRecording) return;
    dragging = true;
    sampledDrag.length = 0;
    sampledDrag.push({ x: e.clientX, y: e.clientY });
  }
  function onMouseMove(e) {
    if (!isRecording) return;
    if (!dragging) return;
    if (sampledDrag.length === 0 || now() - sampledDrag._lastTs > 50) {
      sampledDrag.push({ x: e.clientX, y: e.clientY });
      sampledDrag._lastTs = now();
    }
  }
  function onMouseUp(e) {
    if (!isRecording) return;
    if (!dragging) return;
    dragging = false;
    const start = sampledDrag[0];
    const end = { x: e.clientX, y: e.clientY };
    if (start) {
      pushStep({
        type: 'drag',
        start: { ref: undefined, candidates: [] },
        end: { ref: undefined, candidates: [] },
        path: sampledDrag.slice(),
      });
    }
  }

  function attach() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function detach() {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onInput, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('scroll', onScroll, { passive: true });
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
  }

  function reset(flowMeta) {
    pendingFlow = {
      id: flowMeta && flowMeta.id ? flowMeta.id : `flow_${Date.now()}`,
      name: (flowMeta && flowMeta.name) || '未命名录制',
      version: 1,
      steps: [],
      variables: [],
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        domain: location.hostname,
        bindings: [{ type: 'domain', value: location.hostname }],
      },
    };
  }

  function start(flowMeta) {
    reset(flowMeta || {});
    isRecording = true;
    attach();
    chrome.runtime.sendMessage({
      type: 'rr_recorder_event',
      payload: { kind: 'start', flow: pendingFlow },
    });
  }

  function stop() {
    isRecording = false;
    detach();
    chrome.runtime.sendMessage({
      type: 'rr_recorder_event',
      payload: { kind: 'stop', flow: pendingFlow },
    });
    return pendingFlow;
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (request && request.action === 'rr_recorder_control') {
        const cmd = request.cmd;
        if (cmd === 'start') {
          start(request.meta || {});
          sendResponse({ success: true });
          return true;
        } else if (cmd === 'stop') {
          const flow = stop();
          sendResponse({ success: true, flow });
          return true;
        }
      }
    } catch (e) {
      sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      return true;
    }
    return false;
  });

  // ping handler
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request && request.action === 'rr_recorder_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
    return false;
  });

  console.log('Record & Replay recorder.js loaded');
})();
