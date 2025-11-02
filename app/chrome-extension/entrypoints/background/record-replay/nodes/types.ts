import type { RunLogEntry, Step, StepScript } from '../types';

export interface ExecCtx {
  vars: Record<string, any>;
  logger: (e: RunLogEntry) => void;
  frameId?: number;
}

export interface ExecResult {
  alreadyLogged?: boolean;
  deferAfterScript?: StepScript | null;
  nextLabel?: string;
  control?:
    | { kind: 'foreach'; listVar: string; itemVar: string; subflowId: string; concurrency?: number }
    | { kind: 'while'; condition: any; subflowId: string; maxIterations: number };
}

export interface NodeRuntime<S extends Step = Step> {
  validate?: (step: S) => { ok: boolean; errors?: string[] };
  run: (ctx: ExecCtx, step: S) => Promise<ExecResult | void>;
}
