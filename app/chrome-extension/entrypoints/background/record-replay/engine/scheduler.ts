// engine/scheduler.ts — DAG-only orchestrator for record-replay
// Note: consolidates wait/retry/logging and delegates node execution to nodes/* registry

import { TOOL_NAMES } from 'chrome-mcp-shared';
import { handleCallTool } from '@/entrypoints/background/tools';
import type { Flow, RunLogEntry, RunResult, Step, StepScript } from '../types';
import {
  mapDagNodeToStep,
  topoOrder,
  ensureTab,
  expandTemplatesDeep,
  waitForNetworkIdle,
  applyAssign,
  defaultEdgesOnly,
} from '../rr-utils';
import { executeStep, type ExecCtx } from '../nodes';
import { RunLogger } from './logging/run-logger';
import { PluginManager } from './plugins/manager';
import type { RunPlugin } from './plugins/types';
import { breakpointPlugin } from './plugins/breakpoint';
import { waitForNavigationDone, maybeQuickWaitForNav, ensureReadPageIfWeb } from './policies/wait';
import { withRetry } from './policies/retry';
import { runState } from './state-manager';

export interface RunOptions {
  tabTarget?: 'current' | 'new';
  refresh?: boolean;
  captureNetwork?: boolean;
  returnLogs?: boolean;
  timeoutMs?: number;
  startUrl?: string;
  args?: Record<string, any>;
  startNodeId?: string;
  plugins?: RunPlugin[];
}

export async function runFlow(flow: Flow, options: RunOptions = {}): Promise<RunResult> {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startAt = Date.now();
  const logger = new RunLogger(runId);
  const pluginManager = new PluginManager(
    options.plugins && options.plugins.length ? options.plugins : [breakpointPlugin()],
  );

  // Global deadline for run (optional)
  const globalTimeout = Math.max(0, Number(options.timeoutMs || 0));
  const deadline = globalTimeout > 0 ? startAt + globalTimeout : 0;
  const ensureWithinDeadline = () => {
    if (deadline > 0 && Date.now() > deadline) {
      const err = new Error('Global timeout reached');
      logger.push({
        stepId: 'global-timeout',
        status: 'failed',
        message: 'Global timeout reached',
      });
      throw err;
    }
  };

  // prepare variables
  const vars: Record<string, any> = Object.create(null);
  for (const v of flow.variables || []) if (v.default !== undefined) vars[v.key] = v.default;
  if (options.args) Object.assign(vars, options.args);

  // Derive a default startUrl when not provided: prefer first navigate step
  let derivedStartUrl: string | undefined = undefined;
  try {
    const hasDag0 = Array.isArray((flow as any).nodes) && (flow as any).nodes.length > 0;
    const nodes0 = hasDag0 ? (((flow as any).nodes || []) as any[]) : [];
    const edges0 = hasDag0 ? (((flow as any).edges || []) as any[]) : [];
    const defaultEdges0 = hasDag0 ? defaultEdgesOnly(edges0 as any) : [];
    const order0 = hasDag0 ? topoOrder(nodes0 as any, defaultEdges0 as any) : [];
    const steps0: Step[] = hasDag0 ? order0.map((n) => mapDagNodeToStep(n as any)) : [];
    const nav = steps0.find((s: any) => s && (s as any).type === 'navigate') as any;
    if (nav && typeof nav.url === 'string') derivedStartUrl = expandTemplatesDeep(nav.url, {});
  } catch {}

  const ensured = await ensureTab({
    tabTarget: options.tabTarget,
    startUrl: options.startUrl || derivedStartUrl,
    refresh: options.refresh,
  });

  // register run state
  try {
    await runState.restore();
    await runState.add(runId, {
      id: runId,
      flowId: flow.id,
      name: flow.name,
      status: 'running',
      startedAt: startAt,
      updatedAt: startAt,
    });
  } catch {}

  // plugins: run start
  await pluginManager.runStart({ runId, flow, vars });

  // pre-load read_page to init bridges only when on a web page
  try {
    const u = ensured?.url || '';
    if (/^(https?:|file:)/i.test(u)) {
      await handleCallTool({ name: TOOL_NAMES.BROWSER.READ_PAGE, args: {} });
    }
  } catch {}

  // collect required variables via overlay prompt
  try {
    const needed = (flow.variables || []).filter(
      (v) =>
        (options.args?.[v.key] == null || options.args?.[v.key] === '') &&
        (v.rules?.required || (v.default ?? '') === ''),
    );
    if (needed.length) {
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT,
        args: {
          eventName: 'collectVariables',
          payload: JSON.stringify({ variables: needed, useOverlay: true }),
        },
      });
      let values: Record<string, any> | null = null;
      try {
        const t = (res?.content || []).find((c: any) => c.type === 'text')?.text;
        const j = t ? JSON.parse(t) : null;
        if (j && j.success && j.values) values = j.values;
      } catch {}
      if (!values) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        if (typeof tabId === 'number') {
          const res2 = await chrome.tabs.sendMessage(tabId, {
            action: 'collectVariables',
            variables: needed,
            useOverlay: true,
          } as any);
          if (res2 && res2.success && res2.values) values = res2.values;
        }
      }
      if (values) Object.assign(vars, values);
    }
  } catch {}

  await logger.overlayInit();

  // binding enforcement
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentUrl = tabs?.[0]?.url || '';
    const bindings = flow.meta?.bindings || [];
    if (!options.startUrl && bindings.length > 0) {
      const ok = bindings.some((b) => {
        try {
          if (b.type === 'domain') return new URL(currentUrl).hostname.includes(b.value);
          if (b.type === 'path') return new URL(currentUrl).pathname.startsWith(b.value);
          if (b.type === 'url') return currentUrl.startsWith(b.value);
        } catch {}
        return false;
      });
      if (!ok) {
        return {
          runId,
          success: false,
          summary: { total: 0, success: 0, failed: 0, tookMs: 0 },
          url: currentUrl,
          outputs: null,
          logs: [
            {
              stepId: 'binding-check',
              status: 'failed',
              message:
                'Flow binding mismatch. Provide startUrl or open a page matching flow.meta.bindings.',
            },
          ],
          screenshots: { onFailure: null },
        } as RunResult;
      }
    }
  } catch {}

  // long-running network capture (debugger) if requested
  let networkCaptureStarted = false;
  const stopAndSummarizeNetwork = async () => {
    try {
      const stopRes = await handleCallTool({
        name: TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_STOP,
        args: {},
      });
      const text = (stopRes?.content || []).find((c: any) => c.type === 'text')?.text;
      if (!text) return;
      const data = JSON.parse(text);
      const requests: any[] = Array.isArray(data?.requests) ? data.requests : [];
      const snippets = requests
        .filter((r) => ['XHR', 'Fetch'].includes(String(r.type)))
        .slice(0, 10)
        .map((r) => ({
          method: String(r.method || 'GET'),
          url: String(r.url || ''),
          status: r.statusCode || r.status,
          ms: Math.max(0, (r.responseTime || 0) - (r.requestTime || 0)),
        }));
      logger.push({
        stepId: 'network-capture',
        status: 'success',
        message: `Captured ${Number(data?.requestCount || 0)} requests` as any,
        networkSnippets: snippets,
      } as any);
    } catch {}
  };
  if (options.captureNetwork) {
    try {
      const res = await handleCallTool({
        name: TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_START,
        args: { includeStatic: false, maxCaptureTime: 3 * 60_000, inactivityTimeout: 0 },
      });
      if (!(res as any)?.isError) networkCaptureStarted = true;
    } catch {}
  }

  // DAG required
  const hasDag = Array.isArray((flow as any).nodes) && (flow as any).nodes.length > 0;
  if (!hasDag) {
    await logger.overlayDone();
    return {
      runId,
      success: false,
      summary: { total: 0, success: 0, failed: 0, tookMs: 0 },
      url: null,
      outputs: null,
      logs: [
        {
          stepId: 'dag-required',
          status: 'failed',
          message:
            'Flow has no DAG nodes. Linear steps are no longer supported. Please migrate this flow to nodes/edges.',
        },
      ],
      screenshots: { onFailure: null },
    } as RunResult;
  }

  const nodes = ((flow as any).nodes || []) as any[];
  const edges = ((flow as any).edges || []) as any[];
  const defaultEdges = defaultEdgesOnly(edges as any);
  const order = topoOrder(nodes as any, defaultEdges as any);
  const stepsToRun: Step[] = order.map((n) => mapDagNodeToStep(n as any));
  const steps = stepsToRun;

  let failed = 0;
  let paused = false;
  const ctx: ExecCtx = { vars, logger: (e: RunLogEntry) => logger.push(e) };
  const pendingAfterScripts: StepScript[] = [];

  const appendOverlayOk = (s: Step) => logger.overlayAppend(`✔ ${s.type} (${s.id})`);
  const appendOverlayFail = (s: Step, err: any) =>
    logger.overlayAppend(`✘ ${s.type} (${s.id}) -> ${err?.message || String(err)}`);

  const evalCondition = (cond: any): boolean => {
    try {
      if (cond && typeof cond.expression === 'string' && cond.expression.trim()) {
        const fn = new Function(
          'vars',
          `try { return !!(${cond.expression}); } catch (e) { return false; }`,
        );
        return !!fn(vars);
      }
      if (cond && typeof cond.var === 'string') {
        const v = vars[cond.var];
        if ('equals' in cond) return String(v) === String(cond.equals);
        return !!v;
      }
    } catch {}
    return false;
  };

  const runSubflowById = async (subflowId: string) => {
    const sub = (flow.subflows || {})[subflowId];
    if (!sub || !Array.isArray(sub.nodes) || sub.nodes.length === 0) return;
    await pluginManager.subflowStart({ runId, flow, vars, subflowId });
    const sNodes: any[] = sub.nodes;
    const sEdges: any[] = defaultEdgesOnly((sub.edges || []) as any) as any[];
    const sOrder = topoOrder(sNodes as any, sEdges as any);
    const sSteps: Step[] = sOrder.map((n) => mapDagNodeToStep(n as any)) as any;
    for (const step of sSteps) {
      const t0 = Date.now();
      ensureWithinDeadline();
      const ctrl = await pluginManager.beforeStep({ runId, flow, vars, step });
      if (ctrl?.pause) {
        paused = true;
        break;
      }
      await withRetry(
        async () => {
          const beforeInfo = await getActiveTabInfo();
          const result = await executeStep(ctx, step);
          if (step.type === 'click' || step.type === 'dblclick') {
            const after = ((step as any).after || {}) as any;
            if (after.waitForNavigation)
              await waitForNavigationDone(beforeInfo.url, (step as any).timeoutMs);
            else if (after.waitForNetworkIdle)
              await waitForNetworkIdle(Math.min((step as any).timeoutMs || 5000, 120000), 1200);
            else await maybeQuickWaitForNav(beforeInfo.url, (step as any).timeoutMs);
          }
          if (step.type === 'navigate' || step.type === 'openTab') {
            await waitForNavigationDone(beforeInfo.url, (step as any).timeoutMs);
            await ensureReadPageIfWeb();
          } else if (step.type === 'switchTab') {
            await ensureReadPageIfWeb();
          }
          if (!result?.alreadyLogged)
            logger.push({ stepId: step.id, status: 'success', tookMs: Date.now() - t0 });
          await pluginManager.afterStep({ runId, flow, vars, step, result });
          await appendOverlayOk(step);
          if (result?.deferAfterScript) pendingAfterScripts.push(result.deferAfterScript);
          await flushAfterScripts(ctx, pendingAfterScripts, vars, logger);
        },
        async (attempt, e) => {
          logger.push({ stepId: step.id, status: 'retrying', message: e?.message || String(e) });
          await pluginManager.onRetry({ runId, flow, vars, step, error: e, attempt });
        },
        {
          count: Math.max(0, (step as any).retry?.count ?? 0),
          intervalMs: Math.max(0, (step as any).retry?.intervalMs ?? 0),
          backoff: (step as any).retry?.backoff || 'none',
        },
      );
      if (paused) break;
    }
    await pluginManager.subflowEnd({ runId, flow, vars, subflowId });
  };

  try {
    // DAG traversal (single-branch by nextLabel)
    const id2node = new Map(nodes.map((n: any) => [n.id, n] as const));
    const outEdges = new Map<string, Array<any>>();
    for (const e of edges) {
      if (!outEdges.has(e.from)) outEdges.set(e.from, []);
      outEdges.get(e.from)!.push(e);
    }
    const indeg = new Map<string, number>(nodes.map((n: any) => [n.id, 0] as const));
    for (const e of edges) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    let currentId =
      options.startNodeId && id2node.has(options.startNodeId)
        ? options.startNodeId
        : nodes.find((n: any) => (indeg.get(n.id) || 0) === 0)?.id || nodes[0]?.id;
    let guard = 0;
    while (currentId && guard++ < 10000) {
      ensureWithinDeadline();
      const node = id2node.get(currentId);
      if (!node) break;
      const step: any = mapDagNodeToStep(node as any);
      const t0 = Date.now();
      const beforeInfo = await getActiveTabInfo();
      let jumpedOnError = false;
      let stepNextLabel: string | undefined;
      const ctrlStart = await pluginManager.beforeStep({ runId, flow, vars, step });
      if (ctrlStart?.pause) {
        paused = true;
        break;
      }
      try {
        await withRetry(
          async () => {
            const result = await executeStep(ctx, step);
            if (step.type === 'click' || step.type === 'dblclick') {
              const after = ((step as any).after || {}) as any;
              if (after.waitForNavigation)
                await waitForNavigationDone(beforeInfo.url, (step as any).timeoutMs);
              else if (after.waitForNetworkIdle)
                await waitForNetworkIdle(Math.min((step as any).timeoutMs || 5000, 120000), 1200);
              else await maybeQuickWaitForNav(beforeInfo.url, (step as any).timeoutMs);
            }
            if (step.type === 'navigate' || step.type === 'openTab') {
              await waitForNavigationDone(beforeInfo.url, (step as any).timeoutMs);
              await ensureReadPageIfWeb();
            } else if (step.type === 'switchTab') {
              await ensureReadPageIfWeb();
            }
            if (!result?.alreadyLogged)
              logger.push({ stepId: step.id, status: 'success', tookMs: Date.now() - t0 });
            await pluginManager.afterStep({ runId, flow, vars, step, result });
            await appendOverlayOk(step);
            if (result?.nextLabel) stepNextLabel = String(result.nextLabel);
            if (result?.control) {
              if (result.control.kind === 'foreach') {
                const list = Array.isArray(vars[result.control.listVar])
                  ? (vars[result.control.listVar] as any[])
                  : [];
                for (const it of list) {
                  vars[result.control.itemVar] = it;
                  await runSubflowById(result.control.subflowId);
                }
              } else if (result.control.kind === 'while') {
                let i = 0;
                while (
                  i < result.control.maxIterations &&
                  evalCondition(result.control.condition)
                ) {
                  await runSubflowById(result.control.subflowId);
                  i++;
                }
              }
            }
            if (result?.deferAfterScript) pendingAfterScripts.push(result.deferAfterScript);
            await flushAfterScripts(ctx, pendingAfterScripts, vars, logger);
          },
          async (attempt, e) => {
            logger.push({ stepId: step.id, status: 'retrying', message: e?.message || String(e) });
            await pluginManager.onRetry({ runId, flow, vars, step, error: e, attempt });
          },
          {
            count: Math.max(0, (step as any).retry?.count ?? 0),
            intervalMs: Math.max(0, (step as any).retry?.intervalMs ?? 0),
            backoff: (step as any).retry?.backoff || 'none',
          },
        );
      } catch (e: any) {
        failed++;
        logger.push({
          stepId: step.id,
          status: 'failed',
          message: e?.message || String(e),
          tookMs: Date.now() - t0,
        });
        await appendOverlayFail(step, e);
        if ((step as any).screenshotOnFail !== false) await logger.screenshotOnFailure();
        const hook = await pluginManager.onError({ runId, flow, vars, step, error: e });
        if (hook?.pause) {
          paused = true;
          break;
        }
        const oes = (outEdges.get(currentId) || []) as any[];
        const errEdge = oes.find((edg) => edg.label === 'onError');
        if (errEdge) {
          currentId = errEdge.to;
          jumpedOnError = true;
        } else {
          throw e;
        }
      }
      if (paused) break;
      if (!jumpedOnError) {
        // choose next by label from success path
        let nextLabel: string = stepNextLabel ? String(stepNextLabel) : 'default';
        const override = await pluginManager.onChooseNextLabel({
          runId,
          flow,
          vars,
          step,
          suggested: nextLabel,
        });
        if (override) nextLabel = String(override);
        const oes = (outEdges.get(currentId) || []) as any[];
        const edge =
          oes.find((e) => String(e.label || 'default') === nextLabel) ||
          oes.find((e) => !e.label || e.label === 'default');
        currentId = edge ? edge.to : undefined;
      }
    }
  } finally {
    if (networkCaptureStarted) await stopAndSummarizeNetwork();
  }

  await logger.overlayDone();
  const tookMs = Date.now() - startAt;

  // outputs: filter sensitive variables
  const sensitiveKeys = new Set(
    (flow.variables || []).filter((v) => v.sensitive).map((v) => v.key),
  );
  const outputs: Record<string, any> = {};
  for (const [k, v] of Object.entries(vars)) if (!sensitiveKeys.has(k)) outputs[k] = v;

  await pluginManager.runEnd({ runId, flow, vars, success: failed === 0 && !paused, failed });
  if (!paused) await logger.persist(flow, startAt, failed === 0);
  try {
    await runState.update(runId, {
      status: paused ? 'stopped' : failed === 0 ? 'completed' : 'failed',
      updatedAt: Date.now(),
    } as any);
    if (!paused) await runState.delete(runId);
  } catch {}
  return {
    runId,
    success: !paused && failed === 0,
    summary: { total: steps.length, success: steps.length - failed, failed, tookMs },
    url: null,
    outputs,
    logs: options.returnLogs ? logger.getLogs() : undefined,
    screenshots: {
      onFailure: logger.getLogs().find((l) => l.status === 'failed')?.screenshotBase64,
    },
    paused,
  };
}

async function getActiveTabInfo() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  return { url: tab?.url || '', status: (tab as any)?.status || '' };
}

async function flushAfterScripts(
  ctx: ExecCtx,
  pendingAfterScripts: StepScript[],
  vars: Record<string, any>,
  logger: RunLogger,
) {
  if (pendingAfterScripts.length === 0) return;
  while (pendingAfterScripts.length) {
    const s = pendingAfterScripts.shift()!;
    const tScript = Date.now();
    const world = (s as any).world || 'ISOLATED';
    const code = String((s as any).code || '');
    if (code.trim()) {
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
      if ((s as any).saveAs) vars[(s as any).saveAs] = result;
      if ((s as any).assign && typeof (s as any).assign === 'object')
        applyAssign(vars, result, (s as any).assign);
    }
    logger.push({ stepId: s.id, status: 'success', tookMs: Date.now() - tScript });
  }
}
