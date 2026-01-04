import type { ToolResult } from '@/common/tool-handler';
import type { ToolRiskAssessment } from './tool-risk';

export type ToolCallSource = 'native_host' | 'extension_ui' | 'internal';

export type ToolActionLogStatus = 'success' | 'error' | 'denied';

export interface ToolActionLogEntryV1 {
  version: 1;
  id: string;
  toolName: string;
  toolDescription?: string | null;
  risk: ToolRiskAssessment;
  source: ToolCallSource;
  incognito: boolean;
  status: ToolActionLogStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  argsSummary: string;
  resultSummary: string;
}

interface ToolActionLogStateV1 {
  version: 1;
  updatedAt: number;
  entries: ToolActionLogEntryV1[];
}

const STORAGE_KEY = 'tool_action_log_v1';
const MAX_ENTRIES = 200;
const MAX_SUMMARY_CHARS = 800;

let cachedState: ToolActionLogStateV1 | null = null;
let loadOnce: Promise<ToolActionLogStateV1> | null = null;
let writeChain: Promise<void> = Promise.resolve();

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function createId(): string {
  try {
    const id = crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    // Ignore
  }
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function truncate(text: string, maxChars: number): string {
  const s = typeof text === 'string' ? text : String(text);
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)) + '\u2026';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeValue(value: unknown, depth: number, keyHint?: string): unknown {
  if (depth <= 0) return '[truncated]';

  const key = typeof keyHint === 'string' ? keyHint.toLowerCase() : '';
  if (
    key === 'base64data' ||
    key === 'script' ||
    key === 'body' ||
    key === 'htmlcontent' ||
    key === 'textcontent' ||
    key === 'pagecontent' ||
    key === 'content'
  ) {
    if (typeof value === 'string') return `[redacted:${value.length}]`;
    return '[redacted]';
  }

  if (typeof value === 'string') {
    return truncate(value, 200);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < Math.min(value.length, 20); i++) {
      out.push(sanitizeValue(value[i], depth - 1));
    }
    if (value.length > 20) out.push(`[+${value.length - 20} more]`);
    return out;
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value);
    for (let i = 0; i < Math.min(entries.length, 50); i++) {
      const [k, v] = entries[i];
      out[k] = sanitizeValue(v, depth - 1, k);
    }
    if (entries.length > 50) out.__truncated__ = `[+${entries.length - 50} keys]`;
    return out;
  }

  // Fallback for non-plain objects (e.g., DOM handles)
  return `[${Object.prototype.toString.call(value)}]`;
}

export function formatToolArgsSummary(args: unknown): string {
  if (args === undefined) return '(no args)';
  try {
    const sanitized = sanitizeValue(args, 4);
    return truncate(JSON.stringify(sanitized, null, 2), MAX_SUMMARY_CHARS);
  } catch (err) {
    return truncate(`(unserializable args) ${safeErrorMessage(err)}`, MAX_SUMMARY_CHARS);
  }
}

function getFirstText(result: ToolResult | null | undefined): string | null {
  const first = result?.content?.[0];
  if (!first || first.type !== 'text') return null;
  const text = typeof first.text === 'string' ? first.text.trim() : '';
  return text ? text : null;
}

export function formatToolResultSummary(result: ToolResult | null | undefined): string {
  if (!result) return '(no result)';
  if (result.isError === true) {
    const txt = getFirstText(result);
    return truncate(txt ? `Error: ${txt}` : 'Error', MAX_SUMMARY_CHARS);
  }

  const txt = getFirstText(result);
  if (!txt) return '(non-text result)';

  // Many tools return JSON payloads. Try to summarize without storing large fields.
  const trimmed = txt.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const sanitized = sanitizeValue(parsed, 3);
      return truncate(JSON.stringify(sanitized, null, 2), MAX_SUMMARY_CHARS);
    } catch {
      // Fall back to raw truncation.
    }
  }

  return truncate(trimmed, MAX_SUMMARY_CHARS);
}

function defaultState(): ToolActionLogStateV1 {
  return { version: 1, updatedAt: Date.now(), entries: [] };
}

async function loadState(): Promise<ToolActionLogStateV1> {
  if (cachedState) return cachedState;
  if (loadOnce) return loadOnce;

  loadOnce = (async () => {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY]);
      const raw = stored[STORAGE_KEY] as Partial<ToolActionLogStateV1> | undefined;
      if (raw && raw.version === 1 && Array.isArray(raw.entries)) {
        const entries = raw.entries.filter(
          (e) => e && (e as any).version === 1,
        ) as ToolActionLogEntryV1[];
        cachedState = { version: 1, updatedAt: raw.updatedAt ?? Date.now(), entries };
        return cachedState;
      }
    } catch {
      // Ignore
    }
    cachedState = defaultState();
    return cachedState;
  })().finally(() => {
    loadOnce = null;
  });

  return loadOnce;
}

async function persistState(state: ToolActionLogStateV1): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } catch {
    // Ignore storage errors (quota/incognito restrictions)
  }
}

export async function appendToolActionLogEntry(
  entry: Omit<ToolActionLogEntryV1, 'version' | 'id'> & { id?: string },
): Promise<void> {
  const state = await loadState();
  const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : createId();

  const normalized: ToolActionLogEntryV1 = {
    version: 1,
    id,
    toolName: entry.toolName,
    toolDescription: entry.toolDescription ?? null,
    risk: entry.risk,
    source: entry.source,
    incognito: entry.incognito,
    status: entry.status,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    durationMs: entry.durationMs,
    argsSummary: truncate(entry.argsSummary, MAX_SUMMARY_CHARS),
    resultSummary: truncate(entry.resultSummary, MAX_SUMMARY_CHARS),
  };

  state.entries.unshift(normalized);
  if (state.entries.length > MAX_ENTRIES) {
    state.entries.splice(MAX_ENTRIES);
  }
  state.updatedAt = Date.now();
  cachedState = state;

  writeChain = writeChain.then(
    () => persistState(state),
    () => persistState(state),
  );
  await writeChain;
}

export async function listToolActionLogEntries(options: {
  incognito: boolean;
  query?: string;
  maxResults?: number;
}): Promise<ToolActionLogEntryV1[]> {
  const state = await loadState();
  const max =
    typeof options.maxResults === 'number' && options.maxResults > 0
      ? Math.floor(options.maxResults)
      : 50;
  const q = typeof options.query === 'string' ? options.query.trim().toLowerCase() : '';

  const filtered = state.entries.filter((e) => e.incognito === options.incognito);
  if (!q) return filtered.slice(0, max);

  return filtered
    .filter((e) => {
      const haystack = `${e.toolName} ${e.argsSummary} ${e.resultSummary}`.toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, max);
}

export async function clearToolActionLog(options: { incognito: boolean }): Promise<void> {
  const state = await loadState();
  const kept = state.entries.filter((e) => e.incognito !== options.incognito);
  state.entries = kept;
  state.updatedAt = Date.now();
  cachedState = state;

  writeChain = writeChain.then(
    () => persistState(state),
    () => persistState(state),
  );
  await writeChain;
}
