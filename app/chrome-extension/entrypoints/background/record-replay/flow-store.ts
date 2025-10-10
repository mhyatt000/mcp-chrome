import { STORAGE_KEYS } from '@/common/constants';
import type { Flow, RunRecord } from './types';

// design note: simple local storage backed store for flows and run records

export interface PublishedFlowInfo {
  id: string;
  slug: string; // for tool name `flow.<slug>`
  version: number;
  name: string;
  description?: string;
}

export async function listFlows(): Promise<Flow[]> {
  const res = await chrome.storage.local.get([STORAGE_KEYS.RR_FLOWS]);
  return (res[STORAGE_KEYS.RR_FLOWS] as Flow[]) || [];
}

export async function getFlow(flowId: string): Promise<Flow | undefined> {
  const flows = await listFlows();
  return flows.find((f) => f.id === flowId);
}

export async function saveFlow(flow: Flow): Promise<void> {
  const flows = await listFlows();
  const idx = flows.findIndex((f) => f.id === flow.id);
  if (idx >= 0) flows[idx] = flow;
  else flows.push(flow);
  await chrome.storage.local.set({ [STORAGE_KEYS.RR_FLOWS]: flows });
}

export async function deleteFlow(flowId: string): Promise<void> {
  const flows = await listFlows();
  const filtered = flows.filter((f) => f.id !== flowId);
  await chrome.storage.local.set({ [STORAGE_KEYS.RR_FLOWS]: filtered });
}

export async function listRuns(): Promise<RunRecord[]> {
  const res = await chrome.storage.local.get([STORAGE_KEYS.RR_RUNS]);
  return (res[STORAGE_KEYS.RR_RUNS] as RunRecord[]) || [];
}

export async function appendRun(record: RunRecord): Promise<void> {
  const runs = await listRuns();
  runs.push(record);
  await chrome.storage.local.set({ [STORAGE_KEYS.RR_RUNS]: runs });
}

export async function listPublished(): Promise<PublishedFlowInfo[]> {
  const res = await chrome.storage.local.get([STORAGE_KEYS.RR_PUBLISHED]);
  return (res[STORAGE_KEYS.RR_PUBLISHED] as PublishedFlowInfo[]) || [];
}

export async function publishFlow(flow: Flow, slug?: string): Promise<PublishedFlowInfo> {
  const info: PublishedFlowInfo = {
    id: flow.id,
    slug: slug || toSlug(flow.name) || flow.id,
    version: flow.version,
    name: flow.name,
    description: flow.description,
  };
  const list = await listPublished();
  const idx = list.findIndex((p) => p.id === info.id);
  if (idx >= 0) list[idx] = info;
  else list.push(info);
  await chrome.storage.local.set({ [STORAGE_KEYS.RR_PUBLISHED]: list });
  return info;
}

export async function unpublishFlow(flowId: string): Promise<void> {
  const list = await listPublished();
  const filtered = list.filter((p) => p.id !== flowId);
  await chrome.storage.local.set({ [STORAGE_KEYS.RR_PUBLISHED]: filtered });
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
    if (!f.meta) f.meta = { createdAt: nowIso, updatedAt: nowIso } as any;
    f.meta.updatedAt = nowIso;
    await saveFlow(f);
  }
  return flowsToImport;
}
