/**
 * @fileoverview V2 -> V3 数据迁移
 * @description 扩展启动时的一次性迁移，将 V2 存储的数据迁移到 V3
 */

import type { StoragePort } from '../../engine/storage/storage-port';
import type { FlowId, TriggerId } from '../../domain/ids';
import type { FlowV3 } from '../../domain/flow';
import { createV2ReaderFromStorage } from './v2-reader';
import { convertFlowV2ToV3, convertTriggerV2ToV3, convertScheduleV2ToV3 } from './v2-to-v3';

// ==================== Types ====================

export const RR_V3_V2_MIGRATION_STATE_KEY = 'rr_v3_migration_v2_to_v3' as const;

/** 迁移统计摘要 */
export interface V2ToV3MigrationSummary {
  flows: {
    total: number;
    migrated: number;
    skippedExisting: number;
    failed: number;
  };
  triggers: {
    total: number;
    migrated: number;
    skippedExisting: number;
    skippedMissingFlow: number;
    failed: number;
  };
  schedules: {
    total: number;
    migrated: number;
    skippedExisting: number;
    skippedMissingFlow: number;
    failed: number;
  };
  published: {
    total: number;
    slugsApplied: number;
  };
}

/** 迁移状态 */
export type V2ToV3MigrationState =
  | { status: 'in_progress'; startedAt: number }
  | { status: 'failed'; startedAt: number; failedAt: number; error: string }
  | {
      status: 'done';
      startedAt: number;
      finishedAt: number;
      summary: V2ToV3MigrationSummary;
      warnings: string[];
      errors: string[];
    };

// ==================== State ====================

let migrationPromise: Promise<V2ToV3MigrationState> | null = null;

// ==================== Utilities ====================

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

async function readState(): Promise<V2ToV3MigrationState | undefined> {
  try {
    const res = await chrome.storage.local.get([RR_V3_V2_MIGRATION_STATE_KEY]);
    return res[RR_V3_V2_MIGRATION_STATE_KEY] as V2ToV3MigrationState | undefined;
  } catch {
    return undefined;
  }
}

async function writeState(state: V2ToV3MigrationState): Promise<void> {
  try {
    await chrome.storage.local.set({ [RR_V3_V2_MIGRATION_STATE_KEY]: state });
  } catch (e) {
    console.warn('[RR-V3 Migration] Failed to write migration state:', e);
  }
}

/**
 * 将 published slug 写入 FlowV3.meta.tool.slug
 */
function withToolSlug(flow: FlowV3, slug: string): FlowV3 {
  return {
    ...flow,
    meta: {
      ...(flow.meta ?? {}),
      tool: {
        ...(flow.meta?.tool ?? {}),
        slug,
      },
    },
  } as FlowV3;
}

// ==================== Migration ====================

/**
 * 执行 V2 -> V3 数据迁移
 *
 * 特性：
 * - 幂等：已迁移（status=done）则直接返回
 * - 并发安全：使用 Promise 合并多次调用
 * - 非致命错误：单条记录失败不影响整体迁移
 * - 不覆盖：默认不覆盖已存在的 V3 记录
 */
export async function ensureMigratedV2ToV3(deps: {
  storage: Pick<StoragePort, 'flows' | 'triggers'>;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  overwriteExisting?: boolean;
}): Promise<V2ToV3MigrationState> {
  // 合并并发调用
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const logger = deps.logger ?? console;

    // 1. 检查是否已迁移
    const existing = await readState();
    if (existing?.status === 'done') {
      logger.debug('[RR-V3 Migration] Already migrated, skipping');
      return existing;
    }

    const startedAt = existing?.status === 'in_progress' ? existing.startedAt : Date.now();
    await writeState({ status: 'in_progress', startedAt });

    try {
      // 2. 读取 V2 数据
      logger.info('[RR-V3 Migration] Reading V2 data...');
      const reader = createV2ReaderFromStorage();
      const [flowsV2, triggersV2, schedulesV2, publishedV2] = await Promise.all([
        reader.readFlows(),
        reader.readTriggers(),
        reader.readSchedules(),
        reader.readPublished(),
      ]);

      logger.info(
        `[RR-V3 Migration] V2 data: ${flowsV2.length} flows, ${triggersV2.length} triggers, ${schedulesV2.length} schedules, ${publishedV2.length} published`,
      );

      // 3. 构建 published slug 映射
      const slugByFlowId = new Map<string, string>();
      for (const p of publishedV2) {
        if (p?.id && p?.slug) {
          slugByFlowId.set(String(p.id), String(p.slug));
        }
      }

      // 4. 初始化统计
      const summary: V2ToV3MigrationSummary = {
        flows: { total: flowsV2.length, migrated: 0, skippedExisting: 0, failed: 0 },
        triggers: {
          total: triggersV2.length,
          migrated: 0,
          skippedExisting: 0,
          skippedMissingFlow: 0,
          failed: 0,
        },
        schedules: {
          total: schedulesV2.length,
          migrated: 0,
          skippedExisting: 0,
          skippedMissingFlow: 0,
          failed: 0,
        },
        published: { total: publishedV2.length, slugsApplied: 0 },
      };

      const warnings: string[] = [];
      const errors: string[] = [];

      // Flow 存在性缓存，减少重复查询
      const flowExistsCache = new Map<string, boolean>();

      // 5. 迁移 Flows
      logger.info('[RR-V3 Migration] Migrating flows...');
      for (const v2Flow of flowsV2) {
        const flowId = v2Flow?.id ? (String(v2Flow.id) as FlowId) : null;
        if (!flowId) {
          summary.flows.failed += 1;
          errors.push('[flow] missing id');
          continue;
        }

        // 检查是否已存在
        if (!deps.overwriteExisting) {
          const existingFlow = await deps.storage.flows.get(flowId);
          flowExistsCache.set(flowId, !!existingFlow);
          if (existingFlow) {
            summary.flows.skippedExisting += 1;

            // Best-effort: 为已存在的 V3 flow 回填 slug（如果缺失）
            const slug = slugByFlowId.get(flowId);
            const existingSlug = existingFlow.meta?.tool?.slug;
            if (slug && !existingSlug) {
              try {
                await deps.storage.flows.save(withToolSlug(existingFlow, slug));
                summary.published.slugsApplied += 1;
              } catch (e) {
                errors.push(`[flow:${flowId}] backfill slug failed: ${errorMessage(e)}`);
              }
            }
            continue;
          }
        }

        // 转换
        const result = convertFlowV2ToV3(v2Flow as Parameters<typeof convertFlowV2ToV3>[0]);
        warnings.push(...result.warnings.map((w) => `[flow:${flowId}] ${w}`));

        if (!result.success || !result.data) {
          summary.flows.failed += 1;
          errors.push(`[flow:${flowId}] ${result.errors.join('; ')}`);
          continue;
        }

        // 应用 published slug
        let flowV3 = result.data;
        const slug = slugByFlowId.get(flowId);
        if (slug) {
          flowV3 = withToolSlug(flowV3, slug);
          summary.published.slugsApplied += 1;
        }

        // 保存
        try {
          await deps.storage.flows.save(flowV3);
          flowExistsCache.set(flowId, true);
          summary.flows.migrated += 1;
        } catch (e) {
          summary.flows.failed += 1;
          errors.push(`[flow:${flowId}] save failed: ${errorMessage(e)}`);
        }
      }

      // 6. 辅助函数：检查 Flow 是否存在于 V3（使用缓存）
      const flowExistsInV3 = async (id: string): Promise<boolean> => {
        const cached = flowExistsCache.get(id);
        if (cached !== undefined) return cached;

        try {
          const flow = await deps.storage.flows.get(id as FlowId);
          const exists = !!flow;
          flowExistsCache.set(id, exists);
          return exists;
        } catch {
          flowExistsCache.set(id, false);
          return false;
        }
      };

      // 7. 迁移 Triggers
      logger.info('[RR-V3 Migration] Migrating triggers...');
      for (const v2Trigger of triggersV2) {
        const triggerId = String(v2Trigger?.id ?? '');
        const flowId = String(v2Trigger?.flowId ?? '');

        if (!triggerId || !flowId) {
          summary.triggers.failed += 1;
          errors.push('[trigger] missing id/flowId');
          continue;
        }

        // 检查关联的 Flow 是否存在
        if (!(await flowExistsInV3(flowId))) {
          summary.triggers.skippedMissingFlow += 1;
          warnings.push(`[trigger:${triggerId}] skipped: flow "${flowId}" not found in V3`);
          continue;
        }

        // 检查是否已存在
        if (!deps.overwriteExisting) {
          const exists = await deps.storage.triggers.get(triggerId as TriggerId);
          if (exists) {
            summary.triggers.skippedExisting += 1;
            continue;
          }
        }

        // 转换
        const result = convertTriggerV2ToV3(v2Trigger);
        warnings.push(...result.warnings.map((w) => `[trigger:${triggerId}] ${w}`));

        if (!result.success || !result.data) {
          summary.triggers.failed += 1;
          errors.push(`[trigger:${triggerId}] ${result.errors.join('; ')}`);
          continue;
        }

        // 保存
        try {
          await deps.storage.triggers.save(result.data);
          summary.triggers.migrated += 1;
        } catch (e) {
          summary.triggers.failed += 1;
          errors.push(`[trigger:${triggerId}] save failed: ${errorMessage(e)}`);
        }
      }

      // 8. 迁移 Schedules (转换为 Triggers)
      logger.info('[RR-V3 Migration] Migrating schedules...');
      const scheduleIdPrefix = 'rr_v2_schedule_';

      for (const v2Schedule of schedulesV2) {
        const scheduleId = String(v2Schedule?.id ?? '');
        const flowId = String(v2Schedule?.flowId ?? '');

        if (!scheduleId || !flowId) {
          summary.schedules.failed += 1;
          errors.push('[schedule] missing id/flowId');
          continue;
        }

        // 检查关联的 Flow 是否存在
        if (!(await flowExistsInV3(flowId))) {
          summary.schedules.skippedMissingFlow += 1;
          warnings.push(`[schedule:${scheduleId}] skipped: flow "${flowId}" not found in V3`);
          continue;
        }

        // 转换
        const result = convertScheduleV2ToV3(v2Schedule, { idPrefix: scheduleIdPrefix });
        warnings.push(...result.warnings.map((w) => `[schedule:${scheduleId}] ${w}`));

        if (!result.success || !result.data) {
          summary.schedules.failed += 1;
          errors.push(`[schedule:${scheduleId}] ${result.errors.join('; ')}`);
          continue;
        }

        // 检查是否已存在（使用转换后的 ID）
        if (!deps.overwriteExisting) {
          const exists = await deps.storage.triggers.get(result.data.id);
          if (exists) {
            summary.schedules.skippedExisting += 1;
            continue;
          }
        }

        // 保存
        try {
          await deps.storage.triggers.save(result.data);
          summary.schedules.migrated += 1;
        } catch (e) {
          summary.schedules.failed += 1;
          errors.push(`[schedule:${scheduleId}] save failed: ${errorMessage(e)}`);
        }
      }

      // 9. 清理 V2 遗留的 rr_schedule_* alarms
      logger.info('[RR-V3 Migration] Cleaning legacy V2 schedule alarms...');
      try {
        const alarms = await chrome.alarms.getAll();
        const v2ScheduleAlarms = alarms.filter((a) => a.name?.startsWith('rr_schedule_'));
        for (const alarm of v2ScheduleAlarms) {
          try {
            await chrome.alarms.clear(alarm.name);
          } catch {
            // Ignore individual clear failures
          }
        }
        if (v2ScheduleAlarms.length > 0) {
          logger.info(`[RR-V3 Migration] Cleared ${v2ScheduleAlarms.length} legacy V2 alarms`);
        }
      } catch (e) {
        warnings.push(`[alarms] Failed to clean legacy V2 alarms: ${errorMessage(e)}`);
      }

      // 10. 完成迁移
      const done: V2ToV3MigrationState = {
        status: 'done',
        startedAt,
        finishedAt: Date.now(),
        summary,
        warnings: warnings.slice(0, 200), // 截断避免存储过大
        errors: errors.slice(0, 200),
      };

      await writeState(done);

      logger.info('[RR-V3 Migration] Complete:', JSON.stringify(done.summary));
      if (errors.length > 0) {
        logger.warn(`[RR-V3 Migration] ${errors.length} errors occurred:`, errors.slice(0, 10));
      }

      return done;
    } catch (e) {
      // 致命错误
      const failed: V2ToV3MigrationState = {
        status: 'failed',
        startedAt,
        failedAt: Date.now(),
        error: errorMessage(e),
      };
      await writeState(failed);
      logger.error('[RR-V3 Migration] Failed:', failed.error);
      return failed;
    }
  })().finally(() => {
    migrationPromise = null;
  });

  return migrationPromise;
}

/**
 * 重置迁移状态（用于测试或重新迁移）
 */
export async function resetMigrationState(): Promise<void> {
  await chrome.storage.local.remove([RR_V3_V2_MIGRATION_STATE_KEY]);
}

/**
 * 获取当前迁移状态
 */
export async function getMigrationState(): Promise<V2ToV3MigrationState | undefined> {
  return readState();
}
