// rr-utils.ts — shared helpers for record-replay runner
// Note: comments in English

import {
  TOOL_NAMES,
  topoOrder as sharedTopoOrder,
  mapNodeToStep as sharedMapNodeToStep,
} from 'chrome-mcp-shared';
import type { Edge as DagEdge, NodeBase as DagNode, Step } from './types';
import { handleCallTool } from '../tools';
import { EDGE_LABELS } from 'chrome-mcp-shared';

export function applyAssign(
  target: Record<string, any>,
  source: any,
  assign: Record<string, string>,
) {
  const getByPath = (obj: any, path: string) => {
    try {
      const parts = path
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
      let cur = obj;
      for (const p of parts) {
        if (cur == null) return undefined;
        cur = (cur as any)[p as any];
      }
      return cur;
    } catch {
      return undefined;
    }
  };
  for (const [k, v] of Object.entries(assign || {})) {
    target[k] = getByPath(source, String(v));
  }
}

export function expandTemplatesDeep<T = any>(value: T, scope: Record<string, any>): T {
  const replaceOne = (s: string) =>
    s.replace(/\{([^}]+)\}/g, (_m, k) => (scope[k] ?? '').toString());
  const walk = (v: any): any => {
    if (v == null) return v;
    if (typeof v === 'string') return replaceOne(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (typeof v === 'object') {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

export async function ensureTab(options: {
  tabTarget?: 'current' | 'new';
  startUrl?: string;
  refresh?: boolean;
}): Promise<{ tabId: number; url?: string }> {
  const target = options.tabTarget || 'current';
  const startUrl = options.startUrl;
  const isWebUrl = (u?: string | null) => !!u && /^(https?:|file:)/i.test(u);

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const [active] = tabs.filter((t) => t.active);

  if (target === 'new') {
    let urlToOpen = startUrl;
    if (!urlToOpen) urlToOpen = isWebUrl(active?.url) ? active!.url! : 'about:blank';
    const created = await chrome.tabs.create({ url: urlToOpen, active: true });
    await new Promise((r) => setTimeout(r, 300));
    return { tabId: created.id!, url: created.url };
  }

  // current tab target
  if (startUrl) {
    await handleCallTool({ name: TOOL_NAMES.BROWSER.NAVIGATE, args: { url: startUrl } });
  } else if (options.refresh) {
    // only refresh if current tab is a web page
    if (isWebUrl(active?.url))
      await handleCallTool({ name: TOOL_NAMES.BROWSER.NAVIGATE, args: { refresh: true } });
  }

  // Re-evaluate active after potential navigation
  const cur = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  let tabId = cur?.id;
  let url = cur?.url;

  // If still on extension/internal page and no startUrl, try switch to an existing web tab
  if (!isWebUrl(url) && !startUrl) {
    const candidate = tabs.find((t) => isWebUrl(t.url));
    if (candidate?.id) {
      await chrome.tabs.update(candidate.id, { active: true });
      tabId = candidate.id;
      url = candidate.url;
    }
  }
  return { tabId: tabId!, url };
}

export {
  waitForNavigation,
  waitForNetworkIdle,
} from '@/entrypoints/background/replay-actions/engine/utils/wait';

export function topoOrder(nodes: DagNode[], edges: DagEdge[]): DagNode[] {
  return sharedTopoOrder(nodes, edges as any);
}

// Helper: filter only default edges (no label or label === 'default')
export function defaultEdgesOnly(edges: DagEdge[] = []): DagEdge[] {
  return (edges || []).filter((e) => !e.label || e.label === EDGE_LABELS.DEFAULT);
}

export function mapDagNodeToStep(n: DagNode): Step {
  const s: any = sharedMapNodeToStep(n as any);
  if ((n as any)?.type === 'if') {
    // forward extended conditional config for DAG mode
    const cfg: any = (n as any).config || {};
    if (Array.isArray(cfg.branches)) s.branches = cfg.branches;
    if ('else' in cfg) s.else = cfg.else;
    if (cfg.condition && !s.condition) s.condition = cfg.condition; // backward-compat
  }
  return s as Step;
}
