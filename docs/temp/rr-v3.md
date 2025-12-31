# Record-Replay V3 重构实施计划

## 项目概述

将 Chrome 扩展的录制回放系统从 V2 架构完全迁移到 V3 架构，包括 Builder UI、节点扩展、触发器系统等。

## 当前状态

- **Phase 0-3**: 全部完成 ✅
- **Phase 4 (触发器系统)**: 全部完成 ✅
  - ✅ P4-01 TriggerStore CRUD
  - ✅ P4-02 TriggerManager
  - ✅ P4-03 URL trigger
  - ✅ P4-04 Command trigger
  - ✅ P4-05 ContextMenu trigger
  - ✅ P4-06 DOM trigger
  - ✅ P4-07 Cron trigger
  - ✅ P4-08 防抖/防风暴 (cooldown/maxQueued 已实现)
  - ✅ P4-09 触发器管理 RPC API
- **Milestone 1 (Builder 核心链路 V3 化)**: 全部完成 ✅
- **Milestone 2 (Builder 数据层 V3 化)**: 部分完成 🔄
  - ⏸️ 2.1 类型迁移 - 评估后延后（当前转换层工作良好）
  - ✅ 2.2 entryNodeId 计算优化
  - ✅ 2.3 Sidebar Flow 分类 bug 修复
- **Milestone 3 (触发器扩展)**: 全部完成 ✅
- **Milestone 4 (节点扩展)**: 全部完成 ✅
  - ✅ 4.1 triggerEvent/setAttribute ActionHandler
  - ✅ 4.2 V3 Control Flow 基础设施
  - ✅ 4.3 foreach/while/loopElements 节点
  - ✅ 4.4 executeFlow 节点
- **Milestone 5 (清理 V2 代码)**: 全部完成 ✅
  - ✅ 5.1 V2 代码依赖关系分析
  - ✅ 5.2a 解耦 Condition 类型依赖 (创建 V3 独立 condition.ts)
  - ✅ 5.3 迁移 Builder UI 残留 V2 调用 (PropertyPanel.vue, PropertyExecuteFlow.vue)
  - ✅ 5.4 迁移 Popup V2 消息通道 (loadFlows/runFlow → V3 RPC)
  - ✅ 5.5 迁移 Tools/NativeHost V2 调用 (record-replay.ts, native-host.ts)
  - ✅ 5.6 实现 V2→V3 数据迁移
  - ✅ 5.7 下线 V2 Runtime（移除 initRecordReplayListeners 调用，保留代码作为共享模块）
- **测试状态**: 668 个测试全部通过 ✅
- **项目状态**: V3 迁移完成 🎉

## 用户决策

1. **节点处理**: 全部实现 handler（foreach, while, loopElements, executeFlow, triggerEvent, setAttribute）
2. **触发器 UI**: 升级成独立面板
3. **Schedule 迁移**: 新增 interval/once kind 到 V3 触发器模型
4. **V2 兼容**: 删除 V2 兼容代码

---

## Milestone 1: Builder 核心链路 V3 化 ✅ (已完成)

### 1.1 共享 RPC 层 ✅

**完成内容**:

- 新建: `app/chrome-extension/entrypoints/shared/composables/useRRV3Rpc.ts`
- 新建: `app/chrome-extension/entrypoints/shared/composables/index.ts`
- 修改: `app/chrome-extension/entrypoints/sidepanel/composables/useRRV3Rpc.ts` → re-export

### 1.2 startNodeId 端到端补完 ✅

**完成内容**:

- `EnqueueRunInput` 新增 `startNodeId?: NodeId`
- 在 `enqueue-run.ts` 添加 startNodeId 校验和持久化
- 在 `rpc-server.ts` 传递 `params.startNodeId`
- 新增 2 个测试用例

### 1.3 Builder RPC 迁移 ✅

**完成内容**:

- 新建: `app/chrome-extension/entrypoints/shared/utils/rr-flow-convert.ts` (V2/V3 双向转换)
- 新建: `app/chrome-extension/entrypoints/shared/utils/index.ts`
- 修改 `App.vue`:
  - `bootstrap()` → `rr_v3.getFlow` + flow not found 处理
  - `save()` → `rr_v3.saveFlow` + V2→V3 转换
  - `runFromSelected()`/`runAll()` → `rr_v3.enqueueRun` (含 startNodeId)
  - `syncTriggersAndSchedules()` → V3 trigger API (schedule→cron 转换)
  - `exportFlow()` → 直接导出 V3 JSON
  - `onImport()` → 支持 V2/V3 双向导入
- 测试: 601 个测试全部通过

---

## Milestone 2: Builder 数据层 V3 化

### 2.1 类型迁移 ⏸️ (评估后延后)

**状态**: 当前 V2↔V3 转换层工作良好，暂不需要完全迁移

**关键差异**:
| V2 | V3 |
|----|-----|
| `type: NodeType` | `kind: NodeKind` |
| `version: number` | `schemaVersion: 3` |
| 无 entryNodeId | `entryNodeId: NodeId` |
| `meta.createdAt` | 顶层 `createdAt: ISODateTimeString` |

### 2.2 entryNodeId 计算 ✅

**完成内容**:

- 重构 `findEntryNodeId` 函数，只统计可执行节点之间的边（忽略 trigger 指出的边）
- 新增 `selectStableRootNode` 函数，实现稳定的多根节点选择
- 新增 17 个测试用例

### 2.3 修复 Sidebar Flow 分类 bug ✅

**完成内容**:

- Sidebar.vue computed 返回值增加 `Flow` 分类
- 将 trigger 和 executeFlow 节点移到 Flow 分类

---

## Milestone 3: 触发器系统扩展 ✅ (已完成)

### 3.1 interval/once TriggerKind ✅

**完成内容**:

- `TriggerKind` 新增 `'interval' | 'once'`
- 新建 `interval-trigger.ts` 和 `once-trigger.ts`
- 新增 23 个测试用例

### 3.2 Trigger 独立面板 ✅

**完成内容**:

- 新建 `TriggerPanel.vue` 组件
- 在 Builder 顶栏添加 "Triggers" 按钮

---

## Milestone 4: 节点扩展 ✅ (已完成)

### 4.1 triggerEvent / setAttribute ✅

**完成内容**:

- 新建 `dom.ts` handler 文件
- 实现 `triggerEventHandler` 和 `setAttributeHandler`

### 4.2 V3 Control Flow 基础设施 ✅

**完成内容**:

- 新建 `domain/control.ts` 定义 `ControlDirectiveV3` 联合类型
- 扩展 `engine/kernel/runner.ts` 支持 control directives
- 新增 12 个测试用例

### 4.3 foreach / while / loopElements ✅

**完成内容**:

- 移除 V2 adapter 对 control directive 的拒绝
- 放开 foreach/while 的 exclude 列表
- V2↔V3 转换支持 subflows
- 实现 loopElements V2 Handler

### 4.4 executeFlow ✅ (最高复杂度)

**目标**: 实现跨 Flow 调用

**关键设计**:

- 不走 enqueueRun（避免死锁）
- 作为 control directive 由 runner 直接子执行
- `inline=true`: 共享 vars
- `inline=false`: clone vars
- 递归防护: 维护 flowId 调用栈检测环

**完成内容**:

#### 4.4.1 类型扩展 ✅

- `domain/control.ts`: `ExecuteFlowDirective` 新增 `inline?: boolean`
- `domain/errors.ts`: 新增 `FLOW_CYCLE` 和 `FLOW_NOT_FOUND` 错误码
- `domain/events.ts`: `control.started` 事件新增 `inline?: boolean`

#### 4.4.2 V2 Handler 实现 ✅

- 新建: `actions/handlers/execute-flow.ts`
- 支持 `flowId`, `args`, `inline` 参数
- 使用 `tryResolveJson` 解析 args 中的变量引用
- 返回 control directive 给 V3 Runner 处理

#### 4.4.3 V2 Adapter 更新 ✅

- `v2-action-adapter.ts`: 新增 `executeFlow` case 到 `mapV2ControlDirectiveToV3`

#### 4.4.4 Runner 实现 ✅

- `runner.ts`: 新增 `flowCallStack: string[]` 用于循环检测
- 新增 `executeFlowDirective()` 方法
  - 循环检测 via flowCallStack
  - 从 storage 加载目标 Flow
  - DAG 验证
  - inline/isolated vars 处理
  - Args 合并
  - 目标 Flow 变量默认值应用
  - 事件发射

#### 4.4.5 Codex Review 修复 ✅

- **P0 修复**: `runGraph` 签名改为 `runGraph(flowContext, graph, startNodeId)`
  - 所有调用点更新为传递正确的 flowContext
  - `runNode` 内部使用 `flowContext` 确保目标 Flow 的 policy/subflows 正确生效
- **Issue 1/2 修复**: 重构 try/finally 结构
  - `flowCallStack.push()` 和 vars 修改放入 try 块内
  - finally 使用 `varsModified` 标志确保正确恢复
- **Issue 3 修复**: 事件类型定义中添加 `inline?: boolean`
- **Issue 4 修复**: V2 handler 使用 `tryResolveJson` 解析 args

#### 4.4.6 测试覆盖 ✅

- 新增 7 个 executeFlow 测试用例:
  - inline 模式共享变量
  - isolated 模式隔离变量
  - args 传递
  - 目标 Flow 变量默认值
  - 循环检测 (A -> B -> A)
  - Flow 不存在错误
  - control.started/completed 事件

**文件变更**:

- `domain/control.ts`
- `domain/errors.ts`
- `domain/events.ts`
- `actions/handlers/execute-flow.ts` (新文件)
- `actions/handlers/index.ts`
- `actions/types.ts`
- `nodes/types.ts`
- `engine/plugins/v2-action-adapter.ts`
- `engine/kernel/runner.ts`
- `tests/record-replay-v3/control-flow.test.ts`

**测试**: 668 个测试全部通过

---

## Milestone 5: 清理 V2 代码 🔄 (进行中 - 2025-12-30)

### 5.1 V2 代码依赖关系分析 ✅ (已完成)

**分析结论（Codex Review）**:

#### V3 对 V2 的硬依赖（必须先处理）

1. **ActionHandlers 复用**: V3 通过 `registerV2ReplayNodesAsV3Nodes()` 直接调用 V2 handlers
   - 依赖: `record-replay-v3/engine/plugins/register-v2-replay-nodes.ts` → `record-replay/actions/handlers`
2. **类型依赖**: `ConditionV3` 直接复用 V2 `Condition` 类型
   - 依赖: `record-replay-v3/domain/control.ts` → `record-replay/types`

#### UI 残留 V2 调用（需迁移）

1. **Builder**: `RR_LIST_FLOWS` 用于 executeFlow 下拉
   - `PropertyPanel.vue:473`, `PropertyExecuteFlow.vue:40`
2. **Popup**: 仍使用 V2 message 通道
   - `popup/App.vue:409`, `popup/App.vue:482`

#### 工具层 V2 依赖（需迁移）

1. **Tools**: `FLOW_RUN/LIST_PUBLISHED` 走 V2
   - `tools/record-replay.ts:3`
2. **Native Host**: `rr_list_published_flows` 走 V2
   - `native-host.ts:381`

#### 存储层现状

- **双库并存**: V2 `rr_storage` 与 V3 `rr_v3`
- **无自动迁移**: 需要实现一次性迁移逻辑

### 5.2 断开 V3 对 record-replay(V2) 的源码依赖 ⏳

**目标**: 让 V3 不再 `import .../record-replay/...`

**方案**: 将 V2 ActionHandlers 抽成版本中立的 `replay-actions` 模块

**文件变更**:

- 新建: `entrypoints/background/replay-actions/` (版本中立模块)
  - 迁移: handlers, types, registry 等
- 修改: `record-replay-v3/engine/plugins/register-v2-replay-nodes.ts`
  - 改为导入 `replay-actions` 而非 `record-replay`
- 修改: `record-replay-v3/domain/control.ts`
  - 复制 `Condition` 类型到 V3 domain（解除类型依赖）

### 5.3 迁移 Builder UI 残留 V2 调用 ✅ (已完成)

**已完成**:

- `PropertyPanel.vue`: `RR_LIST_FLOWS` → `rr_v3.listFlows` ✅
- `PropertyExecuteFlow.vue`: `RR_LIST_FLOWS` → `rr_v3.listFlows` ✅

**变更**:

- 使用 `useRRV3Rpc` composable 替代 `chrome.runtime.sendMessage`
- 移除 `BACKGROUND_MESSAGE_TYPES` 导入
- **注意**: `rr_v3.listFlows` 返回数组 `FlowLite[]`，使用 `Array.isArray()` 校验

### 5.4 迁移 Popup V2 消息通道 ✅ (已完成)

**已完成**:

- `popup/App.vue`:
  - 添加 `useRRV3Rpc` composable
  - `loadFlows()` → `rr_v3.listFlows`
  - `runFlow()` → `rr_v3.enqueueRun`

### 5.5 迁移 Tools/NativeHost V2 调用 ✅ (已完成)

**已完成**:

- `tools/record-replay.ts`:
  - `FlowRunTool` → 使用 `bootstrapV3().scheduler.enqueue()`
  - `ListPublishedTool` → 使用 `bootstrapV3().storage.flows.list()`
- `native-host.ts`:
  - `rr_list_published_flows` → 使用 `bootstrapV3().storage.flows.list()`

### 5.6 实现 V2→V3 数据迁移 ✅ (已完成 - 2025-12-30)

**实现内容**:

#### 5.6.1 v2-reader.ts - V2 数据读取器

- 使用 V2 store 函数 (`listFlows`, `listTriggers`, `listSchedules`, `listPublished`)
- 确保 local->IDB 迁移和 flow 规范化已执行

#### 5.6.2 v2-to-v3.ts - 转换逻辑更新

- `convertTriggerV2ToV3()` - 支持真实 V2 FlowTrigger 类型 (url, command, contextMenu, dom)
- `convertScheduleV2ToV3()` - 新增 Schedule → Trigger 转换
  - interval → interval trigger
  - once → once trigger (过期则 disabled)
  - daily → cron trigger

#### 5.6.3 v2-migration.ts - 迁移主逻辑

- `ensureMigratedV2ToV3()` - 主迁移函数
- **幂等性**: 使用 `rr_v3_migration_v2_to_v3` 状态标记
- **并发安全**: Promise 合并多次调用
- **非致命错误**: 单条记录失败不影响整体
- **不覆盖**: 默认保留已存在的 V3 记录
- **slug 回填**: 为已存在的 V3 flow 补充 published slug
- **缓存优化**: flowExistsCache 减少重复查询

#### 5.6.4 FlowV3.meta 扩展

- 新增 `tool?: { slug?, category?, description? }` 字段
- native-host 输出优先使用 `meta.tool.slug`

#### 5.6.5 bootstrap.ts 集成

- storage 创建后、triggers.start() 前执行迁移
- 迁移失败不阻塞 V3 启动

**文件变更**:

- `storage/import/v2-reader.ts` (重写)
- `storage/import/v2-to-v3.ts` (新增 schedule 转换)
- `storage/import/v2-migration.ts` (新文件)
- `storage/import/index.ts` (导出)
- `domain/flow.ts` (扩展 meta.tool)
- `bootstrap.ts` (调用迁移)
- `native-host.ts` (slug 读取)

### 5.7 下线 V2 Runtime ✅ (已完成 - 2025-12-30)

**实施方案**:
由于 V2 模块之间存在大量内部依赖（actions → engine/constants, engine/policies/wait 等），
完全删除 V2 代码需要大量重构。采用最小化方案：

**已完成**:

- ✅ 从 `entrypoints/background/index.ts` 移除 `initRecordReplayListeners()` 调用
- ✅ 移除 `ENABLE_RR_V3` feature flag（V3 现在是唯一运行的系统）

**保留内容（作为共享模块）**:

- `record-replay/types.ts` - Builder UI 类型定义
- `record-replay/actions/` - V3 通过 adapter 复用的 ActionHandlers
- `record-replay/flow-store.ts`, `trigger-store.ts` - V3 迁移读取
- `record-replay/engine/` - ActionHandlers 依赖的工具函数

**结果**:

- V2 runtime 不再执行（从入口移除）
- V3 是唯一运行的 Record-Replay 系统
- V2 代码文件作为共享模块保留，供 V3 和 Builder UI 使用
- 668 个测试全部通过

**保留内容（长期）**:

- `storage/import/v2-to-v3.ts` - 导入兼容层（支持导入旧版 JSON）

---

## 已知遗留问题

### 低优先级 - inline=false vars.patch 事件不一致

**问题描述**:

- `executeFlow` 在 `inline=false` 模式下恢复 vars 时没有对应的 `vars.patch` 事件
- DebugController 的变量重建可能与实际运行时不一致

**影响范围**: 仅影响调试器的变量显示，不影响实际执行

**建议方案**:

- 方案 A: 在 finally 里发 "回滚到 savedVars" 的 `vars.patch`
- 方案 B: 引入作用域事件，重建逻辑忽略 isolated scope 内的 patch

**状态**: 待后续迭代处理

---

## 实施优先级与依赖关系

```
Milestone 1: Builder 核心链路 V3 化 ✅
    ├── 1.1 共享 RPC 层 ✅
    ├── 1.2 startNodeId 端到端 ✅
    └── 1.3 Builder RPC 迁移 ✅
           │
           ▼
Milestone 2: Builder 数据层 V3 化 (部分完成)
    ├── 2.1 类型迁移 ⏸️
    ├── 2.2 entryNodeId 计算 ✅
    └── 2.3 Sidebar bug 修复 ✅
           │
           ├─────────────────────────────┐
           ▼                             ▼
Milestone 3: 触发器扩展 ✅       Milestone 4.1: 简单节点 ✅
    ├── 3.1 interval/once kind ✅    ├── triggerEvent ✅
    └── 3.2 Trigger 独立面板 ✅      └── setAttribute ✅
                                            │
                                            ▼
                                   Milestone 4.2: Control Flow 基础 ✅
                                      └── subflows + control directives ✅
                                            │
                                            ▼
                                   Milestone 4.3: 循环节点 ✅
                                      ├── foreach ✅
                                      ├── while ✅
                                      └── loopElements ✅
                                            │
                                            ▼
                                   Milestone 4.4: executeFlow ✅
                                            │
                                            ▼
                                   Milestone 5: 清理 V2 代码 ⏳
```

## 风险与缓解

| 风险                                | 缓解措施                                    | 状态      |
| ----------------------------------- | ------------------------------------------- | --------- |
| entryNodeId 计算错误导致保存失败    | 复用已测试的 v2-to-v3.ts 规则，增加 UI 提示 | ✅ 已解决 |
| startNodeId 不存在导致运行失败      | 在 enqueue-run.ts 校验存在性                | ✅ 已解决 |
| control flow 复杂导致 runner 不稳定 | 渐进式实现，每步都有测试覆盖                | ✅ 已解决 |
| executeFlow 递归死锁                | 维护调用栈检测环，不走 enqueueRun           | ✅ 已解决 |
| Trigger 批量保存造成抖动            | 节流/批处理策略                             | ✅ 已解决 |
| V2 代码清理导致功能回退             | 充分测试，渐进式移除                        | ⏳ 待处理 |

## 测试策略

- 每个 Milestone 完成后运行全量测试 ✅
- 新增功能必须有对应的契约测试 ✅
- 节点扩展需要覆盖正常/异常/边界用例 ✅
- 当前测试总数: **668 个测试** ✅

---

_最后更新: 2025-12-30 17:45_
