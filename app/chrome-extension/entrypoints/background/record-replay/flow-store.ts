import type { Flow, RunRecord } from './types';
import { IndexedDbStorage } from './storage/indexeddb-manager';

// design note: simple local storage backed store for flows and run records

export interface PublishedFlowInfo {
  id: string;
  slug: string; // for tool name `flow.<slug>`
  version: number;
  name: string;
  description?: string;
}

export async function listFlows(): Promise<Flow[]> {
  return await IndexedDbStorage.flows.list();
}

export async function getFlow(flowId: string): Promise<Flow | undefined> {
  return await IndexedDbStorage.flows.get(flowId);
}

export async function saveFlow(flow: Flow): Promise<void> {
  await IndexedDbStorage.flows.save(flow);
}

export async function deleteFlow(flowId: string): Promise<void> {
  await IndexedDbStorage.flows.delete(flowId);
}

export async function listRuns(): Promise<RunRecord[]> {
  return await IndexedDbStorage.runs.list();
}

export async function appendRun(record: RunRecord): Promise<void> {
  const runs = await IndexedDbStorage.runs.list();
  runs.push(record);
  // Trim to keep last 10 runs per flowId to avoid unbounded growth
  try {
    const byFlow = new Map<string, RunRecord[]>();
    for (const r of runs) {
      const list = byFlow.get(r.flowId) || [];
      list.push(r);
      byFlow.set(r.flowId, list);
    }
    const merged: RunRecord[] = [];
    for (const [, arr] of byFlow.entries()) {
      arr.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
      const last = arr.slice(Math.max(0, arr.length - 10));
      merged.push(...last);
    }
    await IndexedDbStorage.runs.replaceAll(merged);
  } catch (e) {
    console.warn('appendRun: trim failed, saving all', e);
    await IndexedDbStorage.runs.replaceAll(runs);
  }
}

export async function listPublished(): Promise<PublishedFlowInfo[]> {
  return await IndexedDbStorage.published.list();
}

export async function publishFlow(flow: Flow, slug?: string): Promise<PublishedFlowInfo> {
  const info: PublishedFlowInfo = {
    id: flow.id,
    slug: slug || toSlug(flow.name) || flow.id,
    version: flow.version,
    name: flow.name,
    description: flow.description,
  };
  await IndexedDbStorage.published.save(info);
  return info;
}

export async function unpublishFlow(flowId: string): Promise<void> {
  await IndexedDbStorage.published.delete(flowId);
}

export function toSlug(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 64);
}

export async function exportFlow(flowId: string): Promise<string> {
  const flow = await getFlow(flowId);
  if (!flow) throw new Error('flow not found');
  return JSON.stringify(flow, null, 2);
}

export async function exportAllFlows(): Promise<string> {
  const flows = await listFlows();
  return JSON.stringify({ flows }, null, 2);
}

export async function importFlowFromJson(json: string): Promise<Flow[]> {
  const parsed = JSON.parse(json);
  const flowsToImport: Flow[] = Array.isArray(parsed?.flows)
    ? parsed.flows
    : parsed?.id && parsed?.steps
      ? [parsed as Flow]
      : [];
  if (!flowsToImport.length) throw new Error('invalid flow json');
  const nowIso = new Date().toISOString();
  for (const f of flowsToImport) {
    const meta = f.meta ?? (f.meta = { createdAt: nowIso, updatedAt: nowIso } as any);
    meta.updatedAt = nowIso;
    await saveFlow(f);
  }
  return flowsToImport;
}

// Scheduling support
export type ScheduleType = 'once' | 'interval' | 'daily';
export interface FlowSchedule {
  id: string; // schedule id
  flowId: string;
  type: ScheduleType;
  enabled: boolean;
  // when: ISO string for 'once'; HH:mm for 'daily'; minutes for 'interval'
  when: string;
  // optional variables to pass when running
  args?: Record<string, any>;
}

export async function listSchedules(): Promise<FlowSchedule[]> {
  return await IndexedDbStorage.schedules.list();
}

export async function saveSchedule(s: FlowSchedule): Promise<void> {
  await IndexedDbStorage.schedules.save(s);
}

export async function removeSchedule(scheduleId: string): Promise<void> {
  await IndexedDbStorage.schedules.delete(scheduleId);
}
