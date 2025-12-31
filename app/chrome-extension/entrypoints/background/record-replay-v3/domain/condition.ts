/**
 * @fileoverview 条件表达式类型定义
 * @description 定义 Record-Replay V3 中使用的条件表达式系统
 *
 * 该文件从 V2 的 actions/types.ts 中提取，实现 V3 对 V2 的类型解耦。
 * 类型结构与 V2 完全兼容，确保现有 Flow 数据不需要迁移。
 */

import type { JsonValue } from './json';
import type { VariableName } from './variables';

// ================================
// 表达式类型
// ================================

/** 表达式语言 */
export type ExpressionLanguage = 'js' | 'rr';

/** 变量路径片段 */
export type VariablePathSegment = string | number;

/** 变量作用域（兼容 V2 的定义） */
export type VariableScopeV2 = 'flow' | 'run' | 'env' | 'secret';

/** 变量指针（兼容 V2 的定义） */
export interface VariablePointerV2 {
  scope?: VariableScopeV2;
  name: VariableName;
  path?: ReadonlyArray<VariablePathSegment>;
}

/** 表达式 */
export interface Expression<_T = JsonValue> {
  language: ExpressionLanguage;
  code: string;
}

/** 变量值引用 */
export interface VariableValue<T> {
  kind: 'var';
  ref: VariablePointerV2;
  default?: T;
}

/** 表达式值 */
export interface ExpressionValue<T> {
  kind: 'expr';
  expr: Expression<T>;
  default?: T;
}

/** 非空数组类型 */
export type NonEmptyArray<T> = [T, ...T[]];

/** 模板格式 */
export type TemplateFormat = 'text' | 'json' | 'urlEncoded';

/** 模板部分 */
export type TemplatePart =
  | { kind: 'text'; value: string }
  | { kind: 'insert'; value: Resolvable<JsonValue>; format?: TemplateFormat };

/** 字符串模板 */
export interface StringTemplate {
  kind: 'template';
  parts: NonEmptyArray<TemplatePart>;
}

/**
 * 可解析值类型
 * @description 支持直接值、变量引用、表达式和字符串模板
 */
export type Resolvable<T> =
  | T
  | VariableValue<T>
  | ExpressionValue<T>
  | ([T] extends [string] ? StringTemplate : never);

// ================================
// 比较操作符
// ================================

/** 比较操作符 */
export type CompareOp =
  | 'eq' // 相等
  | 'eqi' // 相等（忽略大小写）
  | 'neq' // 不相等
  | 'gt' // 大于
  | 'gte' // 大于等于
  | 'lt' // 小于
  | 'lte' // 小于等于
  | 'contains' // 包含
  | 'containsI' // 包含（忽略大小写）
  | 'notContains' // 不包含
  | 'notContainsI' // 不包含（忽略大小写）
  | 'startsWith' // 以...开头
  | 'endsWith' // 以...结尾
  | 'regex'; // 正则匹配

// ================================
// 条件表达式
// ================================

/**
 * 条件表达式类型
 * @description 支持表达式、比较、truthy/falsy 检查和逻辑组合
 *
 * 结构与 V2 完全兼容，Runner 的 evaluateConditionV3 可直接解析
 */
export type Condition =
  | { kind: 'expr'; expr: Expression<boolean> }
  | {
      kind: 'compare';
      left: Resolvable<JsonValue>;
      op: CompareOp;
      right: Resolvable<JsonValue>;
    }
  | { kind: 'truthy'; value: Resolvable<JsonValue> }
  | { kind: 'falsy'; value: Resolvable<JsonValue> }
  | { kind: 'not'; condition: Condition }
  | { kind: 'and'; conditions: NonEmptyArray<Condition> }
  | { kind: 'or'; conditions: NonEmptyArray<Condition> };
