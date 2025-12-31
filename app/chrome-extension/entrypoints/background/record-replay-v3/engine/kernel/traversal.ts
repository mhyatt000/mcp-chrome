/**
 * @fileoverview DAG 遍历和校验
 * @description 提供 Flow DAG 的校验、遍历和下一节点查找功能
 */

import type { NodeId, EdgeLabel } from '../../domain/ids';
import type { GraphV3, EdgeV3 } from '../../domain/flow';
import { EDGE_LABELS } from '../../domain/ids';
import { RR_ERROR_CODES, createRRError, type RRError } from '../../domain/errors';

/**
 * DAG 校验结果
 */
export type ValidateFlowDAGResult = { ok: true } | { ok: false; errors: RRError[] };

/**
 * 校验 Graph DAG 结构
 * @param graph Graph 定义（FlowV3 或 SubflowV3）
 * @returns 校验结果
 */
export function validateFlowDAG(graph: GraphV3): ValidateFlowDAGResult {
  const errors: RRError[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  // 检查 entryNodeId 是否存在
  if (!nodeIds.has(graph.entryNodeId)) {
    errors.push(
      createRRError(
        RR_ERROR_CODES.DAG_INVALID,
        `Entry node "${graph.entryNodeId}" does not exist in graph`,
      ),
    );
  }

  // 检查边引用的节点是否存在
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(
        createRRError(
          RR_ERROR_CODES.DAG_INVALID,
          `Edge "${edge.id}" references non-existent source node "${edge.from}"`,
        ),
      );
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(
        createRRError(
          RR_ERROR_CODES.DAG_INVALID,
          `Edge "${edge.id}" references non-existent target node "${edge.to}"`,
        ),
      );
    }
  }

  // 检查循环
  const cycle = detectCycle(graph);
  if (cycle) {
    errors.push(
      createRRError(RR_ERROR_CODES.DAG_CYCLE, `Cycle detected in graph: ${cycle.join(' -> ')}`),
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * 检测 DAG 中的循环
 * @param graph Graph 定义
 * @returns 循环路径（如果存在）或 null
 */
export function detectCycle(graph: GraphV3): NodeId[] | null {
  const adjacency = buildAdjacencyMap(graph);
  const visited = new Set<NodeId>();
  const recursionStack = new Set<NodeId>();
  const path: NodeId[] = [];

  function dfs(nodeId: NodeId): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) {
          return true;
        }
      } else if (recursionStack.has(neighbor)) {
        // 找到循环
        const cycleStart = path.indexOf(neighbor);
        path.push(neighbor); // 闭合循环
        path.splice(0, cycleStart); // 移除循环前的节点
        return true;
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) {
        return path;
      }
    }
  }

  return null;
}

/**
 * 查找下一个节点
 * @param graph Graph 定义
 * @param currentNodeId 当前节点 ID
 * @param label 边标签（可选，默认使用 default）
 * @returns 下一个节点 ID 或 null（如果没有后续节点）
 */
export function findNextNode(
  graph: GraphV3,
  currentNodeId: NodeId,
  label?: EdgeLabel,
): NodeId | null {
  const outEdges = graph.edges.filter((e) => e.from === currentNodeId);

  if (outEdges.length === 0) {
    return null;
  }

  // 如果指定了 label，优先匹配
  if (label) {
    const matchedEdge = outEdges.find((e) => e.label === label);
    if (matchedEdge) {
      return matchedEdge.to;
    }
  }

  // 否则使用 default 边
  const defaultEdge = outEdges.find(
    (e) => e.label === EDGE_LABELS.DEFAULT || e.label === undefined,
  );
  if (defaultEdge) {
    return defaultEdge.to;
  }

  // 如果只有一条边，使用它
  if (outEdges.length === 1) {
    return outEdges[0].to;
  }

  return null;
}

/**
 * 查找指定标签的边
 */
export function findEdgeByLabel(
  graph: GraphV3,
  fromNodeId: NodeId,
  label: EdgeLabel,
): EdgeV3 | undefined {
  return graph.edges.find((e) => e.from === fromNodeId && e.label === label);
}

/**
 * 获取节点的所有出边
 */
export function getOutEdges(graph: GraphV3, nodeId: NodeId): EdgeV3[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

/**
 * 获取节点的所有入边
 */
export function getInEdges(graph: GraphV3, nodeId: NodeId): EdgeV3[] {
  return graph.edges.filter((e) => e.to === nodeId);
}

/**
 * 构建邻接表
 */
function buildAdjacencyMap(graph: GraphV3): Map<NodeId, NodeId[]> {
  const map = new Map<NodeId, NodeId[]>();

  for (const node of graph.nodes) {
    map.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const neighbors = map.get(edge.from);
    if (neighbors) {
      neighbors.push(edge.to);
    }
  }

  return map;
}

/**
 * 获取从入口节点可达的所有节点
 */
export function getReachableNodes(graph: GraphV3): Set<NodeId> {
  const reachable = new Set<NodeId>();
  const adjacency = buildAdjacencyMap(graph);

  function dfs(nodeId: NodeId): void {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }
  }

  dfs(graph.entryNodeId);
  return reachable;
}

/**
 * 检查节点是否可达
 */
export function isNodeReachable(graph: GraphV3, nodeId: NodeId): boolean {
  return getReachableNodes(graph).has(nodeId);
}
