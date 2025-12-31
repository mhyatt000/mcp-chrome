/**
 * @fileoverview Control flow types
 * @description 定义 V3 Runner 的控制流指令（foreach/while/subflow/flow）
 */

import type { Condition } from './condition';
import type { FlowId, SubflowId } from './ids';
import type { JsonObject } from './json';
import type { VariableName } from './variables';

/**
 * ConditionV3
 * @description V3 独立的条件类型，与 V2 结构兼容但无源码依赖
 */
export type ConditionV3 = Condition;

/**
 * ControlDirectiveV3
 * @description Runner 接收到该指令后，会在同一个 Runner 内同步执行控制流。
 *
 * 支持的指令类型：
 * - `foreach`: 遍历数组变量，对每个元素执行 subflow
 * - `while`: 条件循环，每次迭代前重新评估条件
 * - `executeSubflow`: 执行指定的 subflow（无循环）
 * - `executeFlow`: 执行另一个 Flow（跨 Flow 调用，支持 inline/isolated 模式）
 */
export type ControlDirectiveV3 =
  | ForeachDirective
  | WhileDirective
  | ExecuteSubflowDirective
  | ExecuteFlowDirective;

/**
 * Foreach 指令
 * @description 遍历 listVar 指定的数组变量，每次迭代将当前元素赋值给 itemVar
 */
export interface ForeachDirective {
  kind: 'foreach';
  /** 包含待遍历数组的变量名 */
  listVar: VariableName;
  /** 当前元素赋值到的变量名 */
  itemVar: VariableName;
  /** 要执行的 subflow ID */
  subflowId: SubflowId;
  /**
   * 并发执行数量
   * @description 暂不支持并发执行（>1 将由 Runner 报错）
   * @default 1
   */
  concurrency?: number;
}

/**
 * While 指令
 * @description 每次迭代前评估条件，条件为真则执行 subflow
 */
export interface WhileDirective {
  kind: 'while';
  /** 循环条件 */
  condition: ConditionV3;
  /** 要执行的 subflow ID */
  subflowId: SubflowId;
  /**
   * 最大迭代次数
   * @description 防止无限循环，达到上限后停止循环（不报错，仅警告）
   * @default 1000
   */
  maxIterations: number;
}

/**
 * ExecuteSubflow 指令
 * @description 执行指定的 subflow（单次执行，无循环）
 */
export interface ExecuteSubflowDirective {
  kind: 'executeSubflow';
  /** 要执行的 subflow ID */
  subflowId: SubflowId;
}

/**
 * ExecuteFlow 指令
 * @description 执行另一个 Flow（跨 Flow 调用）
 *
 * 执行语义：
 * - inline=true (默认): 共享变量表，被调用 Flow 的变量修改会影响调用方
 * - inline=false: 克隆变量表，被调用 Flow 的变量修改不影响调用方
 *
 * 递归保护：Runner 维护 flowId 调用栈，检测循环调用
 */
export interface ExecuteFlowDirective {
  kind: 'executeFlow';
  /** 要执行的 Flow ID */
  flowId: FlowId;
  /** 传递给被调用 Flow 的参数（合并到变量表） */
  args?: JsonObject;
  /**
   * 是否内联执行
   * - true: 共享变量表（默认）
   * - false: 克隆变量表
   * @default true
   */
  inline?: boolean;
}

// ================================
// Constants
// ================================

/** While 循环默认最大迭代次数 */
export const DEFAULT_WHILE_MAX_ITERATIONS = 1000;

/** 控制流调用栈最大深度（防止无限递归） */
export const MAX_CONTROL_STACK_DEPTH = 50;
