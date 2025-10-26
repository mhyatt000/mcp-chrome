// node-registry.ts — execute a single step
// Note: keep side-effects minimal; use provided helpers and ctx.logger for logs

import { TOOL_NAMES } from 'chrome-mcp-shared';
import { handleCallTool } from '../tools';
import type {
  RunLogEntry,
  Step,
  StepAssert,
  StepDrag,
  StepFill,
  StepKey,
  StepScroll,
  StepScript,
  StepWait,
} from './types';
import { locateElement } from './selector-engine';
import {
  applyAssign,
  expandTemplatesDeep,
  waitForNetworkIdle,
  waitForNavigation,
} from './rr-utils';

export interface ExecCtx {
  vars: Record<string, any>;
  logger: (e: RunLogEntry) => void;
  // Current frame context for same-origin iframe operations; undefined means top frame
  frameId?: number;
}

export interface ExecResult {
  alreadyLogged?: boolean;
  deferAfterScript?: StepScript | null;
  // next edge label to follow; supports 'true'/'false' (legacy) and
  // arbitrary labels like 'case:<id>' / 'case:else' for conditional branches
  nextLabel?: string;
  control?:
    | { kind: 'foreach'; listVar: string; itemVar: string; subflowId: string }
    | { kind: 'while'; condition: any; subflowId: string; maxIterations: number };
}

// NodeRuntime registry scaffolding (incremental adoption)
export interface NodeRuntime<S extends Step = Step> {
  validate?: (step: S) => { ok: boolean; errors?: string[] };
  run: (ctx: ExecCtx, step: S) => Promise<ExecResult | void>;
}

const registry: Partial<Record<Step['type'], NodeRuntime<any>>> = {
  http: {
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.NETWORK_REQUEST,
        args: {
          url: s.url,
          method: s.method || 'GET',
          headers: s.headers || {},
          body: s.body,
          formData: s.formData,
        },
      });
      const text = (res as any)?.content?.find((c: any) => c.type === 'text')?.text;
      try {
        const payload = text ? JSON.parse(text) : null;
        if (s.saveAs && payload !== undefined) ctx.vars[s.saveAs] = payload;
        if (s.assign && payload !== undefined) applyAssign(ctx.vars, payload, s.assign);
      } catch {}
    },
  },
  extract: {
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      if (typeof tabId !== 'number') throw new Error('Active tab not found');
      let value: any = null;
      if (s.js && String(s.js).trim()) {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (code: string) => {
            try {
              return (0, eval)(code);
            } catch (e) {
              return null;
            }
          },
          args: [String(s.js)],
        } as any);
        value = result;
      } else if (s.selector) {
        const attr = String(s.attr || 'text');
        const sel = String(s.selector);
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (selector: string, attr: string) => {
            try {
              const el = document.querySelector(selector) as any;
              if (!el) return null;
              if (attr === 'text' || attr === 'textContent') return (el.textContent || '').trim();
              return el.getAttribute ? el.getAttribute(attr) : null;
            } catch {
              return null;
            }
          },
          args: [sel, attr],
        } as any);
        value = result;
      }
      if (s.saveAs) ctx.vars[s.saveAs] = value;
    },
  },
  script: {
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      if (s.when === 'after') return { deferAfterScript: s };
      const world = s.world || 'ISOLATED';
      const code = String(s.code || '');
      if (!code.trim()) return {};
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      if (typeof tabId !== 'number') throw new Error('Active tab not found');
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (userCode: string) => {
          try {
            return (0, eval)(userCode);
          } catch {
            return null;
          }
        },
        args: [code],
        world: world as any,
      } as any);
      if (s.saveAs) ctx.vars[s.saveAs] = result;
      if (s.assign && typeof s.assign === 'object') applyAssign(ctx.vars, result, s.assign);
      return {};
    },
  },
  openTab: {
    run: async (_ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, {});
      if (s.newWindow) await chrome.windows.create({ url: s.url || undefined, focused: true });
      else await chrome.tabs.create({ url: s.url || undefined, active: true });
    },
  },
  switchTab: {
    run: async (_ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, {});
      let targetTabId: number | undefined = s.tabId;
      if (!targetTabId) {
        const tabs = await chrome.tabs.query({});
        const hit = tabs.find(
          (t) =>
            (s.urlContains && (t.url || '').includes(String(s.urlContains))) ||
            (s.titleContains && (t.title || '').includes(String(s.titleContains))),
        );
        targetTabId = (hit && hit.id) as number | undefined;
      }
      if (!targetTabId) throw new Error('switchTab: no matching tab');
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.SWITCH_TAB,
        args: { tabId: targetTabId },
      });
      if ((res as any).isError) throw new Error('switchTab failed');
    },
  },
  closeTab: {
    run: async (_ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, {});
      const args: any = {};
      if (Array.isArray(s.tabIds) && s.tabIds.length) args.tabIds = s.tabIds;
      if (s.url) args.url = s.url;
      const res = await handleCallTool({ name: TOOL_NAMES.BROWSER.CLOSE_TABS, args });
      if ((res as any).isError) throw new Error('closeTab failed');
    },
  },
  scroll: {
    run: async (_ctx, step: StepScroll) => {
      const s = step as StepScroll;
      const top = s.offset?.y ?? undefined;
      const left = s.offset?.x ?? undefined;
      const selectorFromTarget = (s.target?.candidates || []).find(
        (c) => c.type === 'css' || c.type === 'attr',
      )?.value;
      let code = '';
      if (s.mode === 'offset' && !s.target) {
        const t = top != null ? Number(top) : 'undefined';
        const l = left != null ? Number(left) : 'undefined';
        code = `try { window.scrollTo({ top: ${t}, left: ${l}, behavior: 'instant' }); } catch (e) {}`;
      } else if (s.mode === 'element' && selectorFromTarget) {
        code = `(() => { try { const el = document.querySelector(${JSON.stringify(selectorFromTarget)}); if (el) el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }); } catch (e) {} })();`;
      } else if (s.mode === 'container' && selectorFromTarget) {
        const t = top != null ? Number(top) : 'undefined';
        const l = left != null ? Number(left) : 'undefined';
        code = `(() => { try { const el = document.querySelector(${JSON.stringify(selectorFromTarget)}); if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: ${t}, left: ${l}, behavior: 'instant' }); } catch (e) {} })();`;
      } else {
        const direction = top != null && Number(top) < 0 ? 'up' : 'down';
        const amount = 3;
        const res = await handleCallTool({
          name: TOOL_NAMES.BROWSER.COMPUTER,
          args: { action: 'scroll', scrollDirection: direction, scrollAmount: amount },
        });
        if ((res as any).isError) throw new Error('scroll failed');
        return {};
      }
      if (code) {
        const res = await handleCallTool({
          name: TOOL_NAMES.BROWSER.INJECT_SCRIPT,
          args: { type: 'MAIN', jsScript: code },
        });
        if ((res as any).isError) throw new Error('scroll failed');
      }
      return {};
    },
  },
  drag: {
    run: async (_ctx, step: StepDrag) => {
      const s = step as StepDrag;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      let startRef: string | undefined;
      let endRef: string | undefined;
      try {
        if (typeof tabId === 'number') {
          const locatedStart = await locateElement(tabId, s.start);
          const locatedEnd = await locateElement(tabId, s.end);
          startRef = (locatedStart as any)?.ref || s.start.ref;
          endRef = (locatedEnd as any)?.ref || s.end.ref;
        }
      } catch {}
      let startCoordinates: { x: number; y: number } | undefined;
      let endCoordinates: { x: number; y: number } | undefined;
      if ((!startRef || !endRef) && Array.isArray(s.path) && s.path.length >= 2) {
        startCoordinates = { x: Number(s.path[0].x), y: Number(s.path[0].y) };
        const last = s.path[s.path.length - 1];
        endCoordinates = { x: Number(last.x), y: Number(last.y) };
      }
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.COMPUTER,
        args: {
          action: 'left_click_drag',
          startRef,
          ref: endRef,
          startCoordinates,
          coordinates: endCoordinates,
        },
      });
      if ((res as any).isError) throw new Error('drag failed');
    },
  },
  click: {
    validate: (step) => {
      const ok = !!(step as any).target?.candidates?.length;
      return ok ? { ok } : { ok, errors: ['缺少目标选择器候选'] };
    },
    run: async (ctx, step) => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const firstTab = tabs && tabs[0];
      const tabId = firstTab && typeof firstTab.id === 'number' ? firstTab.id : undefined;
      if (!tabId) throw new Error('Active tab not found');
      await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const located = await locateElement(tabId, s.target, ctx.frameId);
      const frameId = (located as any)?.frameId ?? ctx.frameId;
      const first = s.target?.candidates?.[0]?.type;
      const resolvedBy = (located as any)?.resolvedBy || ((located as any)?.ref ? 'ref' : '');
      const fallbackUsed = resolvedBy && first && resolvedBy !== 'ref' && resolvedBy !== first;
      if ((located as any)?.ref) {
        const resolved: any = (await chrome.tabs.sendMessage(
          tabId,
          { action: 'resolveRef', ref: (located as any).ref } as any,
          { frameId } as any,
        )) as any;
        const rect = resolved?.rect;
        if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('element not visible');
      }
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.CLICK,
        args: {
          ref: (located as any)?.ref || s.target?.ref,
          selector: !(located as any)?.ref
            ? s.target?.candidates?.find((c: any) => c.type === 'css' || c.type === 'attr')?.value
            : undefined,
          waitForNavigation: false,
          timeout: Math.max(1000, Math.min(s.timeoutMs || 10000, 30000)),
          frameId,
        },
      });
      if ((res as any).isError) throw new Error('click failed');
      if (fallbackUsed)
        ctx.logger({
          stepId: step.id,
          status: 'success',
          message: `Selector fallback used (${String(first)} -> ${String(resolvedBy)})`,
          fallbackUsed: true,
          fallbackFrom: String(first),
          fallbackTo: String(resolvedBy),
        } as any);
    },
  },
  dblclick: {
    validate: (step) => {
      const ok = !!(step as any).target?.candidates?.length;
      return ok ? { ok } : { ok, errors: ['缺少目标选择器候选'] };
    },
    run: async (ctx, step) => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const firstTab = tabs && tabs[0];
      const tabId = firstTab && typeof firstTab.id === 'number' ? firstTab.id : undefined;
      if (!tabId) throw new Error('Active tab not found');
      await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const located = await locateElement(tabId, s.target, ctx.frameId);
      const frameId = (located as any)?.frameId ?? ctx.frameId;
      const first = s.target?.candidates?.[0]?.type;
      const resolvedBy = (located as any)?.resolvedBy || ((located as any)?.ref ? 'ref' : '');
      const fallbackUsed = resolvedBy && first && resolvedBy !== 'ref' && resolvedBy !== first;
      if ((located as any)?.ref) {
        const resolved: any = (await chrome.tabs.sendMessage(
          tabId,
          { action: 'resolveRef', ref: (located as any).ref } as any,
          { frameId } as any,
        )) as any;
        const rect = resolved?.rect;
        if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('element not visible');
      }
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.COMPUTER,
        args: { action: 'double_click', ref: (located as any)?.ref || (step as any).target?.ref },
      });
      if ((res as any).isError) throw new Error('dblclick failed');
      if (fallbackUsed)
        ctx.logger({
          stepId: step.id,
          status: 'success',
          message: `Selector fallback used (${String(first)} -> ${String(resolvedBy)})`,
          fallbackUsed: true,
          fallbackFrom: String(first),
          fallbackTo: String(resolvedBy),
        } as any);
    },
  },
  fill: {
    validate: (step) => {
      const ok = !!(step as any).target?.candidates?.length && 'value' in (step as any);
      return ok ? { ok } : { ok, errors: ['缺少目标选择器候选或输入值'] };
    },
    run: async (ctx, step: StepFill) => {
      const s = step as any;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const firstTab = tabs && tabs[0];
      const tabId = firstTab && typeof firstTab.id === 'number' ? firstTab.id : undefined;
      if (!tabId) throw new Error('Active tab not found');
      await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
      const located = await locateElement(tabId, s.target, ctx.frameId);
      const frameId = (located as any)?.frameId ?? ctx.frameId;
      const first = s.target?.candidates?.[0]?.type;
      const resolvedBy = (located as any)?.resolvedBy || ((located as any)?.ref ? 'ref' : '');
      const fallbackUsed = resolvedBy && first && resolvedBy !== 'ref' && resolvedBy !== first;
      // Interpolate only when string; allow boolean/number for checkbox/range/number
      const interpolate = (v: any) =>
        typeof v === 'string'
          ? v.replace(/\{([^}]+)\}/g, (_m, k) => (ctx.vars[k] ?? '').toString())
          : v;
      const value = interpolate(s.value);
      if ((located as any)?.ref) {
        const resolved: any = (await chrome.tabs.sendMessage(
          tabId,
          { action: 'resolveRef', ref: (located as any).ref } as any,
          { frameId } as any,
        )) as any;
        const rect = resolved?.rect;
        if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('element not visible');
      }
      // Special-case: file inputs must use CDP setInputFiles (file upload tool) instead of value assignment
      // Prefer CSS/attr selector when available
      const cssSelector = !(located as any)?.ref
        ? s.target.candidates?.find((c) => c.type === 'css' || c.type === 'attr')?.value
        : undefined;
      if (cssSelector) {
        try {
          const attr: any = (await chrome.tabs.sendMessage(
            tabId,
            {
              action: 'getAttributeForSelector',
              selector: cssSelector,
              name: 'type',
            } as any,
            { frameId } as any,
          )) as any;
          const typeName = (attr && attr.value ? String(attr.value) : '').toLowerCase();
          if (typeName === 'file') {
            const uploadRes = await handleCallTool({
              name: TOOL_NAMES.BROWSER.FILE_UPLOAD,
              args: { selector: cssSelector, filePath: String(value ?? '') },
            });
            if ((uploadRes as any).isError) throw new Error('file upload failed');
            if (fallbackUsed)
              ctx.logger({
                stepId: step.id,
                status: 'success',
                message: `Selector fallback used (${String(first)} -> ${String(resolvedBy)})`,
                fallbackUsed: true,
                fallbackFrom: String(first),
                fallbackTo: String(resolvedBy),
              } as any);
            return {} as any;
          }
        } catch {
          // continue to normal fill on errors
        }
      }
      try {
        // Scroll into view then focus before filling
        if (cssSelector)
          await handleCallTool({
            name: TOOL_NAMES.BROWSER.INJECT_SCRIPT,
            args: {
              type: 'MAIN',
              jsScript: `try{var el=document.querySelector(${JSON.stringify(cssSelector)});if(el){el.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});} }catch(e){}`,
            },
          });
      } catch {}
      try {
        if ((located as any)?.ref)
          await chrome.tabs.sendMessage(
            tabId,
            { action: 'focusByRef', ref: (located as any).ref } as any,
            { frameId } as any,
          );
        else if (cssSelector)
          await handleCallTool({
            name: TOOL_NAMES.BROWSER.INJECT_SCRIPT,
            args: {
              type: 'MAIN',
              jsScript: `try{var el=document.querySelector(${JSON.stringify(cssSelector)});if(el&&el.focus){el.focus();}}catch(e){}`,
            },
          });
      } catch {}
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.FILL,
        args: {
          ref: (located as any)?.ref || s.target?.ref,
          selector: cssSelector,
          value,
          frameId,
        },
      });
      if ((res as any).isError) throw new Error('fill failed');
      if (fallbackUsed)
        ctx.logger({
          stepId: step.id,
          status: 'success',
          message: `Selector fallback used (${String(first)} -> ${String(resolvedBy)})`,
          fallbackUsed: true,
          fallbackFrom: String(first),
          fallbackTo: String(resolvedBy),
        } as any);
    },
  },
  key: {
    run: async (_ctx, step: StepKey) => {
      const s = expandTemplatesDeep(step as StepKey, {});
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.KEYBOARD,
        args: { keys: (s as StepKey).keys },
      });
      if ((res as any).isError) throw new Error('key failed');
    },
  },
  wait: {
    validate: (step) => {
      const ok = !!(step as any).condition;
      return ok ? { ok } : { ok, errors: ['缺少等待条件'] };
    },
    run: async (_ctx, step: StepWait) => {
      const s = expandTemplatesDeep(step as StepWait, {});
      const cond = (s as StepWait).condition as
        | { selector: string; visible?: boolean }
        | { text: string; appear?: boolean }
        | { navigation: true }
        | { networkIdle: true }
        | { sleep: number };
      if ('text' in cond) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        if (typeof tabId !== 'number') throw new Error('Active tab not found');
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['inject-scripts/wait-helper.js'],
          world: 'ISOLATED',
        } as any);
        const resp: any = (await chrome.tabs.sendMessage(
          tabId,
          {
            action: 'waitForText',
            text: cond.text,
            appear: cond.appear !== false,
            timeout: Math.max(0, Math.min((s as any).timeoutMs || 10000, 120000)),
          } as any,
          { frameId: ctx.frameId } as any,
        )) as any;
        if (!resp || resp.success !== true) throw new Error('wait text failed');
      } else if ('networkIdle' in cond) {
        const total = Math.min(Math.max(1000, (s as any).timeoutMs || 5000), 120000);
        const idle = Math.min(1500, Math.max(500, Math.floor(total / 3)));
        await waitForNetworkIdle(total, idle);
      } else if ('navigation' in cond) {
        await waitForNavigation((s as any).timeoutMs);
      } else if ('sleep' in cond) {
        const ms = Math.max(0, Number(cond.sleep ?? 0));
        await new Promise((r) => setTimeout(r, ms));
      } else if ('selector' in cond) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        if (typeof tabId !== 'number') throw new Error('Active tab not found');
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['inject-scripts/wait-helper.js'],
          world: 'ISOLATED',
        } as any);
        const resp: any = (await chrome.tabs.sendMessage(tabId, {
          action: 'waitForSelector',
          selector: cond.selector,
          visible: cond.visible !== false,
          timeout: Math.max(0, Math.min((s as any).timeoutMs || 10000, 120000)),
        } as any)) as any;
        if (!resp || resp.success !== true) throw new Error('wait selector failed');
      }
    },
  },
  assert: {
    validate: (step) => {
      const s = step as any;
      const ok = !!s.assert;
      // basic shape checks for attribute
      if (ok && s.assert && 'attribute' in s.assert) {
        const a = s.assert.attribute || {};
        if (!a.selector || !a.name)
          return { ok: false, errors: ['assert.attribute: 需提供 selector 与 name'] };
      }
      return ok ? { ok } : { ok, errors: ['缺少断言条件'] };
    },
    run: async (ctx, step: StepAssert) => {
      const s = expandTemplatesDeep(step as StepAssert, {}) as StepAssert;
      const failStrategy = (s as any).failStrategy || 'stop';
      const fail = (msg: string) => {
        if (failStrategy === 'warn') {
          ctx.logger({ stepId: step.id, status: 'warning', message: msg });
          return { alreadyLogged: true } as any;
        }
        // retry/stop -> throw to let runner decide by step.retry
        throw new Error(msg);
      };
      if ('textPresent' in s.assert) {
        const text = (s.assert as any).textPresent;
        const res = await handleCallTool({
          name: TOOL_NAMES.BROWSER.COMPUTER,
          args: { action: 'wait', text, appear: true, timeout: (step as any).timeoutMs || 5000 },
        });
        if ((res as any).isError) return fail('assert text failed');
      } else if ('exists' in s.assert || 'visible' in s.assert) {
        const selector = (s.assert as any).exists || (s.assert as any).visible;
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const firstTab = tabs && tabs[0];
        const tabId = firstTab && typeof firstTab.id === 'number' ? firstTab.id : undefined;
        if (!tabId) return fail('Active tab not found');
        await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
        const ensured: any = (await chrome.tabs.sendMessage(tabId, {
          action: 'ensureRefForSelector',
          selector,
        } as any)) as any;
        if (!ensured || !ensured.success) return fail('assert selector not found');
        if ('visible' in s.assert) {
          const rect = ensured && ensured.center ? ensured.center : null;
          if (!rect) return fail('assert visible failed');
        }
      } else if ('attribute' in s.assert) {
        const { selector, name, equals, matches } = (s.assert as any).attribute || {};
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const firstTab = tabs && tabs[0];
        const tabId = firstTab && typeof firstTab.id === 'number' ? firstTab.id : undefined;
        if (!tabId) return fail('Active tab not found');
        await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
        const resp: any = (await chrome.tabs.sendMessage(
          tabId,
          { action: 'getAttributeForSelector', selector, name } as any,
          { frameId: ctx.frameId } as any,
        )) as any;
        if (!resp || !resp.success) return fail('assert attribute: element not found');
        const actual: string | null = resp.value ?? null;
        if (equals !== undefined && equals !== null) {
          const expected = String(equals);
          if (String(actual) !== String(expected))
            return fail(
              `assert attribute equals failed: ${name} actual=${String(actual)} expected=${String(expected)}`,
            );
        } else if (matches !== undefined && matches !== null) {
          try {
            const re = new RegExp(String(matches));
            if (!re.test(String(actual)))
              return fail(
                `assert attribute matches failed: ${name} actual=${String(actual)} regex=${String(matches)}`,
              );
          } catch {
            return fail(`invalid regex for attribute matches: ${String(matches)}`);
          }
        } else {
          if (actual == null) return fail(`assert attribute failed: ${name} missing`);
        }
      }
      return {} as any;
    },
  },
  navigate: {
    validate: (step) => {
      const ok = !!(step as any).url;
      return ok ? { ok } : { ok, errors: ['缺少 URL'] };
    },
    run: async (_ctx, step) => {
      const url = (step as any).url;
      const res = await handleCallTool({ name: TOOL_NAMES.BROWSER.NAVIGATE, args: { url } });
      if ((res as any).isError) throw new Error('navigate failed');
    },
  },
  if: {
    validate: (step) => {
      const s = step as any;
      const hasBranches = Array.isArray(s.branches) && s.branches.length > 0;
      const ok = hasBranches || !!s.condition;
      return ok ? { ok } : { ok, errors: ['缺少条件或分支'] };
    },
    run: async (ctx, step) => {
      const s: any = step;
      // Branch-first evaluation when branches[] provided; fallback to legacy condition
      if (Array.isArray(s.branches) && s.branches.length > 0) {
        // evaluate in order; first matched wins
        const evalExpr = (expr: string): boolean => {
          const code = String(expr || '').trim();
          if (!code) return false;
          try {
            // Note: basic eval with limited scope. Support both `vars` and legacy `workflow` identifiers.
            // This preserves backward compatibility with older expressions written as `workflow.xxx`.
            const fn = new Function(
              'vars',
              'workflow',
              `try { return !!(${code}); } catch (e) { return false; }`,
            );
            return !!fn(ctx.vars, ctx.vars);
          } catch {
            return false;
          }
        };
        for (const b of s.branches) {
          if (evalExpr(b.expr)) return { nextLabel: `case:${String(b.id)}` } as ExecResult;
        }
        // none matched
        return { nextLabel: s.else === false ? 'default' : 'case:else' } as ExecResult;
      } else {
        // legacy single condition -> true/false
        const cond = s.condition || {};
        let result = false;
        try {
          if (typeof cond.expression === 'string' && cond.expression.trim()) {
            const fn = new Function(
              'vars',
              `try { return !!(${cond.expression}); } catch (e) { return false; }`,
            );
            result = !!fn(ctx.vars);
          } else if (typeof cond.var === 'string') {
            const v = ctx.vars[cond.var];
            if ('equals' in cond) result = String(v) === String(cond.equals);
            else result = !!v;
          }
        } catch {
          result = false;
        }
        return { nextLabel: result ? 'true' : 'false' } as ExecResult;
      }
    },
  },
  foreach: {
    validate: (step) => {
      const s = step as any;
      const ok =
        typeof s.listVar === 'string' &&
        s.listVar &&
        typeof s.subflowId === 'string' &&
        s.subflowId;
      return ok ? { ok } : { ok, errors: ['foreach: 需提供 listVar 与 subflowId'] };
    },
    run: async (_ctx, step) => {
      const s: any = step;
      const itemVar = typeof s.itemVar === 'string' && s.itemVar ? s.itemVar : 'item';
      return {
        control: {
          kind: 'foreach',
          listVar: String(s.listVar),
          itemVar,
          subflowId: String(s.subflowId),
        },
      } as ExecResult;
    },
  },
  while: {
    validate: (step) => {
      const s = step as any;
      const ok = !!s.condition && typeof s.subflowId === 'string' && s.subflowId;
      return ok ? { ok } : { ok, errors: ['while: 需提供 condition 与 subflowId'] };
    },
    run: async (_ctx, step) => {
      const s: any = step;
      const max = Math.max(1, Math.min(10000, Number(s.maxIterations ?? 100)));
      return {
        control: {
          kind: 'while',
          condition: s.condition,
          subflowId: String(s.subflowId),
          maxIterations: max,
        },
      } as ExecResult;
    },
  },
  executeFlow: {
    validate: (step) => {
      const s: any = step;
      const ok = typeof s.flowId === 'string' && !!s.flowId;
      return ok ? { ok } : { ok, errors: ['需提供 flowId'] };
    },
    run: async (ctx, step) => {
      const s: any = step;
      const { getFlow } = await import('./flow-store');
      const flow = await getFlow(String(s.flowId));
      if (!flow) throw new Error('referenced flow not found');
      const inline = s.inline !== false; // default inline
      if (!inline) {
        const { runFlow } = await import('./flow-runner');
        await runFlow(flow, { args: s.args || {}, returnLogs: false });
        return;
      }
      // Inline: execute referenced flow's steps with current ctx/vars
      const {
        defaultEdgesOnly,
        topoOrder,
        mapDagNodeToStep,
        waitForNetworkIdle,
        waitForNavigation,
      } = await import('./rr-utils');
      const vars = ctx.vars;
      if (s.args && typeof s.args === 'object') Object.assign(vars, s.args);
      const hasDag = Array.isArray((flow as any).nodes) && (flow as any).nodes.length > 0;
      const nodes = hasDag ? (((flow as any).nodes || []) as any[]) : [];
      const edges = hasDag ? (((flow as any).edges || []) as any[]) : [];
      const defaultEdges = hasDag ? defaultEdgesOnly(edges as any) : [];
      const order = hasDag ? topoOrder(nodes as any, defaultEdges as any) : [];
      const stepsToRun: any[] = hasDag
        ? order.map((n) => mapDagNodeToStep(n as any))
        : ((flow.steps || []) as any[]);
      for (const st of stepsToRun) {
        const t0 = Date.now();
        const maxRetries = Math.max(0, (st as any).retry?.count ?? 0);
        const baseInterval = Math.max(0, (st as any).retry?.intervalMs ?? 0);
        let attempt = 0;
        const doDelay = async (i: number) => {
          const delay =
            baseInterval > 0
              ? (st as any).retry?.backoff === 'exp'
                ? baseInterval * Math.pow(2, i)
                : baseInterval
              : 0;
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        };
        while (true) {
          try {
            const beforeInfo = await (async () => {
              const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
              const tab = tabs[0];
              return { url: tab?.url || '', status: (tab as any)?.status || '' };
            })();
            const result = await executeStep(ctx, st as any);
            if ((st.type === 'click' || st.type === 'dblclick') && (st as any).after) {
              const after = (st as any).after as any;
              if (after.waitForNavigation)
                await waitForNavigation((st as any).timeoutMs, beforeInfo.url);
              else if (after.waitForNetworkIdle)
                await waitForNetworkIdle(Math.min((st as any).timeoutMs || 5000, 120000), 1200);
            }
            if (!result?.alreadyLogged)
              ctx.logger({ stepId: st.id, status: 'success', tookMs: Date.now() - t0 } as any);
            break;
          } catch (e: any) {
            if (attempt < maxRetries) {
              ctx.logger({
                stepId: st.id,
                status: 'retrying',
                message: e?.message || String(e),
              } as any);
              await doDelay(attempt);
              attempt += 1;
              continue;
            }
            ctx.logger({
              stepId: st.id,
              status: 'failed',
              message: e?.message || String(e),
              tookMs: Date.now() - t0,
            } as any);
            throw e;
          }
        }
      }
    },
  },
  handleDownload: {
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const args: any = {
        filenameContains: s.filenameContains || undefined,
        timeoutMs: Math.max(1000, Math.min(Number(s.timeoutMs ?? 60000), 300000)),
        waitForComplete: s.waitForComplete !== false,
      };
      const res = await handleCallTool({ name: TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD, args });
      const text = (res as any)?.content?.find((c: any) => c.type === 'text')?.text;
      try {
        const payload = text ? JSON.parse(text) : null;
        if (s.saveAs && payload && payload.download) ctx.vars[s.saveAs] = payload.download;
      } catch {}
    },
  },
  // P0: screenshot node (wrapper around screenshot tool)
  screenshot: {
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const args: any = { name: 'workflow', storeBase64: true };
      if (s.fullPage) args.fullPage = true;
      if (s.selector && typeof s.selector === 'string' && s.selector.trim())
        args.selector = s.selector;
      const res = await handleCallTool({ name: TOOL_NAMES.BROWSER.SCREENSHOT, args });
      const text = (res as any)?.content?.find((c: any) => c.type === 'text')?.text;
      try {
        const payload = text ? JSON.parse(text) : null;
        if (s.saveAs && payload && payload.base64Data) ctx.vars[s.saveAs] = payload.base64Data;
      } catch {}
    },
  },
  // P0: trigger custom DOM event
  triggerEvent: {
    validate: (step) => {
      const s: any = step;
      const ok = !!s?.target?.candidates?.length && typeof s?.event === 'string' && s.event;
      return ok ? { ok } : { ok, errors: ['缺少目标选择器或事件类型'] };
    },
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      if (typeof tabId !== 'number') throw new Error('Active tab not found');
      await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
      const located = await locateElement(tabId, s.target, ctx.frameId);
      const cssSelector = !(located as any)?.ref
        ? s.target.candidates?.find((c: any) => c.type === 'css' || c.type === 'attr')?.value
        : undefined;
      let sel = cssSelector as string | undefined;
      if (!sel && (located as any)?.ref) {
        try {
          const resolved: any = (await chrome.tabs.sendMessage(
            tabId,
            { action: 'resolveRef', ref: (located as any).ref } as any,
            { frameId } as any,
          )) as any;
          sel = resolved?.selector;
        } catch {}
      }
      if (!sel) throw new Error('triggerEvent: selector not resolved');
      const world: any = 'MAIN';
      const ev = String(s.event || '').trim();
      const bubbles = s.bubbles !== false;
      const cancelable = s.cancelable === true;
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: typeof frameId === 'number' ? [frameId] : undefined } as any,
        world,
        func: (selector: string, type: string, bubbles: boolean, cancelable: boolean) => {
          try {
            const el = document.querySelector(selector);
            if (!el) return false;
            const e = new Event(type, { bubbles, cancelable });
            el.dispatchEvent(e);
            return true;
          } catch (e) {
            return false;
          }
        },
        args: [sel, ev, !!bubbles, !!cancelable],
      } as any);
    },
  },
  // P0: set attribute node
  setAttribute: {
    validate: (step) => {
      const s: any = step;
      const ok = !!s?.target?.candidates?.length && typeof s?.name === 'string' && s.name;
      return ok ? { ok } : { ok, errors: ['需提供目标选择器与属性名'] };
    },
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      if (typeof tabId !== 'number') throw new Error('Active tab not found');
      await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
      const located = await locateElement(tabId, s.target, ctx.frameId);
      const frameId = (located as any)?.frameId ?? ctx.frameId;
      const cssSelector = !(located as any)?.ref
        ? s.target.candidates?.find((c: any) => c.type === 'css' || c.type === 'attr')?.value
        : undefined;
      let sel = cssSelector as string | undefined;
      if (!sel && (located as any)?.ref) {
        try {
          const resolved: any = (await chrome.tabs.sendMessage(
            tabId,
            { action: 'resolveRef', ref: (located as any).ref } as any,
            { frameId } as any,
          )) as any;
          sel = resolved?.selector;
        } catch {}
      }
      if (!sel) throw new Error('setAttribute: selector not resolved');
      const world: any = 'MAIN';
      const name = String(s.name || '');
      const value = s.value != null ? String(s.value) : null;
      const remove = s.remove === true || value == null;
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: typeof frameId === 'number' ? [frameId] : undefined } as any,
        world,
        func: (selector: string, name: string, value: string | null, remove: boolean) => {
          try {
            const el = document.querySelector(selector) as any;
            if (!el) return false;
            if (remove) {
              el.removeAttribute(name);
              return true;
            }
            el.setAttribute(name, String(value ?? ''));
            return true;
          } catch {
            return false;
          }
        },
        args: [sel, name, value, remove],
      } as any);
    },
  },
  // P0: switch to a same-origin iframe by index or url substring
  switchFrame: {
    run: async (ctx, step) => {
      const s: any = step;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      if (typeof tabId !== 'number') throw new Error('Active tab not found');
      // discover frames via webNavigation API
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (!Array.isArray(frames) || frames.length === 0) {
        ctx.frameId = undefined;
        return;
      }
      // choose by index (excluding 0 which is top frame)
      let target: any | undefined;
      const idx = Number(s?.frame?.index ?? NaN);
      if (Number.isFinite(idx)) {
        const list = frames.filter((f) => f.frameId !== 0);
        target = list[Math.max(0, Math.min(list.length - 1, idx))];
      }
      // choose by urlContains if provided
      const urlContains = String(s?.frame?.urlContains || '').trim();
      if (!target && urlContains)
        target = frames.find((f) => typeof f.url === 'string' && f.url.includes(urlContains));
      // fallback to top (clear)
      if (!target) ctx.frameId = undefined;
      else ctx.frameId = target.frameId;
      // ensure helper injected into all frames for subsequent operations
      try {
        await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
      } catch {}
      ctx.logger({
        stepId: step.id,
        status: 'success',
        message: `frameId=${String(ctx.frameId ?? 'top')}`,
      } as any);
    },
  },
  // P0: loop over elements matching a selector and branch into subflow
  loopElements: {
    validate: (step) => {
      const s: any = step;
      const ok =
        typeof s?.selector === 'string' &&
        s.selector &&
        typeof s?.subflowId === 'string' &&
        s.subflowId;
      return ok ? { ok } : { ok, errors: ['需提供 selector 与 subflowId'] };
    },
    run: async (ctx, step) => {
      const s: any = expandTemplatesDeep(step as any, ctx.vars);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs?.[0]?.id;
      if (typeof tabId !== 'number') throw new Error('Active tab not found');
      const world: any = 'MAIN';
      const selector = String(s.selector || '');
      const res = await chrome.scripting.executeScript({
        target: {
          tabId,
          frameIds: typeof ctx.frameId === 'number' ? [ctx.frameId] : undefined,
        } as any,
        world,
        func: (sel: string) => {
          try {
            const list = Array.from(document.querySelectorAll(sel));
            const toCss = (node: Element) => {
              try {
                if ((node as HTMLElement).id) {
                  const idSel = `#${CSS.escape((node as HTMLElement).id)}`;
                  if (document.querySelectorAll(idSel).length === 1) return idSel;
                }
              } catch {}
              let path = '';
              let current: Element | null = node;
              while (current && current.tagName !== 'BODY') {
                let part = current.tagName.toLowerCase();
                const parent = current.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.children).filter(
                    (c) => (c as any).tagName === current!.tagName,
                  );
                  if (siblings.length > 1) {
                    const idx = siblings.indexOf(current) + 1;
                    part += `:nth-of-type(${idx})`;
                  }
                }
                path = path ? `${part} > ${path}` : part;
                current = parent;
              }
              return path ? `body > ${path}` : 'body';
            };
            return list.map(toCss);
          } catch (e) {
            return [];
          }
        },
        args: [selector],
      } as any);
      const arr: string[] = (res && Array.isArray(res[0]?.result) ? res[0].result : []) as any;
      const listVar = String(s.saveAs || 'elements');
      const itemVar = String(s.itemVar || 'item');
      ctx.vars[listVar] = arr;
      return {
        control: { kind: 'foreach', listVar, itemVar, subflowId: String(s.subflowId) },
      } as any;
    },
  },
};

// New unified executeStep using registry only
export async function executeStep(ctx: ExecCtx, step: Step): Promise<ExecResult> {
  const runtime = (registry as any)[step.type] as NodeRuntime<any> | undefined;
  if (!runtime) throw new Error(`unsupported step type: ${String(step.type)}`);
  const v = runtime.validate ? runtime.validate(step as any) : { ok: true };
  if (!(v as any).ok) throw new Error(((v as any).errors || []).join(', ') || 'validation failed');
  const out = await runtime.run(ctx, step as any);
  return (out || {}) as ExecResult;
}
