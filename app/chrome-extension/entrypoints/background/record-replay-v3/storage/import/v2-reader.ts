/**
 * @fileoverview V2 数据读取器
 * @description 读取 V2 格式的数据用于迁移到 V3
 */

import type { Flow } from '@/entrypoints/background/record-replay/types';
import {
  listFlows,
  listPublished,
  listSchedules,
  type FlowSchedule,
  type PublishedFlowInfo,
} from '@/entrypoints/background/record-replay/flow-store';
import {
  listTriggers,
  type FlowTrigger,
} from '@/entrypoints/background/record-replay/trigger-store';

/**
 * V2 数据读取器接口
 */
export interface V2Reader {
  /** 读取 V2 Flows */
  readFlows(): Promise<Flow[]>;
  /** 读取 V2 Triggers */
  readTriggers(): Promise<FlowTrigger[]>;
  /** 读取 V2 Schedules */
  readSchedules(): Promise<FlowSchedule[]>;
  /** 读取 V2 Published */
  readPublished(): Promise<PublishedFlowInfo[]>;
}

/**
 * 创建从 V2 存储读取数据的 Reader
 * 使用 V2 store 的入口函数以确保 local->IDB 迁移和 flow 规范化已执行
 */
export function createV2ReaderFromStorage(): V2Reader {
  return {
    readFlows: listFlows,
    readTriggers: listTriggers,
    readSchedules: listSchedules,
    readPublished: listPublished,
  };
}

/**
 * 创建 NotImplemented 的 V2Reader（用于测试）
 */
export function createNotImplementedV2Reader(): V2Reader {
  const notImplemented = async () => {
    throw new Error('V2Reader not implemented');
  };

  return {
    readFlows: notImplemented,
    readTriggers: notImplemented,
    readSchedules: notImplemented,
    readPublished: notImplemented,
  };
}
