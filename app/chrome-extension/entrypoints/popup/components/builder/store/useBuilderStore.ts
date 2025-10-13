import { reactive, ref } from 'vue';
import type {
  Flow as FlowV2,
  NodeBase,
  Edge as EdgeV2,
} from '@/entrypoints/background/record-replay/types';
import {
  autoChainEdges,
  cloneFlow,
  defaultConfigFor,
  newId,
  nodesToSteps,
  stepsToNodes,
  summarizeNode,
  topoOrder,
} from '../model/transforms';

export function useBuilderStore(initial?: FlowV2 | null) {
  const flowLocal = reactive<FlowV2>({ id: '', name: '', version: 1, steps: [], variables: [] });
  const nodes = reactive<NodeBase[]>([]);
  const edges = reactive<EdgeV2[]>([]);
  const activeNodeId = ref<string | null>(null);
  const activeEdgeId = ref<string | null>(null);
  const pendingFrom = ref<string | null>(null);
  const pendingLabel = ref<string>('default');
  const paletteTypes = [
    'click',
    'fill',
    'if',
    'foreach',
    'while',
    'key',
    'wait',
    'assert',
    'navigate',
    'script',
    'delay',
    'http',
    'extract',
    'screenshot',
    'triggerEvent',
    'setAttribute',
    'loopElements',
    'switchFrame',
    'handleDownload',
    'executeFlow',
    'openTab',
    'switchTab',
    'closeTab',
  ] as NodeBase['type'][];

  // --- history (undo/redo) ---
  type Snapshot = {
    flow: Pick<FlowV2, 'name' | 'description'>;
    nodes: NodeBase[];
    edges: EdgeV2[];
  };
  const HISTORY_MAX = 50;
  const past: Snapshot[] = [];
  const future: Snapshot[] = [];
  function takeSnapshot(): Snapshot {
    return {
      flow: { name: flowLocal.name, description: flowLocal.description } as any,
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
  }
  function applySnapshot(s: Snapshot) {
    flowLocal.name = (s.flow as any).name || '';
    (flowLocal as any).description = (s.flow as any).description || '';
    nodes.splice(0, nodes.length, ...JSON.parse(JSON.stringify(s.nodes)));
    edges.splice(0, edges.length, ...JSON.parse(JSON.stringify(s.edges)));
  }
  function recordChange() {
    past.push(takeSnapshot());
    // clear redo stack on new change
    future.length = 0;
    if (past.length > HISTORY_MAX) past.splice(0, past.length - HISTORY_MAX);
  }
  function undo() {
    if (past.length === 0) return;
    const current = takeSnapshot();
    const prev = past.pop()!;
    future.push(current);
    applySnapshot(prev);
  }
  function redo() {
    if (future.length === 0) return;
    const current = takeSnapshot();
    const next = future.pop()!;
    past.push(current);
    applySnapshot(next);
  }

  function layoutIfNeeded() {
    const startX = 120,
      startY = 80,
      gapY = 120;
    nodes.forEach((n, i) => {
      if (!n.ui || isNaN(n.ui.x) || isNaN(n.ui.y)) n.ui = { x: startX, y: startY + i * gapY };
    });
  }

  function initFromFlow(flow: FlowV2) {
    const deep = cloneFlow(flow);
    Object.assign(flowLocal, deep);
    nodes.splice(
      0,
      nodes.length,
      ...(Array.isArray(deep.nodes) && deep.nodes.length
        ? deep.nodes
        : stepsToNodes(deep.steps || [])),
    );
    edges.splice(
      0,
      edges.length,
      ...(Array.isArray(deep.edges) && deep.edges.length ? deep.edges : autoChainEdges(nodes)),
    );
    layoutIfNeeded();
    activeNodeId.value = nodes[0]?.id || null;
    activeEdgeId.value = null;
    // reset history
    past.length = 0;
    future.length = 0;
    past.push(takeSnapshot());
  }

  function selectNode(id: string | null) {
    // When click on empty canvas, id can be null => deselect
    if (id && pendingFrom.value && pendingFrom.value !== id) {
      onConnect(pendingFrom.value, id, pendingLabel.value);
      pendingFrom.value = null;
    }
    activeNodeId.value = id || null;
    // selecting a node should clear edge selection
    if (id) activeEdgeId.value = null;
  }

  function selectEdge(id: string | null) {
    activeEdgeId.value = id || null;
    if (id) activeNodeId.value = null;
  }

  function addNode(t: NodeBase['type']) {
    const id = newId(t);
    const n: NodeBase = {
      id,
      type: t,
      name: '',
      config: defaultConfigFor(t),
      ui: { x: 200 + nodes.length * 24, y: 120 + nodes.length * 96 },
    };
    nodes.push(n);
    if (nodes.length > 1) {
      const prev = nodes[nodes.length - 2];
      edges.push({ id: newId('e'), from: prev.id, to: id, label: 'default' });
    }
    activeNodeId.value = id;
    recordChange();
  }

  function addNodeAt(t: NodeBase['type'], x: number, y: number) {
    const id = newId(t);
    const n: NodeBase = {
      id,
      type: t,
      name: '',
      config: defaultConfigFor(t),
      ui: { x: Math.round(x), y: Math.round(y) },
    };
    nodes.push(n);
    activeNodeId.value = id;
    recordChange();
  }

  function duplicateNode(id: string) {
    const src = nodes.find((n) => n.id === id);
    if (!src) return;
    const cp: NodeBase = JSON.parse(JSON.stringify(src));
    cp.id = newId(src.type);
    cp.name = src.name ? `${src.name} Copy` : '';
    const baseX = cp.ui && typeof cp.ui.x === 'number' ? cp.ui.x : 200;
    const baseY = cp.ui && typeof cp.ui.y === 'number' ? cp.ui.y : 120;
    cp.ui = { x: baseX + 40, y: baseY + 40 };
    nodes.push(cp);
    activeNodeId.value = cp.id;
    recordChange();
  }

  function removeNode(id: string) {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx < 0) return;
    nodes.splice(idx, 1);
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i];
      if (e.from === id || e.to === id) edges.splice(i, 1);
    }
    // After removal, do not auto-select another node to avoid accidental batch deletes
    activeNodeId.value = null;
    activeEdgeId.value = null;
    recordChange();
  }

  function removeEdge(id: string) {
    const idx = edges.findIndex((e) => e.id === id);
    if (idx < 0) return;
    edges.splice(idx, 1);
    if (activeEdgeId.value === id) activeEdgeId.value = null;
    recordChange();
  }

  function setNodePosition(id: string, x: number, y: number) {
    const n = nodes.find((n) => n.id === id);
    if (!n) return;
    n.ui = { x: Math.round(x), y: Math.round(y) };
    // 不计入历史栈，避免频繁记录；由用户触发操作（连接/新增/删除等）记录。
  }

  function connectFrom(id: string, label: string = 'default') {
    pendingFrom.value = id;
    pendingLabel.value = label;
  }

  function onConnect(sourceId: string, targetId: string, label: string = 'default') {
    // prevent self-loop
    if (sourceId === targetId) return;
    // 单一同标签出边：删除同源 + 同标签的已有边
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i];
      const lab = e.label || 'default';
      if (e.from === sourceId && lab === label) edges.splice(i, 1);
    }
    // avoid duplicate for same pair+label
    if (
      edges.some(
        (e) => e.from === sourceId && e.to === targetId && (e.label || 'default') === label,
      )
    )
      return;
    edges.push({ id: newId('e'), from: sourceId, to: targetId, label });
    recordChange();
    // auto select the newly created edge
    try {
      const last = edges[edges.length - 1];
      activeEdgeId.value = last?.id || null;
      activeNodeId.value = null;
    } catch {}
  }

  function importFromSteps() {
    const arr = stepsToNodes(flowLocal.steps || []);
    nodes.splice(0, nodes.length, ...arr);
    edges.splice(0, edges.length, ...autoChainEdges(arr));
    layoutIfNeeded();
    recordChange();
  }

  // --- subflow management ---
  const currentSubflowId = ref<string | null>(null);
  function ensureSubflows() {
    if (!flowLocal.subflows) (flowLocal as any).subflows = {} as any;
  }
  function listSubflowIds(): string[] {
    ensureSubflows();
    return Object.keys((flowLocal as any).subflows || {});
  }
  function addSubflow(id: string) {
    ensureSubflows();
    const sf = (flowLocal as any).subflows as any;
    if (!id || sf[id]) return;
    sf[id] = { nodes: [], edges: [] };
    recordChange();
  }
  function removeSubflow(id: string) {
    ensureSubflows();
    const sf = (flowLocal as any).subflows as any;
    if (!sf[id]) return;
    delete sf[id];
    if (currentSubflowId.value === id) switchToMain();
    recordChange();
  }
  function flushCurrent() {
    if (!currentSubflowId.value) {
      // write back main
      (flowLocal as any).nodes = JSON.parse(JSON.stringify(nodes));
      (flowLocal as any).edges = JSON.parse(JSON.stringify(edges));
      return;
    }
    ensureSubflows();
    (flowLocal as any).subflows[currentSubflowId.value] = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
  }
  function switchToMain() {
    flushCurrent();
    currentSubflowId.value = null;
    nodes.splice(0, nodes.length, ...JSON.parse(JSON.stringify((flowLocal.nodes || []) as any)));
    edges.splice(0, edges.length, ...JSON.parse(JSON.stringify((flowLocal.edges || []) as any)));
    layoutIfNeeded();
  }
  function switchToSubflow(id: string) {
    flushCurrent();
    currentSubflowId.value = id;
    ensureSubflows();
    const sf = (flowLocal as any).subflows[id] || { nodes: [], edges: [] };
    nodes.splice(0, nodes.length, ...JSON.parse(JSON.stringify(sf.nodes || [])));
    edges.splice(0, edges.length, ...JSON.parse(JSON.stringify(sf.edges || [])));
    layoutIfNeeded();
  }
  const isEditingMain = () => currentSubflowId.value == null;

  function exportSteps() {
    return nodesToSteps(nodes, edges);
  }

  function summarize(id?: string) {
    const n = nodes.find((x) => x.id === id);
    return summarizeNode(n || null);
  }

  // 自动排版：根据拓扑顺序纵向排列，列宽 300、行高 120；若存在分叉，简单按顺序换行
  function layoutAuto() {
    const order = topoOrder(nodes, edges);
    const startX = 120,
      startY = 80,
      stepY = 120,
      stepX = 300,
      maxPerCol = Math.max(6, Math.ceil(order.length / 3));
    let col = 0,
      row = 0;
    for (const n of order) {
      n.ui = { x: startX + col * stepX, y: startY + row * stepY } as any;
      row++;
      if (row >= maxPerCol) {
        row = 0;
        col++;
      }
    }
    recordChange();
  }

  if (initial) initFromFlow(initial);

  return {
    flowLocal,
    nodes,
    edges,
    activeNodeId,
    activeEdgeId,
    pendingFrom,
    pendingLabel,
    currentSubflowId,
    paletteTypes,
    undo,
    redo,
    initFromFlow,
    selectNode,
    selectEdge,
    addNode,
    duplicateNode,
    removeNode,
    removeEdge,
    setNodePosition,
    addNodeAt,
    connectFrom,
    onConnect,
    listSubflowIds,
    addSubflow,
    removeSubflow,
    switchToMain,
    switchToSubflow,
    isEditingMain,
    importFromSteps,
    exportSteps,
    summarize,
    layoutAuto,
  };
}
