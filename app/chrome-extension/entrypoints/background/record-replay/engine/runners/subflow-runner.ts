// subflow-runner.ts — execute a subflow (nodes/edges) in isolation using StepRunner

import type { ExecCtx } from '../../nodes';
import { RunLogger } from '../logging/run-logger';
import { PluginManager } from '../plugins/manager';
import { defaultEdgesOnly, topoOrder, mapDagNodeToStep } from '../../rr-utils';
import type { Edge, NodeBase, Step } from '../../types';
import { StepRunner } from './step-runner';

export interface SubflowEnv {
  runId: string;
  flow: any;
  vars: Record<string, any>;
  logger: RunLogger;
  pluginManager: PluginManager;
  stepRunner: StepRunner;
}

export class SubflowRunner {
  constructor(private env: SubflowEnv) {}

  async runSubflowById(subflowId: string, ctx: ExecCtx, pausedRef: () => boolean): Promise<void> {
    const sub = (this.env.flow.subflows || {})[subflowId];
    if (!sub || !Array.isArray(sub.nodes) || sub.nodes.length === 0) return;
    try {
      await this.env.pluginManager.subflowStart({
        runId: this.env.runId,
        flow: this.env.flow,
        vars: this.env.vars,
        subflowId,
      });
    } catch (e: any) {
      this.env.logger.push({
        stepId: `subflow:${subflowId}`,
        status: 'warning',
        message: `plugin.subflowStart error: ${e?.message || String(e)}`,
      });
    }
    const sNodes: NodeBase[] = sub.nodes;
    const sEdges: Edge[] = defaultEdgesOnly(sub.edges || []);
    const sOrder = topoOrder(sNodes, sEdges);
    const sSteps: Step[] = sOrder.map((n) => mapDagNodeToStep(n));
    const ok = (s: Step) => this.env.logger.overlayAppend(`✔ ${s.type} (${s.id})`);
    const fail = (s: Step, e: any) =>
      this.env.logger.overlayAppend(`✘ ${s.type} (${s.id}) -> ${e?.message || String(e)}`);
    for (const step of sSteps) {
      const r = await this.env.stepRunner.run(ctx, step, ok, fail);
      if (r.status === 'paused' || pausedRef()) break;
    }
    try {
      await this.env.pluginManager.subflowEnd({
        runId: this.env.runId,
        flow: this.env.flow,
        vars: this.env.vars,
        subflowId,
      });
    } catch (e: any) {
      this.env.logger.push({
        stepId: `subflow:${subflowId}`,
        status: 'warning',
        message: `plugin.subflowEnd error: ${e?.message || String(e)}`,
      });
    }
  }
}
