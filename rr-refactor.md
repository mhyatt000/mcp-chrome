# 录制回放功能重构计划

## 目标

完全重写录制回放功能，打造超越商业级应用体验的产品。定位为全功能平台：端到端测试 + 浏览器自动化 + 用户操作录制。

## 决策

- **兼容性**: 不需要兼容现有数据，可以完全重写
- **产品定位**: 全功能商业级产品
- **iframe 支持**: 中优先级，基础支持后续迭代

---

## 实施进度

### 已完成

#### Phase 1.1: Action 系统 ✅

- [x] `actions/types.ts` - 完整的 Action 类型定义（28 种 Action 类型）
- [x] `actions/registry.ts` - Action 执行器注册表（支持中间件/钩子）
- [x] `actions/index.ts` - 模块导出

#### Phase 1.2: 选择器引擎 - 基础框架 ✅

- [x] `shared/selector/types.ts` - 选择器类型定义
- [x] `shared/selector/stability.ts` - 稳定性评分计算
- [x] `shared/selector/strategies/` - 5 种基础选择器策略
- [x] `shared/selector/generator.ts` - 统一选择器生成
- [x] `shared/selector/locator.ts` - 统一元素定位

#### Phase 1.2: 选择器引擎 - 补齐商业级功能 ✅

对比 `web-editor-v2/locator.ts`，已补齐以下功能：

| 功能                    | 状态    | 说明                                                                              |
| ----------------------- | ------- | --------------------------------------------------------------------------------- |
| **指纹(Fingerprint)**   | ✅ 完成 | `fingerprint.ts` - 生成、解析、验证、相似度计算                                   |
| **DOM Path**            | ✅ 完成 | `dom-path.ts` - 路径计算、定位、比较                                              |
| **锚点+相对路径策略**   | ✅ 完成 | `strategies/anchor-relpath.ts` - anchor + nth-of-type 路径                        |
| **Shadow DOM 完整支持** | ✅ 完成 | `shadow-dom.ts` - 链遍历和查询；`generator.ts` - 链生成                           |
| **name/title/alt 属性** | ✅ 完成 | `testid.ts` + `generator.ts` - 带标签前缀规则                                     |
| **类型扩展**            | ✅ 完成 | `types.ts` - `ExtendedSelectorTarget`、`fingerprint/domPath/shadowHostChain` 字段 |

**Phase 2 待完成**（需要消息协议/注入脚本修改）：

- [ ] 更新 `locator.ts` - 添加指纹验证逻辑（需要 DOM 侧协议支持）
- [ ] 抽取共用工具到 `shared/selector-core/` 供 web-editor-v2 复用（可选优化）

> **注意**: aria-label 属性已由 `ariaStrategy` 处理，不重复加入 testid 策略

### 待开始

#### Phase 1.3: 数据模型统一

- [ ] 更新 Flow 类型定义
- [ ] 移除旧的 Step 类型引用

#### Phase 2-7: 后续阶段

- Phase 2: 录制系统重写
- Phase 3: 回放引擎重写
- Phase 4: Builder 重构
- Phase 5-7: 高级功能、iframe、测试

---

## 一、现状分析

### 1.1 架构现状

```
录制: recorder.js -> content-message-handler -> session-manager -> flow-store (steps格式)
回放: scheduler -> step-runner -> nodes/* (需要 nodes/edges 格式)
```

### 1.2 高严重度 Bug

| Bug                    | 位置                                                | 描述                                   |
| ---------------------- | --------------------------------------------------- | -------------------------------------- |
| 数据格式不兼容         | `flow-builder.ts` / `scheduler.ts`                  | 录制产生 steps，回放需要 nodes/edges   |
| 变量丢失               | `recorder.js:609` / `content-message-handler.ts:18` | 变量只存本地，不传给 background        |
| 步骤丢失               | `recorder.js:584-594`                               | pause/stop/导航时未 flush 缓冲区       |
| fill 值不完整          | `recorder.js:13-14`                                 | debounce 800ms vs flush 100ms 时序冲突 |
| trigger 无 handler     | `nodes/index.ts:58`                                 | UI 可用但运行时无执行器                |
| 选择器桥死锁           | `accessibility-tree-helper.js:1051`                 | iframe 通信无超时                      |
| Builder 保存丢失子流程 | `useBuilderStore.ts:392`                            | 编辑子流程时保存不会 flush             |

### 1.3 中严重度 Bug

| Bug                       | 位置                                     | 描述                          |
| ------------------------- | ---------------------------------------- | ----------------------------- |
| pause/resume 状态不同步   | `recorder.js:476` / `session-manager.ts` | content 暂停，background 继续 |
| 双击产生多余点击          | `recorder.js:650`                        | click + dblclick 序列问题     |
| contenteditable 不录制    | `recorder.js:663-684`                    | focusin 支持但 input 不支持   |
| 跨 frame 消息无验证       | `recorder.js:577,1026`                   | postMessage('\*') 可被伪造    |
| saveFlow 异步无 await     | `recorder-manager.ts:45`                 | 异常不会被捕获                |
| waitForNetworkIdle 失效   | `step-runner.ts:88`                      | 始终调用 waitForNavigation    |
| wait helper 不支持 iframe | `wait.ts:23,36,57`                       | 只注入顶层 frame              |
| 模板替换不一致            | `wait.ts:12`, `assert.ts:19` 等          | 传 {} 而非 ctx.vars           |
| key 不聚焦目标            | `key.ts:10`                              | 忽略 target 字段              |
| script 忽略 frameId       | `script.ts:15`                           | 总在顶层执行                  |
| 运行统计错误              | `scheduler.ts:327,485`                   | 只统计默认边，不含分支        |
| 子流程忽略分支边          | `subflow-runner.ts:40`                   | defaultEdgesOnly              |

### 1.4 代码质量问题

- 大量 `any` 类型和类型断言
- 错误处理不完善（catch {} 吞掉错误）
- 状态分散在 content/background，无单一事实来源
- 选择器生成逻辑重复（recorder.js, accessibility-tree-helper.js, wait-helper.js）
- useBuilderStore 职责过多（状态、历史、布局、IO、子流程、变量分析）

### 1.5 架构问题

- 消息通信使用魔法字符串
- 无单元测试覆盖
- 强耦合 chrome.\* API，难以测试
- 内存泄漏风险：`__claudeElementMap` 只增不减

---

## 二、新架构设计

### 2.1 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Flow Management Layer                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ FlowStore   │  │ FlowRunner  │  │ FlowEditor  │              │
│  │ (IndexedDB) │  │ (Scheduler) │  │ (Builder)   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Core Engine Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Recorder    │  │ Executor    │  │ Selector    │              │
│  │ Coordinator │  │ Engine      │  │ Engine      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Action Layer                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Action Registry (命令模式 - 所有可执行操作)               │    │
│  │ click | fill | navigate | scroll | wait | assert | ...  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Content Scripts Layer                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Event       │  │ Action      │  │ Page        │              │
│  │ Capture     │  │ Executor    │  │ Inspector   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据结构

```typescript
// 统一的 Action 定义
interface Action {
  id: string;
  type: ActionType;
  config: Record<string, unknown>;
  target?: TargetLocator;
  // 执行选项
  timeout?: number;
  retry?: RetryConfig;
  onError?: ErrorHandling;
}

// Flow 始终使用 DAG 格式
interface Flow {
  id: string;
  name: string;
  version: number;
  // 主体结构
  nodes: FlowNode[];
  edges: FlowEdge[];
  // 变量系统
  variables: Variable[];
  // 子流程
  subflows?: Record<string, Subflow>;
  // 元数据
  meta: FlowMeta;
}

// 选择器候选列表
interface TargetLocator {
  candidates: SelectorCandidate[];
  frameSelector?: string; // iframe 选择器
  recordedAttributes?: Record<string, string>; // 录制时的元素属性快照
}

interface SelectorCandidate {
  type: 'testid' | 'aria' | 'css' | 'xpath' | 'text';
  value: string;
  confidence: number; // 0-100 稳定性评分
}
```

### 2.3 模块职责

| 模块                | 职责                               | 关键文件                          |
| ------------------- | ---------------------------------- | --------------------------------- |
| RecorderCoordinator | 录制生命周期管理、状态机、DAG 构建 | `recording/coordinator.ts`        |
| EventCapture        | 页面事件捕获、事件合并             | `inject-scripts/event-capture.ts` |
| ActionComposer      | 事件到 Action 转换、fill 合并      | `recording/action-composer.ts`    |
| ExecutorEngine      | 回放调度、DAG 遍历、错误处理       | `engine/executor.ts`              |
| ActionRegistry      | Action 执行器注册表                | `actions/registry.ts`             |
| SelectorEngine      | 统一选择器生成和定位               | `selector/engine.ts`              |
| FlowStore           | 持久化、版本管理                   | `storage/flow-store.ts`           |

---

## 三、重构任务拆解

### Phase 1: 基础架构 (P0)

#### 1.1 Action 系统重构

```
目录: app/chrome-extension/entrypoints/background/record-replay/actions/
```

- [ ] 创建 `types.ts` - Action 类型定义和接口
- [ ] 创建 `registry.ts` - Action 执行器注册表（命令模式）
- [ ] 迁移现有 nodes/_ 到 actions/_，统一接口
- [ ] 添加缺失的 Action: `trigger`, `delay`, `group`, `comment`
- [ ] 每个 Action 实现 `validate()`, `execute()`, `describe()` 方法

#### 1.2 选择器引擎统一

```
目录: app/chrome-extension/shared/selector/
```

- [ ] 创建 `strategies/` - 各种选择器策略
  - `testid.ts` - data-testid, data-cy 等
  - `aria.ts` - aria-label, role
  - `css-unique.ts` - 唯一 class 组合
  - `css-path.ts` - nth-of-type 路径
  - `text.ts` - 文本内容匹配
- [ ] 创建 `generator.ts` - 统一选择器生成
- [ ] 创建 `locator.ts` - 统一元素定位
- [ ] 删除重复代码: recorder.js, accessibility-tree-helper.js, wait-helper.js

#### 1.3 数据模型统一

```
文件: app/chrome-extension/entrypoints/background/record-replay/types.ts
```

- [ ] 定义 `Action`, `Flow`, `FlowNode`, `FlowEdge` 类型
- [ ] 定义 `Variable`, `TargetLocator`, `SelectorCandidate` 类型
- [ ] 移除过时的 `Step` 类型引用
- [ ] 更新 `packages/shared/src/step-types.ts` 同步

### Phase 2: 录制系统重写 (P0)

#### 2.1 RecorderCoordinator

```
文件: app/chrome-extension/entrypoints/background/record-replay/recording/coordinator.ts
```

- [ ] 实现状态机: `idle` -> `recording` -> `paused` -> `stopping` -> `idle`
- [ ] 实现 DAGFlowBuilder - 录制时直接构建 DAG
- [ ] 实现变量收集器 - 敏感值自动变量化
- [ ] 实现 Tab 管理 - 跨标签页录制支持

#### 2.2 EventCapture 重写

```
文件: app/chrome-extension/inject-scripts/event-capture.ts
```

- [ ] 重写事件监听（使用 TypeScript）
- [ ] 实现事件缓冲区，可靠的 flush 机制
- [ ] 修复 debounce/flush 时序问题（统一为 600ms）
- [ ] 实现 contenteditable 支持
- [ ] 实现安全的跨 frame 通信（验证 origin）

#### 2.3 ActionComposer

```
文件: app/chrome-extension/entrypoints/background/record-replay/recording/action-composer.ts
```

- [ ] 实现 fill 合并逻辑（同元素连续输入合并）
- [ ] 实现 scroll 合并逻辑（同方向滚动合并）
- [ ] 实现 click/dblclick 区分逻辑
- [ ] 添加 Action 描述生成（用于 UI 显示）

#### 2.4 录制 UI 改进

```
文件: app/chrome-extension/inject-scripts/recorder-ui.ts
```

- [ ] 重写录制浮层（TypeScript）
- [ ] 添加实时步骤预览
- [ ] 添加快捷键支持（暂停/继续/停止）
- [ ] 添加元素高亮改进（显示选择器信息）

### Phase 3: 回放引擎重写 (P0)

#### 3.1 ExecutorEngine

```
文件: app/chrome-extension/entrypoints/background/record-replay/engine/executor.ts
```

- [ ] 重写 DAG 遍历逻辑，支持分支和循环
- [ ] 实现执行上下文管理（变量、帧、Tab）
- [ ] 实现执行暂停/继续/单步调试
- [ ] 实现执行状态广播（实时进度）

#### 3.2 错误处理增强

```
文件: app/chrome-extension/entrypoints/background/record-replay/engine/error-handler.ts
```

- [ ] 实现失败截图捕获
- [ ] 实现控制台日志收集
- [ ] 实现智能重试（元素不可见则等待、超时则延长）
- [ ] 实现错误恢复策略配置

#### 3.3 等待策略完善

```
文件: app/chrome-extension/entrypoints/background/record-replay/engine/wait-policy.ts
```

- [ ] 实现 `waitForSelector` 支持 iframe
- [ ] 实现 `waitForNetworkIdle` 真正的网络空闲检测
- [ ] 实现 `waitForNavigation` 可靠的导航等待
- [ ] 添加超时配置和错误信息

### Phase 4: Builder 重构 (P1)

#### 4.1 Store 拆分

```
目录: app/chrome-extension/entrypoints/popup/components/builder/store/
```

- [ ] 拆分 `useBuilderStore.ts`:
  - `useFlowStore.ts` - Flow 数据管理
  - `useEditorStore.ts` - 编辑器状态
  - `useHistoryStore.ts` - 撤销/重做
  - `useLayoutStore.ts` - 画布布局
- [ ] 修复子流程保存问题（保存前 flush 当前子流程）

#### 4.2 选择器编辑器增强

```
文件: app/chrome-extension/entrypoints/popup/components/builder/widgets/SelectorEditor.vue
```

- [ ] 显示所有候选选择器，不仅是 CSS
- [ ] 添加选择器稳定性评分显示
- [ ] 添加实时元素验证
- [ ] 支持 iframe 选择器编辑

#### 4.3 属性面板优化

```
目录: app/chrome-extension/entrypoints/popup/components/builder/components/properties/
```

- [ ] 统一属性面板组件接口
- [ ] 添加配置验证和错误提示
- [ ] 添加高级选项折叠

### Phase 5: 高级功能 (P2)

#### 5.1 变量系统

- [ ] 实现变量定义 UI
- [ ] 实现运行时变量输入
- [ ] 实现敏感变量加密存储
- [ ] 实现变量从页面提取

#### 5.2 断言系统

- [ ] 增强断言类型（存在、可见、文本、属性、样式）
- [ ] 实现断言失败详情
- [ ] 实现软断言（失败继续执行）

#### 5.3 数据提取

- [ ] 实现 CSS 选择器提取
- [ ] 实现表格数据提取
- [ ] 实现列表数据提取
- [ ] 实现数据导出（JSON/CSV）

#### 5.4 触发器系统

- [ ] 完善 URL 触发器
- [ ] 完善定时触发器
- [ ] 完善右键菜单触发器
- [ ] 添加快捷键触发器

### Phase 6: iframe 支持 (P2)

#### 6.1 iframe 录制

- [ ] 检测 iframe 并注入录制脚本
- [ ] 实现跨 frame 事件上报
- [ ] 实现复合选择器生成（frame|>element）

#### 6.2 iframe 回放

- [ ] 实现 frame 定位和切换
- [ ] 修复 wait-helper frame 支持
- [ ] 实现复合选择器解析和执行

### Phase 7: 测试和文档 (P2)

#### 7.1 单元测试

```
目录: app/chrome-extension/tests/record-replay/
```

- [ ] 创建测试设置和 Chrome API mock
- [ ] 测试 ActionComposer（fill 合并、事件转换）
- [ ] 测试 SelectorEngine（选择器生成、定位）
- [ ] 测试 ExecutorEngine（DAG 遍历、错误处理）
- [ ] 测试 RecorderCoordinator（状态机、变量收集）

#### 7.2 集成测试

- [ ] 端到端录制回放测试
- [ ] 多标签页测试
- [ ] iframe 场景测试

---

## 四、关键文件清单

### 需要删除/重写的文件

- `inject-scripts/recorder.js` → 重写为 TypeScript
- `recording/session-manager.ts` → 合并到 coordinator.ts
- `recording/flow-builder.ts` → 重写，支持 DAG
- `engine/scheduler.ts` → 重写为 executor.ts

### 需要创建的文件

```
app/chrome-extension/
├── shared/
│   └── selector/
│       ├── strategies/
│       │   ├── testid.ts
│       │   ├── aria.ts
│       │   ├── css-unique.ts
│       │   ├── css-path.ts
│       │   └── text.ts
│       ├── generator.ts
│       └── locator.ts
├── inject-scripts/
│   ├── event-capture.ts
│   └── recorder-ui.ts
└── entrypoints/background/record-replay/
    ├── actions/
    │   ├── types.ts
    │   ├── registry.ts
    │   ├── click.ts
    │   ├── fill.ts
    │   ├── navigate.ts
    │   ├── trigger.ts
    │   ├── delay.ts
    │   └── ...
    ├── recording/
    │   ├── coordinator.ts
    │   └── action-composer.ts
    ├── engine/
    │   ├── executor.ts
    │   ├── error-handler.ts
    │   └── wait-policy.ts
    └── types.ts (统一类型定义)
```

### 需要修改的文件

- `entrypoints/popup/components/builder/store/useBuilderStore.ts` - 拆分
- `entrypoints/popup/components/builder/widgets/SelectorEditor.vue` - 增强
- `common/message-types.ts` - 添加新消息类型
- `entrypoints/background/record-replay/nodes/index.ts` - 迁移到 actions/

---

## 五、验收标准

### 功能验收

- [ ] 录制后立即可回放，无需手动转换
- [ ] 敏感输入自动变量化
- [ ] 回放失败时显示截图和详细错误
- [ ] 支持暂停/继续/单步调试
- [ ] 所有 Action 类型都有执行器

### 质量验收

- [ ] 无 any 类型（除第三方库接口）
- [ ] 所有错误有明确处理和用户反馈
- [ ] 核心模块单测覆盖率 > 80%
- [ ] 通过 TypeScript 严格模式检查

### 体验验收

- [ ] 录制启动 < 500ms
- [ ] 回放单步 < 100ms（不含等待）
- [ ] 选择器定位成功率 > 95%

---

## 六、参考资源

### Automa 值得借鉴的设计

- **命令模式**: 每个 Block 独立封装，易于测试和扩展
- **策略模式**: 动态加载 handler
- **状态机模式**: WorkflowState 管理执行状态
- **错误处理**: Block 级 + 工作流级 + 重试机制
- **Block 类型定义**: 50+ 种类型，分类清晰

### 关键 Automa 文件参考

- `other/automa/src/workflowEngine/WorkflowEngine.js` - 工作流引擎
- `other/automa/src/workflowEngine/WorkflowWorker.js` - Block 执行器
- `other/automa/src/content/services/recordWorkflow/recordEvents.js` - 录制事件
- `other/automa/src/utils/shared.js` - Block 类型定义
