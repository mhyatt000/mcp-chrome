// design note: comments in English

export type SelectorType = 'css' | 'xpath' | 'attr' | 'aria' | 'text';

export interface SelectorCandidate {
  type: SelectorType;
  value: string; // literal selector or text/aria expression
  weight?: number; // user-adjustable priority; higher first
}

export interface TargetLocator {
  ref?: string; // ephemeral ref from read_page
  candidates: SelectorCandidate[]; // ordered by priority
}

export type StepType =
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'key'
  | 'scroll'
  | 'drag'
  | 'wait'
  | 'assert'
  | 'script'
  | 'navigate';

export interface StepBase {
  id: string;
  type: StepType;
  timeoutMs?: number; // default 10000
  retry?: { count: number; intervalMs: number; backoff?: 'none' | 'exp' };
  screenshotOnFail?: boolean; // default true
}

export interface StepClick extends StepBase {
  type: 'click' | 'dblclick';
  target: TargetLocator;
  before?: { scrollIntoView?: boolean; waitForSelector?: boolean };
  after?: { waitForNavigation?: boolean; waitForNetworkIdle?: boolean };
}

export interface StepFill extends StepBase {
  type: 'fill';
  target: TargetLocator;
  value: string; // may contain {var}
}

export interface StepKey extends StepBase {
  type: 'key';
  keys: string; // e.g. "Backspace Enter" or "cmd+a"
  target?: TargetLocator; // optional focus target
}

export interface StepScroll extends StepBase {
  type: 'scroll';
  mode: 'element' | 'offset' | 'container';
  target?: TargetLocator; // when mode = element / container
  offset?: { x?: number; y?: number };
}

export interface StepDrag extends StepBase {
  type: 'drag';
  start: TargetLocator;
  end: TargetLocator;
  path?: Array<{ x: number; y: number }>; // sampled trajectory
}

export interface StepWait extends StepBase {
  type: 'wait';
  condition:
    | { selector: string; visible?: boolean }
    | { text: string; appear?: boolean }
    | { navigation: true }
    | { networkIdle: true };
}

export interface StepAssert extends StepBase {
  type: 'assert';
  assert:
    | { exists: string }
    | { visible: string }
    | { textPresent: string }
    | { attribute: { selector: string; name: string; equals?: string; matches?: string } };
}

export interface StepScript extends StepBase {
  type: 'script';
  world?: 'MAIN' | 'ISOLATED';
  code: string; // user script string
  when?: 'before' | 'after';
}

export type Step =
  | StepClick
  | StepFill
  | StepKey
  | StepScroll
  | StepDrag
  | StepWait
  | StepAssert
  | StepScript
  | (StepBase & { type: 'navigate'; url: string });

export interface VariableDef {
  key: string;
  label?: string;
  sensitive?: boolean;
  default?: string;
  rules?: { required?: boolean; pattern?: string };
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  version: number;
  meta?: {
    createdAt: string;
    updatedAt: string;
    domain?: string;
    tags?: string[];
    bindings?: Array<{ type: 'domain' | 'path' | 'url'; value: string }>;
    tool?: { category?: string; description?: string };
    exposedOutputs?: Array<{ nodeId: string; as: string }>;
  };
  variables?: VariableDef[];
  steps: Step[];
}

export interface RunLogEntry {
  stepId: string;
  status: 'success' | 'failed' | 'retrying';
  message?: string;
  tookMs?: number;
  screenshotBase64?: string; // small thumbnail (optional)
  consoleSnippets?: string[]; // critical lines
  networkSnippets?: Array<{ method: string; url: string; status?: number; ms?: number }>;
  // selector fallback info
  fallbackUsed?: boolean;
  fallbackFrom?: string;
  fallbackTo?: string;
}

export interface RunRecord {
  id: string;
  flowId: string;
  startedAt: string;
  finishedAt?: string;
  success?: boolean;
  entries: RunLogEntry[];
}

export interface RunResult {
  runId: string;
  success: boolean;
  summary: { total: number; success: number; failed: number; tookMs: number };
  url?: string | null;
  outputs?: Record<string, any> | null;
  logs?: RunLogEntry[];
  screenshots?: { onFailure?: string | null };
}
