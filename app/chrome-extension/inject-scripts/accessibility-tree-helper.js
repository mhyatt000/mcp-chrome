/* eslint-disable */
// accessibility-tree-helper.js
// Injected script to generate an accessibility-like tree of the visible page
// Elements receive stable refs (ref_*) via WeakRef mapping for later reference.

(function () {
  if (window.__ACCESSIBILITY_TREE_HELPER_INITIALIZED__) return;
  window.__ACCESSIBILITY_TREE_HELPER_INITIALIZED__ = true;

  // Traversal and output limits to ensure stability on very large/complex pages
  const MAX_DEPTH = 30; // maximum DOM depth to traverse
  const MAX_NODES = 4000; // hard limit to avoid long blocking on huge DOMs
  const MAX_LINE_LABEL = 100; // max characters for a single label in output
  const REF_MAP_LIMIT = 1000; // limit size of the ref map to keep payload small

  // Keep a weak map from ref id to elements
  if (!window.__claudeElementMap) window.__claudeElementMap = {};
  if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;

  /**
   * Infer ARIA-like role from element
   * @param {Element} el
   * @returns {string}
   */
  function inferRole(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const map = {
      a: 'link',
      button: 'button',
      input:
        type === 'submit' || type === 'button'
          ? 'button'
          : type === 'checkbox'
            ? 'checkbox'
            : type === 'radio'
              ? 'radio'
              : type === 'file'
                ? 'button'
                : 'textbox',
      select: 'combobox',
      textarea: 'textbox',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      h4: 'heading',
      h5: 'heading',
      h6: 'heading',
      img: 'image',
      nav: 'navigation',
      main: 'main',
      header: 'banner',
      footer: 'contentinfo',
      section: 'region',
      article: 'article',
      aside: 'complementary',
      form: 'form',
      table: 'table',
      ul: 'list',
      ol: 'list',
      li: 'listitem',
      label: 'label',
    };
    return map[tag] || 'generic';
  }

  /**
   * Derive readable label for element
   * @param {Element} el
   * @returns {string}
   */
  function inferLabel(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      const sel = /** @type {HTMLSelectElement} */ (el);
      const opt = sel.querySelector('option[selected]') || sel.options[sel.selectedIndex];
      if (opt && opt.textContent) return opt.textContent.trim();
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    if (/** @type {HTMLElement} */ (el).id) {
      const lab = document.querySelector(`label[for="${/** @type {HTMLElement} */ (el).id}"]`);
      if (lab && lab.textContent && lab.textContent.trim()) return lab.textContent.trim();
    }
    if (tag === 'input') {
      const input = /** @type {HTMLInputElement} */ (el);
      const type = input.getAttribute('type') || '';
      const val = input.getAttribute('value');
      if (type === 'submit' && val && val.trim()) return val.trim();
      if (input.value && input.value.length < 50 && input.value.trim()) return input.value.trim();
    }
    if (['button', 'a', 'summary'].includes(tag)) {
      let text = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        const n = el.childNodes[i];
        if (n.nodeType === Node.TEXT_NODE) text += n.textContent || '';
      }
      if (text.trim()) return text.trim();
    }
    if (/^h[1-6]$/.test(tag)) {
      const t = el.textContent;
      if (t && t.trim()) return t.trim().substring(0, MAX_LINE_LABEL);
    }
    if (tag === 'img') {
      const src = el.getAttribute('src');
      if (src) {
        const file = src.split('/').pop()?.split('?')[0];
        return `Image: ${file}`;
      }
    }
    let agg = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE) agg += n.textContent || '';
    }
    if (agg && agg.trim() && agg.trim().length >= 3) {
      const v = agg.trim();
      return v.length > 50 ? v.substring(0, 50) + '...' : v;
    }
    return '';
  }

  /**
   * Check if element is visible in DOM
   * @param {Element} el
   */
  function isVisible(el) {
    const cs = window.getComputedStyle(/** @type {HTMLElement} */ (el));
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const he = /** @type {HTMLElement} */ (el);
    return he.offsetWidth > 0 && he.offsetHeight > 0;
  }

  /**
   * Whether the element is interactive
   * @param {Element} el
   */
  function isInteractive(el) {
    // Native interactive tags
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'].includes(tag))
      return true;

    // Generic interactive hints
    if (el.getAttribute('onclick') != null) return true;
    if (
      el.getAttribute('tabindex') != null &&
      String(el.getAttribute('tabindex')).trim() !== '' &&
      !String(el.getAttribute('tabindex')).trim().startsWith('-')
    )
      return true;
    if (el.getAttribute('contenteditable') === 'true') return true;

    // ARIA roles commonly used by custom elements
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    const interactiveRoles = new Set([
      'button',
      'link',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'option',
      'menuitem',
      'textbox',
      'searchbox',
      'combobox',
      'spinbutton',
      'tab',
      'treeitem',
    ]);
    if (role && interactiveRoles.has(role.toLowerCase())) return true;

    // Shadow host case: treat host as interactive if its open shadow root contains
    // an interactive control (textarea/input/select/button/a or contenteditable).
    try {
      const anyEl = /** @type {any} */ (el);
      const sr = anyEl && anyEl.shadowRoot ? anyEl.shadowRoot : null;
      if (sr) {
        const inner = sr.querySelector(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="searchbox"], [role="menuitem"], [role="option"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="slider"]',
        );
        if (inner) return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  /**
   * Structural containers useful to include
   * @param {Element} el
   */
  function isStructural(el) {
    const tag = el.tagName.toLowerCase();
    if (
      [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'nav',
        'main',
        'header',
        'footer',
        'section',
        'article',
        'aside',
      ].includes(tag)
    )
      return true;
    return el.getAttribute('role') != null;
  }

  /**
   * Form-ish containers to keep
   * @param {Element} el
   */
  function isFormishContainer(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    const id = /** @type {HTMLElement} */ (el).id || '';
    // Normalize className for HTML/SVG elements
    let cls = '';
    try {
      const attr = el.getAttribute && el.getAttribute('class');
      if (typeof attr === 'string') cls = attr;
      else {
        const cn = /** @type {any} */ (el).className;
        if (typeof cn === 'string') cls = cn;
        else if (cn && typeof cn.baseVal === 'string') cls = cn.baseVal;
      }
    } catch (e) {
      /* ignore */
    }
    return (
      role === 'search' ||
      role === 'form' ||
      role === 'group' ||
      role === 'toolbar' ||
      role === 'navigation' ||
      tag === 'form' ||
      tag === 'fieldset' ||
      tag === 'nav' ||
      tag === 'legend' ||
      id.includes('search') ||
      cls.includes('search') ||
      id.includes('form') ||
      cls.includes('form') ||
      id.includes('menu') ||
      cls.includes('menu') ||
      id.includes('nav') ||
      cls.includes('nav')
    );
  }

  /**
   * Whether to include element in tree under config
   * @param {Element} el
   * @param {{filter?: 'all'|'interactive'}} cfg
   */
  function shouldInclude(el, cfg) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'meta', 'link', 'title', 'noscript'].includes(tag)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (!isVisible(el)) return false;
    if (cfg.filter !== 'all') {
      const r = /** @type {HTMLElement} */ (el).getBoundingClientRect();
      if (
        !(r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0)
      )
        return false;
    }
    if (cfg.filter === 'interactive') return isInteractive(el);
    if (isInteractive(el)) return true;
    if (isStructural(el)) return true;
    if (inferLabel(el).length > 0) return true;
    return isFormishContainer(el);
  }

  /**
   * Generate a fairly stable CSS selector
   * @param {Element} el
   * @returns {string}
   */
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

  /**
   * Traverse DOM and build pageContent lines; collect ref map for interactive nodes.
   * @param {Element} el
   * @param {number} depth
   * @param {{filter?: 'all'|'interactive'}} cfg
   * @param {string[]} out
   * @param {Array<{ref:string, selector:string, rect:{x:number,y:number,width:number,height:number}}>} refMap
   */
  function traverse(el, depth, cfg, out, refMap, state) {
    if (depth > MAX_DEPTH || !el || !el.tagName) return;
    if (state.processed >= MAX_NODES) return;
    if (state.visited.has(el)) return;
    state.visited.add(el);
    const include = shouldInclude(el, cfg) || depth === 0;
    if (include) {
      const role = inferRole(el);
      let label = inferLabel(el);
      let refId = null;
      for (const k in window.__claudeElementMap) {
        if (window.__claudeElementMap[k].deref && window.__claudeElementMap[k].deref() === el) {
          refId = k;
          break;
        }
      }
      if (!refId) {
        refId = `ref_${++window.__claudeRefCounter}`;
        window.__claudeElementMap[refId] = new WeakRef(el);
      }
      const rect = /** @type {HTMLElement} */ (el).getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      let line = `${'  '.repeat(depth)}- ${role}`;
      if (label) {
        label = label.replace(/\s+/g, ' ').substring(0, MAX_LINE_LABEL);
        line += ` "${label.replace(/"/g, '\\"')}"`;
      }
      line += ` [ref=${refId}] (x=${cx},y=${cy})`;
      if (/** @type {HTMLElement} */ (el).id) line += ` id="${/** @type {HTMLElement} */ (el).id}"`;
      const href = el.getAttribute('href');
      if (href) line += ` href="${href}"`;
      const type = el.getAttribute('type');
      if (type) line += ` type="${type}"`;
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) line += ` placeholder="${placeholder}"`;
      // Surface disabled/pointer-events for better agent judgement
      try {
        const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
        if (disabled) line += ` disabled`;
        const cs = window.getComputedStyle(/** @type {HTMLElement} */ (el));
        if (cs && cs.pointerEvents === 'none') line += ` pe=none`;
      } catch (_) {
        /* ignore style issues */
      }
      out.push(line);
      state.included++;
      state.processed++;

      // Only collect ref mapping for interactive elements to limit cost
      if (isInteractive(el) && refMap.length < REF_MAP_LIMIT) {
        refMap.push({
          ref: /** @type {string} */ (refId),
          selector: generateSelector(el),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
      }
    }
    if (state.processed >= MAX_NODES) return;
    // Traverse light DOM children
    if (/** @type {HTMLElement} */ (el).children && depth < MAX_DEPTH) {
      const children = /** @type {HTMLElement} */ (el).children;
      for (let i = 0; i < children.length; i++) {
        if (state.processed >= MAX_NODES) break;
        traverse(children[i], include ? depth + 1 : depth, cfg, out, refMap, state);
      }
    }
    // Traverse shadow DOM roots (limited by MAX_DEPTH and MAX_NODES)
    try {
      const anyEl = /** @type {any} */ (el);
      if (anyEl && anyEl.shadowRoot && depth < MAX_DEPTH) {
        const srChildren = anyEl.shadowRoot.children || [];
        for (let i = 0; i < srChildren.length; i++) {
          if (state.processed >= MAX_NODES) break;
          traverse(srChildren[i], include ? depth + 1 : depth, cfg, out, refMap, state);
        }
      }
    } catch (_) {
      /* ignore shadow errors */
    }
  }

  /**
   * Generate tree and return
   * @param {'all'|'interactive'|null} filter
   */
  function __generateAccessibilityTree(filter) {
    try {
      const start = performance && performance.now ? performance.now() : Date.now();
      const out = [];
      const cfg = { filter: filter || undefined };
      const refMap = [];
      const state = { processed: 0, included: 0, visited: new WeakSet() };
      if (document.body) traverse(document.body, 0, cfg, out, refMap, state);
      for (const k in window.__claudeElementMap) {
        if (!window.__claudeElementMap[k].deref || !window.__claudeElementMap[k].deref())
          delete window.__claudeElementMap[k];
      }
      const pageContent = out
        .filter((line) => !/^\s*- generic \[ref=ref_\d+\]$/.test(line))
        .join('\n');
      const end = performance && performance.now ? performance.now() : Date.now();
      return {
        pageContent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
        stats: {
          processed: state.processed,
          included: state.included,
          durationMs: Math.round(end - start),
        },
        refMap,
      };
    } catch (err) {
      throw new Error(
        'Error generating accessibility tree: ' +
          (err && err.message ? err.message : 'Unknown error'),
      );
    }
  }

  // Expose API on window
  window.__generateAccessibilityTree = __generateAccessibilityTree;

  // Chrome message bridge for ping and tree generation
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (request && request.action === 'chrome_read_page_ping') {
        sendResponse({ status: 'pong' });
        return false;
      }
      if (request && request.action === 'generateAccessibilityTree') {
        const result = __generateAccessibilityTree(request.filter || null);
        sendResponse({ success: true, ...result });
        return true;
      }
      if (request && request.action === 'ensureRefForSelector') {
        try {
          // Support CSS selector, XPath, or visible text search
          const useText = !!request.useText;
          const textQuery = String(request.text || '').trim();
          const sel = String(request.selector || '').trim();
          let el = null;
          if (useText && textQuery) {
            const all = Array.from(document.querySelectorAll('body *'));
            for (const node of all) {
              try {
                const cs = window.getComputedStyle(node);
                if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')
                  continue;
                const rect = /** @type {HTMLElement} */ (node).getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const txt = (node.textContent || '').trim();
                if (txt && txt.includes(textQuery)) {
                  el = node;
                  break;
                }
              } catch (_) {
                /* ignore */
              }
            }
          } else {
            if (!sel) {
              sendResponse({ success: false, error: 'selector is required' });
              return true;
            }
            el = document.querySelector(sel);
          }
          if (!el) {
            sendResponse({ success: false, error: `selector not found: ${sel}` });
            return true;
          }
          let refId = null;
          for (const k in window.__claudeElementMap) {
            if (window.__claudeElementMap[k].deref && window.__claudeElementMap[k].deref() === el) {
              refId = k;
              break;
            }
          }
          if (!refId) {
            refId = `ref_${++window.__claudeRefCounter}`;
            window.__claudeElementMap[refId] = new WeakRef(el);
          }
          const rect = /** @type {HTMLElement} */ (el).getBoundingClientRect();
          sendResponse({
            success: true,
            ref: refId,
            center: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            },
          });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'resolveRef') {
        const ref = request.ref;
        try {
          const map = window.__claudeElementMap;
          const weak = map && map[ref];
          const el = weak && typeof weak.deref === 'function' ? weak.deref() : null;
          if (!el || !(el instanceof Element)) {
            sendResponse({ success: false, error: `ref "${ref}" not found or expired` });
            return true;
          }
          const rect = /** @type {HTMLElement} */ (el).getBoundingClientRect();
          sendResponse({
            success: true,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            center: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            },
            selector: (function () {
              // Simple selector generation inline to avoid duplication
              const generateSelector = function (node) {
                if (!(node instanceof Element)) return '';
                if (node.id) {
                  const idSel = `#${CSS.escape(node.id)}`;
                  if (document.querySelectorAll(idSel).length === 1) return idSel;
                }
                for (const attr of ['data-testid', 'data-cy', 'name']) {
                  const val = node.getAttribute(attr);
                  if (val) {
                    const s = `[${attr}="${CSS.escape(val)}"]`;
                    if (document.querySelectorAll(s).length === 1) return s;
                  }
                }
                let path = '';
                let current = node;
                while (
                  current &&
                  current.nodeType === Node.ELEMENT_NODE &&
                  current.tagName !== 'BODY'
                ) {
                  let sel = current.tagName.toLowerCase();
                  const parent = current.parentElement;
                  if (parent) {
                    const siblings = Array.from(parent.children).filter(
                      (c) => c.tagName === current.tagName,
                    );
                    if (siblings.length > 1) {
                      const idx = siblings.indexOf(current) + 1;
                      sel += `:nth-of-type(${idx})`;
                    }
                  }
                  path = path ? `${sel} > ${path}` : sel;
                  current = parent;
                }
                return path ? `body > ${path}` : 'body';
              };
              return generateSelector(el);
            })(),
          });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
    } catch (e) {
      sendResponse({ success: false, error: e && e.message ? e.message : String(e) });
      return true;
    }
    return false;
  });

  console.log('Accessibility tree helper script loaded');
})();
