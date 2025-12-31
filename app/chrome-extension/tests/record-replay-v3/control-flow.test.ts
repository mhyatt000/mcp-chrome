/**
 * @fileoverview Control Flow Infrastructure Tests
 * @description 测试 V3 Runner 的控制流基础设施：foreach/while/executeSubflow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import type {
  FlowV3,
  NodeV3,
  SubflowV3,
} from '../../entrypoints/background/record-replay-v3/domain/flow';
import type { NodeId, SubflowId } from '../../entrypoints/background/record-replay-v3/domain/ids';
import type {
  RunEvent,
  RunEventInput,
} from '../../entrypoints/background/record-replay-v3/domain/events';
import type { ControlDirectiveV3 } from '../../entrypoints/background/record-replay-v3/domain/control';
import { MAX_CONTROL_STACK_DEPTH } from '../../entrypoints/background/record-replay-v3/domain/control';
import type {
  NodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from '../../entrypoints/background/record-replay-v3/engine/plugins/types';
import { PluginRegistry } from '../../entrypoints/background/record-replay-v3/engine/plugins/registry';
import { createRunRunnerFactory } from '../../entrypoints/background/record-replay-v3/engine/kernel/runner';
import type { StoragePort } from '../../entrypoints/background/record-replay-v3/engine/storage/storage-port';
import type { EventsBus } from '../../entrypoints/background/record-replay-v3/engine/transport/events-bus';

// ==================== Test Helpers ====================

function createMockStoragePort(): StoragePort {
  const runs = new Map<string, unknown>();
  const flows = new Map<string, FlowV3>();
  const events: RunEvent[] = [];
  let nextSeq = 1;

  return {
    flows: {
      get: vi.fn(async (id: string) => flows.get(id)),
      save: vi.fn(async (flow: FlowV3) => {
        flows.set(flow.id, flow);
      }),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      update: vi.fn(async () => undefined),
    },
    runs: {
      get: vi.fn(async (id: string) => runs.get(id)),
      save: vi.fn(async (run: unknown) => {
        runs.set((run as { id: string }).id, run);
      }),
      patch: vi.fn(async (id: string, patch: unknown) => {
        const existing = runs.get(id);
        if (existing) {
          runs.set(id, { ...(existing as object), ...(patch as object) });
        }
      }),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      query: vi.fn(async () => []),
    },
    events: {
      append: vi.fn(async (event: RunEventInput): Promise<RunEvent> => {
        const fullEvent: RunEvent = {
          ...event,
          ts: event.ts ?? Date.now(),
          seq: nextSeq++,
        } as RunEvent;
        events.push(fullEvent);
        return fullEvent;
      }),
      getByRunId: vi.fn(async () => events),
      deleteByRunId: vi.fn(async () => {}),
    },
    persistentVars: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    },
    triggers: {
      get: vi.fn(async () => undefined),
      save: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    },
  };
}

function createMockEventsBus(): EventsBus & { events: RunEvent[] } {
  const events: RunEvent[] = [];
  let nextSeq = 1;

  return {
    events,
    append: vi.fn(async (event: RunEventInput): Promise<RunEvent> => {
      const fullEvent: RunEvent = {
        ...event,
        ts: event.ts ?? Date.now(),
        seq: nextSeq++,
      } as RunEvent;
      events.push(fullEvent);
      return fullEvent;
    }),
    subscribe: vi.fn(() => () => {}),
  };
}

function createTestFlow(
  overrides?: Partial<FlowV3>,
  subflows?: Record<SubflowId, SubflowV3>,
): FlowV3 {
  return {
    schemaVersion: 3,
    id: 'flow-1',
    name: 'Test Flow',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    entryNodeId: 'node-1' as NodeId,
    nodes: [{ id: 'node-1' as NodeId, kind: 'noop', config: {} }],
    edges: [],
    subflows,
    ...overrides,
  };
}

// ==================== Test Node Definitions ====================

/** 空操作节点 */
const noopNodeDef: NodeDefinition = {
  kind: 'noop',
  schema: z.object({}),
  async execute(): Promise<NodeExecutionResult> {
    return { status: 'succeeded' };
  },
};

/** 返回控制流指令的节点 */
function createControlNodeDef(directive: ControlDirectiveV3): NodeDefinition {
  return {
    kind: 'control',
    schema: z.object({}),
    async execute(): Promise<NodeExecutionResult> {
      return { status: 'succeeded', control: directive };
    },
  };
}

/** 设置变量的节点 */
const setVarNodeDef: NodeDefinition = {
  kind: 'setVar',
  schema: z.object({ name: z.string(), value: z.unknown() }),
  async execute(ctx: NodeExecutionContext, node): Promise<NodeExecutionResult> {
    const { name, value } = node.config as { name: string; value: unknown };
    return {
      status: 'succeeded',
      varsPatch: [{ op: 'set', name, value: value as null }],
    };
  },
};

/** 递增计数器节点 */
const incrementNodeDef: NodeDefinition = {
  kind: 'increment',
  schema: z.object({ varName: z.string() }),
  async execute(ctx: NodeExecutionContext, node): Promise<NodeExecutionResult> {
    const { varName } = node.config as { varName: string };
    const current = (ctx.vars[varName] as number) ?? 0;
    return {
      status: 'succeeded',
      varsPatch: [{ op: 'set', name: varName, value: current + 1 }],
    };
  },
};

// ==================== Tests ====================

describe('Control Flow Infrastructure', () => {
  let storage: StoragePort;
  let eventsBus: ReturnType<typeof createMockEventsBus>;

  beforeEach(() => {
    storage = createMockStoragePort();
    eventsBus = createMockEventsBus();
  });

  describe('foreach directive', () => {
    it('should iterate over array and execute subflow for each item', async () => {
      // Setup subflow with increment node
      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'increment', config: { varName: 'counter' } }],
        edges: [],
      };

      // Create flow with foreach control directive
      const foreachDirective: ControlDirectiveV3 = {
        kind: 'foreach',
        listVar: 'items',
        itemVar: 'currentItem',
        subflowId: 'subflow-1' as SubflowId,
      };

      const flow = createTestFlow(
        {
          nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
          variables: [
            { name: 'items', default: [1, 2, 3] },
            { name: 'counter', default: 0 },
          ],
        },
        { 'subflow-1': subflow },
      );

      // Setup plugins
      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(foreachDirective));
      registry.registerNode(incrementNodeDef);

      // Create runner
      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', {
        flow,
        tabId: 1,
      });

      // Execute
      const result = await runner.start();

      // Verify
      expect(result.status).toBe('succeeded');
      expect(runner.getVar('counter')).toBe(3); // Incremented 3 times

      // Check events
      const controlStarted = eventsBus.events.find(
        (e) => e.type === 'control.started' && e.kind === 'foreach',
      );
      expect(controlStarted).toBeDefined();
      expect((controlStarted as { totalIterations: number }).totalIterations).toBe(3);

      const iterations = eventsBus.events.filter((e) => e.type === 'control.iteration');
      expect(iterations).toHaveLength(3);

      const controlCompleted = eventsBus.events.find(
        (e) => e.type === 'control.completed' && e.kind === 'foreach',
      );
      expect(controlCompleted).toBeDefined();
    });

    it('should set item and index variables during iteration', async () => {
      const collectedItems: unknown[] = [];
      const collectedIndices: number[] = [];

      // Custom node to collect iteration values
      const collectNodeDef: NodeDefinition = {
        kind: 'collect',
        schema: z.object({}),
        async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
          collectedItems.push(ctx.vars['item']);
          collectedIndices.push(ctx.vars['item_index'] as number);
          return { status: 'succeeded' };
        },
      };

      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'collect', config: {} }],
        edges: [],
      };

      const foreachDirective: ControlDirectiveV3 = {
        kind: 'foreach',
        listVar: 'items',
        itemVar: 'item',
        subflowId: 'subflow-1' as SubflowId,
      };

      const flow = createTestFlow(
        {
          nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
          variables: [{ name: 'items', default: ['a', 'b', 'c'] }],
        },
        { 'subflow-1': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(foreachDirective));
      registry.registerNode(collectNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      await runner.start();

      expect(collectedItems).toEqual(['a', 'b', 'c']);
      expect(collectedIndices).toEqual([0, 1, 2]);
    });

    it('should fail if list variable is not an array', async () => {
      const foreachDirective: ControlDirectiveV3 = {
        kind: 'foreach',
        listVar: 'notAnArray',
        itemVar: 'item',
        subflowId: 'subflow-1' as SubflowId,
      };

      const flow = createTestFlow(
        {
          nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
          variables: [{ name: 'notAnArray', default: 'string-value' }],
        },
        {
          'subflow-1': {
            entryNodeId: 'sub-1' as NodeId,
            nodes: [{ id: 'sub-1' as NodeId, kind: 'noop', config: {} }],
            edges: [],
          },
        },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(foreachDirective));
      registry.registerNode(noopNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toContain('not an array');
    });

    it('should fail if subflow not found', async () => {
      const foreachDirective: ControlDirectiveV3 = {
        kind: 'foreach',
        listVar: 'items',
        itemVar: 'item',
        subflowId: 'non-existent' as SubflowId,
      };

      const flow = createTestFlow({
        nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
        variables: [{ name: 'items', default: [1, 2, 3] }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(foreachDirective));

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('DAG_INVALID');
      expect(result.error?.message).toContain('not found');
    });
  });

  describe('while directive', () => {
    it('should execute subflow while condition is true', async () => {
      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'increment', config: { varName: 'counter' } }],
        edges: [],
      };

      const whileDirective: ControlDirectiveV3 = {
        kind: 'while',
        condition: {
          kind: 'compare',
          left: { ref: { name: 'counter' } },
          op: 'lt',
          right: 5,
        },
        subflowId: 'subflow-1' as SubflowId,
        maxIterations: 100,
      };

      const flow = createTestFlow(
        {
          nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
          variables: [{ name: 'counter', default: 0 }],
        },
        { 'subflow-1': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(whileDirective));
      registry.registerNode(incrementNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('succeeded');
      expect(runner.getVar('counter')).toBe(5); // Loop until counter >= 5

      const controlCompleted = eventsBus.events.find(
        (e) => e.type === 'control.completed' && e.kind === 'while',
      );
      expect((controlCompleted as { totalIterations: number }).totalIterations).toBe(5);
    });

    it('should stop at maxIterations and emit warning', async () => {
      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'noop', config: {} }],
        edges: [],
      };

      // Always true condition
      const whileDirective: ControlDirectiveV3 = {
        kind: 'while',
        condition: { kind: 'truthy', value: true },
        subflowId: 'subflow-1' as SubflowId,
        maxIterations: 5,
      };

      const flow = createTestFlow(
        { nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }] },
        { 'subflow-1': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(whileDirective));
      registry.registerNode(noopNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('succeeded'); // Doesn't fail, just stops

      // Should have warning log
      const warningLog = eventsBus.events.find((e) => e.type === 'log' && e.level === 'warn');
      expect(warningLog).toBeDefined();
      expect((warningLog as { message: string }).message).toContain('maximum iterations');

      const controlCompleted = eventsBus.events.find(
        (e) => e.type === 'control.completed' && e.kind === 'while',
      );
      expect((controlCompleted as { totalIterations: number }).totalIterations).toBe(5);
    });

    it('should fail if maxIterations is invalid', async () => {
      const whileDirective: ControlDirectiveV3 = {
        kind: 'while',
        condition: { kind: 'truthy', value: true },
        subflowId: 'subflow-1' as SubflowId,
        maxIterations: 0, // Invalid
      };

      const flow = createTestFlow(
        { nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }] },
        {
          'subflow-1': {
            entryNodeId: 'sub-1' as NodeId,
            nodes: [{ id: 'sub-1' as NodeId, kind: 'noop', config: {} }],
            edges: [],
          },
        },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(whileDirective));
      registry.registerNode(noopNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('executeSubflow directive', () => {
    it('should execute subflow once', async () => {
      let execCount = 0;
      const countNodeDef: NodeDefinition = {
        kind: 'count',
        schema: z.object({}),
        async execute(): Promise<NodeExecutionResult> {
          execCount++;
          return { status: 'succeeded' };
        },
      };

      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'count', config: {} }],
        edges: [],
      };

      const executeSubflowDirective: ControlDirectiveV3 = {
        kind: 'executeSubflow',
        subflowId: 'subflow-1' as SubflowId,
      };

      const flow = createTestFlow(
        { nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }] },
        { 'subflow-1': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(executeSubflowDirective));
      registry.registerNode(countNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('succeeded');
      expect(execCount).toBe(1);
    });
  });

  describe('recursion protection', () => {
    it('should fail if control stack depth exceeds maximum', async () => {
      // Create a node that infinitely calls itself via control directive
      let depth = 0;
      const recursiveControlDef: NodeDefinition = {
        kind: 'recursiveControl',
        schema: z.object({}),
        async execute(): Promise<NodeExecutionResult> {
          depth++;
          return {
            status: 'succeeded',
            control: {
              kind: 'executeSubflow',
              subflowId: 'recursive-subflow' as SubflowId,
            },
          };
        },
      };

      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'recursiveControl', config: {} }],
        edges: [],
      };

      const flow = createTestFlow(
        { nodes: [{ id: 'node-1' as NodeId, kind: 'recursiveControl', config: {} }] },
        { 'recursive-subflow': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(recursiveControlDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('CONTROL_STACK_OVERFLOW');
      expect(depth).toBeLessThanOrEqual(MAX_CONTROL_STACK_DEPTH + 1);
    });
  });

  describe('condition evaluation', () => {
    it('should evaluate compare conditions correctly', async () => {
      let conditionMet = false;

      const checkNodeDef: NodeDefinition = {
        kind: 'check',
        schema: z.object({}),
        async execute(): Promise<NodeExecutionResult> {
          conditionMet = true;
          return { status: 'succeeded' };
        },
      };

      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'check', config: {} }],
        edges: [],
      };

      // counter < 1, so should execute once
      const whileDirective: ControlDirectiveV3 = {
        kind: 'while',
        condition: {
          kind: 'compare',
          left: { ref: { name: 'counter' } },
          op: 'lt',
          right: 1,
        },
        subflowId: 'subflow-1' as SubflowId,
        maxIterations: 10,
      };

      const flow = createTestFlow(
        {
          nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
          variables: [{ name: 'counter', default: 0 }],
        },
        { 'subflow-1': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(whileDirective));
      registry.registerNode(checkNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      await runner.start();

      expect(conditionMet).toBe(true);
    });

    it('should evaluate and/or conditions correctly', async () => {
      let iterations = 0;

      const incrementAndCountDef: NodeDefinition = {
        kind: 'incrementAndCount',
        schema: z.object({}),
        async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
          iterations++;
          const current = (ctx.vars['x'] as number) ?? 0;
          return {
            status: 'succeeded',
            varsPatch: [{ op: 'set', name: 'x', value: current + 1 }],
          };
        },
      };

      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'incrementAndCount', config: {} }],
        edges: [],
      };

      // x < 3 AND x >= 0 => should execute 3 times (x=0,1,2)
      const whileDirective: ControlDirectiveV3 = {
        kind: 'while',
        condition: {
          kind: 'and',
          conditions: [
            { kind: 'compare', left: { ref: { name: 'x' } }, op: 'lt', right: 3 },
            { kind: 'compare', left: { ref: { name: 'x' } }, op: 'gte', right: 0 },
          ],
        },
        subflowId: 'subflow-1' as SubflowId,
        maxIterations: 10,
      };

      const flow = createTestFlow(
        {
          nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
          variables: [{ name: 'x', default: 0 }],
        },
        { 'subflow-1': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(whileDirective));
      registry.registerNode(incrementAndCountDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      await runner.start();

      expect(iterations).toBe(3);
    });
  });

  describe('executeFlow directive', () => {
    it('should execute another flow inline (shared vars)', async () => {
      // Target flow that modifies a variable
      const targetFlow: FlowV3 = {
        schemaVersion: 3,
        id: 'target-flow',
        name: 'Target Flow',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        entryNodeId: 'target-node-1' as NodeId,
        nodes: [
          {
            id: 'target-node-1' as NodeId,
            kind: 'setVar',
            config: { name: 'result', value: 'from-target' },
          },
        ],
        edges: [],
      };

      // Save target flow to storage
      await storage.flows.save(targetFlow);

      // Main flow calls target flow inline
      const executeFlowDirective: ControlDirectiveV3 = {
        kind: 'executeFlow',
        flowId: 'target-flow',
        inline: true,
      };

      const mainFlow = createTestFlow({
        id: 'main-flow',
        nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
        variables: [{ name: 'result', default: 'initial' }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(executeFlowDirective));
      registry.registerNode(setVarNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow: mainFlow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('succeeded');
      // With inline=true, target flow's var change should be visible
      expect(runner.getVar('result')).toBe('from-target');
    });

    it('should execute another flow isolated (cloned vars)', async () => {
      // Target flow that modifies a variable
      const targetFlow: FlowV3 = {
        schemaVersion: 3,
        id: 'target-flow',
        name: 'Target Flow',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        entryNodeId: 'target-node-1' as NodeId,
        nodes: [
          {
            id: 'target-node-1' as NodeId,
            kind: 'setVar',
            config: { name: 'result', value: 'from-target' },
          },
        ],
        edges: [],
      };

      await storage.flows.save(targetFlow);

      // Main flow calls target flow with inline=false
      const executeFlowDirective: ControlDirectiveV3 = {
        kind: 'executeFlow',
        flowId: 'target-flow',
        inline: false,
      };

      const mainFlow = createTestFlow({
        id: 'main-flow',
        nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
        variables: [{ name: 'result', default: 'initial' }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(executeFlowDirective));
      registry.registerNode(setVarNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow: mainFlow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('succeeded');
      // With inline=false, target flow's var change should NOT affect caller
      expect(runner.getVar('result')).toBe('initial');
    });

    it('should pass args to target flow', async () => {
      let receivedArg: unknown = null;
      const captureArgDef: NodeDefinition = {
        kind: 'captureArg',
        schema: z.object({}),
        async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
          receivedArg = ctx.vars['inputArg'];
          return { status: 'succeeded' };
        },
      };

      const targetFlow: FlowV3 = {
        schemaVersion: 3,
        id: 'target-flow',
        name: 'Target Flow',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        entryNodeId: 'target-node-1' as NodeId,
        nodes: [{ id: 'target-node-1' as NodeId, kind: 'captureArg', config: {} }],
        edges: [],
      };

      await storage.flows.save(targetFlow);

      const executeFlowDirective: ControlDirectiveV3 = {
        kind: 'executeFlow',
        flowId: 'target-flow',
        args: { inputArg: 'passed-value' },
      };

      const mainFlow = createTestFlow({
        id: 'main-flow',
        nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(executeFlowDirective));
      registry.registerNode(captureArgDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow: mainFlow, tabId: 1 });
      await runner.start();

      expect(receivedArg).toBe('passed-value');
    });

    it('should apply target flow variable defaults', async () => {
      let receivedDefault: unknown = null;
      const captureDefaultDef: NodeDefinition = {
        kind: 'captureDefault',
        schema: z.object({}),
        async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
          receivedDefault = ctx.vars['targetDefault'];
          return { status: 'succeeded' };
        },
      };

      const targetFlow: FlowV3 = {
        schemaVersion: 3,
        id: 'target-flow',
        name: 'Target Flow',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        entryNodeId: 'target-node-1' as NodeId,
        nodes: [{ id: 'target-node-1' as NodeId, kind: 'captureDefault', config: {} }],
        edges: [],
        variables: [{ name: 'targetDefault', default: 'default-value' }],
      };

      await storage.flows.save(targetFlow);

      const executeFlowDirective: ControlDirectiveV3 = {
        kind: 'executeFlow',
        flowId: 'target-flow',
      };

      const mainFlow = createTestFlow({
        id: 'main-flow',
        nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(executeFlowDirective));
      registry.registerNode(captureDefaultDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow: mainFlow, tabId: 1 });
      await runner.start();

      expect(receivedDefault).toBe('default-value');
    });

    it('should detect cyclic flow calls (A -> B -> A)', async () => {
      // Flow B tries to call Flow A (which called it)
      const flowB: FlowV3 = {
        schemaVersion: 3,
        id: 'flow-b',
        name: 'Flow B',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        entryNodeId: 'b-node-1' as NodeId,
        nodes: [{ id: 'b-node-1' as NodeId, kind: 'callFlowA', config: {} }],
        edges: [],
      };

      await storage.flows.save(flowB);

      // Flow A calls Flow B
      const callFlowBDef: NodeDefinition = {
        kind: 'callFlowB',
        schema: z.object({}),
        async execute(): Promise<NodeExecutionResult> {
          return {
            status: 'succeeded',
            control: { kind: 'executeFlow', flowId: 'flow-b' },
          };
        },
      };

      // Flow B tries to call Flow A back (this should fail)
      const callFlowADef: NodeDefinition = {
        kind: 'callFlowA',
        schema: z.object({}),
        async execute(): Promise<NodeExecutionResult> {
          return {
            status: 'succeeded',
            control: { kind: 'executeFlow', flowId: 'flow-a' },
          };
        },
      };

      const flowA = createTestFlow({
        id: 'flow-a',
        nodes: [{ id: 'node-1' as NodeId, kind: 'callFlowB', config: {} }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(callFlowBDef);
      registry.registerNode(callFlowADef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow: flowA, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('FLOW_CYCLE');
      expect(result.error?.message).toContain('flow-a');
      expect(result.error?.message).toContain('flow-b');
    });

    it('should fail if target flow not found', async () => {
      const executeFlowDirective: ControlDirectiveV3 = {
        kind: 'executeFlow',
        flowId: 'non-existent-flow',
      };

      const mainFlow = createTestFlow({
        id: 'main-flow',
        nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(executeFlowDirective));

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow: mainFlow, tabId: 1 });
      const result = await runner.start();

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('FLOW_NOT_FOUND');
      expect(result.error?.message).toContain('non-existent-flow');
    });

    it('should emit control.started and control.completed events', async () => {
      const targetFlow: FlowV3 = {
        schemaVersion: 3,
        id: 'target-flow',
        name: 'Target Flow',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        entryNodeId: 'target-node-1' as NodeId,
        nodes: [{ id: 'target-node-1' as NodeId, kind: 'noop', config: {} }],
        edges: [],
      };

      await storage.flows.save(targetFlow);

      const executeFlowDirective: ControlDirectiveV3 = {
        kind: 'executeFlow',
        flowId: 'target-flow',
        inline: true,
      };

      const mainFlow = createTestFlow({
        id: 'main-flow',
        nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
      });

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(executeFlowDirective));
      registry.registerNode(noopNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow: mainFlow, tabId: 1 });
      await runner.start();

      // Check control.started
      const started = eventsBus.events.find(
        (e) => e.type === 'control.started' && (e as { kind: string }).kind === 'executeFlow',
      );
      expect(started).toBeDefined();
      expect((started as { nodeId: string }).nodeId).toBe('node-1');
      expect((started as { flowId: string }).flowId).toBe('target-flow');
      expect((started as { inline: boolean }).inline).toBe(true);

      // Check control.completed
      const completed = eventsBus.events.find(
        (e) => e.type === 'control.completed' && (e as { kind: string }).kind === 'executeFlow',
      );
      expect(completed).toBeDefined();
      expect((completed as { nodeId: string }).nodeId).toBe('node-1');
      expect((completed as { flowId: string }).flowId).toBe('target-flow');
      expect(typeof (completed as { tookMs: number }).tookMs).toBe('number');
    });
  });

  describe('event emission', () => {
    it('should emit control events with nodeId and tookMs', async () => {
      const subflow: SubflowV3 = {
        entryNodeId: 'sub-node-1' as NodeId,
        nodes: [{ id: 'sub-node-1' as NodeId, kind: 'noop', config: {} }],
        edges: [],
      };

      const foreachDirective: ControlDirectiveV3 = {
        kind: 'foreach',
        listVar: 'items',
        itemVar: 'item',
        subflowId: 'subflow-1' as SubflowId,
      };

      const flow = createTestFlow(
        {
          nodes: [{ id: 'node-1' as NodeId, kind: 'control', config: {} }],
          variables: [{ name: 'items', default: [1, 2] }],
        },
        { 'subflow-1': subflow },
      );

      const registry = new PluginRegistry();
      registry.registerNode(createControlNodeDef(foreachDirective));
      registry.registerNode(noopNodeDef);

      const factory = createRunRunnerFactory({
        storage,
        events: eventsBus,
        plugins: registry,
        now: () => Date.now(),
      });

      const runner = factory.create('run-1', { flow, tabId: 1 });
      await runner.start();

      // Check control.started has nodeId
      const started = eventsBus.events.find((e) => e.type === 'control.started');
      expect(started).toBeDefined();
      expect((started as { nodeId: string }).nodeId).toBe('node-1');

      // Check control.iteration has nodeId and subflowId
      const iterations = eventsBus.events.filter((e) => e.type === 'control.iteration');
      expect(iterations).toHaveLength(2);
      for (const iter of iterations) {
        expect((iter as { nodeId: string }).nodeId).toBe('node-1');
        expect((iter as { subflowId: string }).subflowId).toBe('subflow-1');
      }

      // Check control.completed has nodeId and tookMs
      const completed = eventsBus.events.find((e) => e.type === 'control.completed');
      expect(completed).toBeDefined();
      expect((completed as { nodeId: string }).nodeId).toBe('node-1');
      expect(typeof (completed as { tookMs: number }).tookMs).toBe('number');
    });
  });
});
