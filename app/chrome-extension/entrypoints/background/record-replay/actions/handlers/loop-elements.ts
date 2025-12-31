/**
 * LoopElements Action Handler
 *
 * Finds all elements matching a CSS selector in the target tab/frame, converts them into
 * unique CSS selectors, stores the list into variables, and returns a foreach control directive.
 *
 * Design notes:
 * - Uses ctx.tabId instead of querying the active tab (deterministic targeting)
 * - Uses ctx.frameId when present to stay consistent with other handlers
 */

import { failed, invalid, ok } from '../registry';
import type { ActionHandler, ControlDirective } from '../types';
import { resolveString } from './common';

const DEFAULT_LIST_VAR = 'elements';
const DEFAULT_ITEM_VAR = 'item';

type InjectedLoopElementsResult =
  | { success: true; selectors: string[] }
  | { success: false; error: string };

async function queryMatchingElementsAsUniqueSelectors(
  tabId: number,
  frameId: number | undefined,
  selector: string,
): Promise<{ ok: true; selectors: string[] } | { ok: false; error: string }> {
  const frameIds = typeof frameId === 'number' ? [frameId] : undefined;

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId, frameIds } as chrome.scripting.InjectionTarget,
      world: 'MAIN',
      func: (sel: string): InjectedLoopElementsResult => {
        try {
          const list = Array.from(document.querySelectorAll(sel));

          const toUniqueCssSelector = (node: Element): string => {
            // Prefer a unique ID selector when available
            try {
              const id = (node as HTMLElement).id;
              if (id) {
                const escaped =
                  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                    ? CSS.escape(id)
                    : id;
                const idSel = `#${escaped}`;
                if (document.querySelectorAll(idSel).length === 1) return idSel;
              }
            } catch {
              // fall through to path-based selector
            }

            // Fallback: build a body-rooted path with nth-of-type where needed
            let path = '';
            let current: Element | null = node;

            while (current && current.tagName !== 'BODY') {
              let part = current.tagName.toLowerCase();
              const parentEl: Element | null = current.parentElement;

              if (parentEl) {
                const siblings = Array.from(parentEl.children).filter(
                  (c) => c.tagName === current!.tagName,
                );
                if (siblings.length > 1) {
                  const idx = siblings.indexOf(current) + 1;
                  part += `:nth-of-type(${idx})`;
                }
              }

              path = path ? `${part} > ${path}` : part;
              current = parentEl;
            }

            return path ? `body > ${path}` : 'body';
          };

          return { success: true, selectors: list.map(toUniqueCssSelector) };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      args: [selector],
    });

    const result = Array.isArray(injected) ? injected[0]?.result : undefined;
    if (!result || typeof result !== 'object') {
      return { ok: false, error: 'loopElements script returned invalid result' };
    }

    const typed = result as { success: boolean; selectors?: unknown; error?: unknown };
    if (!typed.success) {
      return {
        ok: false,
        error: typeof typed.error === 'string' ? typed.error : 'loopElements query failed',
      };
    }

    if (!Array.isArray(typed.selectors) || typed.selectors.some((s) => typeof s !== 'string')) {
      return { ok: false, error: 'loopElements script returned invalid selectors' };
    }

    return { ok: true, selectors: typed.selectors as string[] };
  } catch (e) {
    return {
      ok: false,
      error: `Script execution failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const loopElementsHandler: ActionHandler<'loopElements'> = {
  type: 'loopElements',

  validate: (action) => {
    const params = action.params as {
      selector?: unknown;
      saveAs?: unknown;
      itemVar?: unknown;
      subflowId?: unknown;
    };

    if (params.selector === undefined) {
      return invalid('loopElements requires a selector');
    }

    if (!params.subflowId || typeof params.subflowId !== 'string') {
      return invalid('loopElements requires a subflowId (string)');
    }

    if (params.saveAs !== undefined && typeof params.saveAs !== 'string') {
      return invalid('loopElements saveAs must be a string');
    }

    if (params.itemVar !== undefined && typeof params.itemVar !== 'string') {
      return invalid('loopElements itemVar must be a string');
    }

    return ok();
  },

  describe: (action) => {
    const selector =
      typeof action.params.selector === 'string' ? action.params.selector : '(dynamic)';
    return `Loop elements: ${selector}`;
  },

  run: async (ctx, action) => {
    const tabId = ctx.tabId;
    if (typeof tabId !== 'number') {
      return failed('TAB_NOT_FOUND', 'No active tab found');
    }

    const selectorResolved = resolveString(action.params.selector, ctx.vars);
    if (!selectorResolved.ok) {
      return failed('VALIDATION_ERROR', selectorResolved.error);
    }

    const selector = selectorResolved.value.trim();
    if (!selector) {
      return failed('VALIDATION_ERROR', 'Selector is empty');
    }

    const queried = await queryMatchingElementsAsUniqueSelectors(tabId, ctx.frameId, selector);
    if (!queried.ok) {
      return failed('SCRIPT_FAILED', queried.error);
    }

    const listVarRaw = typeof action.params.saveAs === 'string' ? action.params.saveAs.trim() : '';
    const itemVarRaw =
      typeof action.params.itemVar === 'string' ? action.params.itemVar.trim() : '';

    const listVar = listVarRaw || DEFAULT_LIST_VAR;
    const itemVar = itemVarRaw || DEFAULT_ITEM_VAR;

    // Persist list for the downstream foreach control directive
    ctx.vars[listVar] = queried.selectors;

    // Always return a foreach directive, even for an empty list:
    // the runner can emit control events consistently (0 iterations is still a valid loop)
    const directive: ControlDirective = {
      kind: 'foreach',
      listVar,
      itemVar,
      subflowId: action.params.subflowId,
    };

    return {
      status: 'success',
      output: { elements: queried.selectors },
      control: directive,
    };
  },
};
