# Record-Replay V3 重构任务清单

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
  - ✅ 1.1 共享 RPC 层
  - ✅ 1.2 startNodeId 端到端补完
  - ✅ 1.3 Builder RPC 迁移
- **Milestone 2 (Builder 数据层 V3 化)**: 部分完成 🔄
  - ⏸️ 2.1 类型迁移 - 评估后延后（当前转换层工作良好）
  - ✅ 2.2 entryNodeId 计算优化
  - ✅ 2.3 Sidebar Flow 分类 bug 修复
- **Milestone 3 (触发器扩展)**: 全部完成 ✅
  - ✅ 3.1 interval/once TriggerKind
  - ✅ 3.2 Trigger 独立面板
- **Milestone 4 (节点扩展)**: 进行中 🔄
  - ✅ 4.1 triggerEvent/setAttribute ActionHandler
  - ⏳ 4.2 V3 Control Flow 基础设施
  - ⏳ 4.3 foreach/while/loopElements 节点
  - ⏳ 4.4 executeFlow 节点
- **Milestone 5 (清理 V2 代码)**: 待开始
- **测试状态**: 641 个测试全部通过
- **下一步**: Milestone 4.2 (Control Flow 基础设施)

---

## 已完成任务详情

### Milestone 1: Builder 核心链路 V3 化 ✅

#### 1.1 共享 RPC 层 ✅

- 新建: `entrypoints/shared/composables/useRRV3Rpc.ts`
- 新建: `entrypoints/shared/composables/index.ts`
- 修改: `entrypoints/sidepanel/composables/useRRV3Rpc.ts` → re-export

#### 1.2 startNodeId 端到端补完 ✅

- `EnqueueRunInput` 新增 `startNodeId?: NodeId`
- 在 `enqueue-run.ts` 添加 startNodeId 校验和持久化
- 在 `rpc-server.ts` 传递 `params.startNodeId`
- 新增 2 个测试用例

#### 1.3 Builder RPC 迁移 ✅

- 新建: `entrypoints/shared/utils/rr-flow-convert.ts` (V2/V3 双向转换)
- 修改 `App.vue`: bootstrap/save/run/sync/export/import 全面 V3 化

### Milestone 2: Builder 数据层 V3 化

#### 2.1 类型迁移 ⏸️ (延后)

当前 V2/V3 转换层工作良好，暂不迁移。

#### 2.2 entryNodeId 计算优化 ✅

- 重构 `findEntryNodeId` 函数（忽略 trigger 指出的边）
- 新增 `selectStableRootNode` 函数（稳定的多根节点选择）
- 17 个测试用例

#### 2.3 Sidebar Flow 分类 bug 修复 ✅

- Sidebar.vue 增加 `Flow` 分类
- trigger/executeFlow 节点移到 Flow 分类

### Milestone 3: 触发器系统扩展 ✅

#### 3.1 interval/once TriggerKind ✅

- `TriggerKind` 新增 `'interval' | 'once'`
- 新建 `interval-trigger.ts` (chrome.alarms.periodInMinutes)
- 新建 `once-trigger.ts` (chrome.alarms.when + 自动禁用)
- 23 个测试用例

#### 3.2 Trigger 独立面板 ✅

- 新建 `TriggerPanel.vue` (浮动面板)
- 支持 interval/once CRUD (panel-managed)
- node-managed 触发器只读展示 + 禁用 toggle
- ownership 模型区分触发器来源

### Milestone 4: 节点扩展

#### 4.1 triggerEvent / setAttribute ✅

**实现为 V2 ActionHandler（自动被 V3 复用）**

新建文件:

- `entrypoints/background/record-replay/actions/handlers/dom.ts`
  - `triggerEventHandler`: 在元素上触发自定义 DOM 事件
  - `setAttributeHandler`: 设置/删除元素属性

修改文件:

- `entrypoints/background/record-replay/actions/handlers/index.ts`
  - 导入并注册 handler
  - 更新 `ALL_HANDLERS` 和 `registerReplayHandlers`

设计决策:

- 实现为 V2 ActionHandler，V3 通过 `registerV2ReplayNodesAsV3Nodes` 自动复用
- 使用 `resolveTargetSelector` 共享目标解析逻辑
- 脚本执行错误区分 `TARGET_NOT_FOUND` vs `SCRIPT_FAILED`

---

## 待完成任务

### Milestone 4.2: V3 Control Flow 基础设施 ⏳

**目标**: 扩展 V3 runner 支持 control directives 和 subflows

**设计决策（已确定）**:

1. subflows 存储在 FlowV3 顶层 `subflows?: Record<SubflowId, SubflowV3>`
2. subflow 在同一个 Runner 内递归执行（不创建新 RunRunner）
3. 变量作用域：foreach 共享 vars，每次迭代设置 itemVar
4. 不支持并发执行（concurrency > 1 报错）
5. 事件流：subflow 内节点照常发 node.started/node.succeeded

**文件变更**:

- `domain/flow.ts`: 添加 `SubflowV3` 类型，FlowV3 添加 `subflows` 字段
- `engine/plugins/types.ts`: `NodeExecutionResult` 添加 `control` 字段
- `engine/kernel/runner.ts`: 抽象 `runGraph()` 方法，实现 control directive 处理
- `engine/plugins/v2-action-adapter.ts`: 移除 control 排除逻辑，改为返回 control
- `engine/transport/rpc-server.ts`: `normalizeFlowSpec` 支持 subflows
- `storage/flows.ts`: 存储校验支持 subflows

### Milestone 4.3: foreach/while/loopElements 节点 ⏳

**依赖**: 4.2 Control Flow 基础设施

**文件变更**:

- 新建: `engine/plugins/nodes/foreach.ts`
- 新建: `engine/plugins/nodes/while.ts`
- 新建: `engine/plugins/nodes/loop-elements.ts`
- 复用表达式求值器: `record-replay/engine/utils/expression.ts`

### Milestone 4.4: executeFlow 节点 ⏳

**关键设计**:

- 不走 enqueueRun（避免死锁）
- 作为 control directive 由 runner 直接子执行
- `inline=true`: 共享 vars
- `inline=false`: clone vars
- 递归防护: 维护 flowId 调用栈检测环

**文件变更**:

- 新建: `engine/plugins/nodes/execute-flow.ts`

### Milestone 5: 清理 V2 代码 ⏳

#### 5.1 删除 V2 兼容代码

- `storage/import/v2-to-v3.ts`
- `storage/import/v2-reader.ts`

#### 5.2 删除 V2 消息通道

- `builder/App.vue` 移除 `BACKGROUND_MESSAGE_TYPES.RR_*`
- 逐步移除 `entrypoints/background/record-replay/` 相关代码

---

## 实施优先级与依赖关系

```
Milestone 1: Builder 核心链路 V3 化 ✅
    ├── 1.1 共享 RPC 层 ✅
    ├── 1.2 startNodeId 端到端 ✅
    └── 1.3 Builder RPC 迁移 ✅
           │
           ▼
Milestone 2: Builder 数据层 V3 化
    ├── 2.1 类型迁移 ⏸️
    ├── 2.2 entryNodeId 计算 ✅
    └── 2.3 Sidebar bug 修复 ✅
           │
           ├─────────────────────────────┐
           ▼                             ▼
Milestone 3: 触发器扩展 ✅         Milestone 4.1: 简单节点 ✅
    ├── 3.1 interval/once ✅            ├── triggerEvent ✅
    └── 3.2 Trigger 面板 ✅             └── setAttribute ✅
                                            │
                                            ▼
                                   Milestone 4.2: Control Flow 基础 ⏳
                                      └── subflows + control directives
                                            │
                                            ▼
                                   Milestone 4.3: 循环节点 ⏳
                                      ├── foreach
                                      ├── while
                                      └── loopElements
                                            │
                                            ▼
                                   Milestone 4.4: executeFlow ⏳
                                            │
                                            ▼
                                   Milestone 5: 清理 V2 代码 ⏳
```

## 风险与缓解

| 风险                                | 缓解措施                                    |
| ----------------------------------- | ------------------------------------------- |
| entryNodeId 计算错误导致保存失败    | 复用已测试的 v2-to-v3.ts 规则，增加 UI 提示 |
| startNodeId 不存在导致运行失败      | 在 enqueue-run.ts 校验存在性                |
| control flow 复杂导致 runner 不稳定 | 渐进式实现，每步都有测试覆盖                |
| executeFlow 递归死锁                | 维护调用栈检测环，不走 enqueueRun           |
| Trigger 批量保存造成抖动            | 节流/批处理策略                             |

## 测试策略

- 每个 Milestone 完成后运行全量测试
- 新增功能必须有对应的契约测试
- 节点扩展需要覆盖正常/异常/边界用例

---

_最后更新: 2025-12-29_
