# 模块 B — 录制与回放 技术设计（design.md）

版本：v1.0（与 record_replay.prd.md 配套）  
目标读者：前端架构、扩展工程、MCP 工具维护者

## 1. 架构概览

- 现有能力复用：
  - DOM 读取：`chrome_read_page`（可得 `ref`、可见元素、可推导候选选择器）。
  - 交互执行：`chrome_computer`（CDP 鼠标/键盘/滚动/等待/截图等），`chrome_click_element`，`chrome_fill_or_select`，`chrome_keyboard`。
  - 注入执行：`chrome_inject_script`（MAIN/ISOLATED）、`chrome_send_command_to_inject_script`。
  - 抓包：`chrome_network_capture_start/stop`、`chrome_network_debugger_start/stop`。
  - 截图与坐标映射：`screenshot.ts` + `screenshot-context`（已包含域名校验）。
- 新增模块（建议路径）：
  - `app/chrome-extension/inject-scripts/recorder.js`（内容脚本，事件捕获与序列化）。
  - `app/chrome-extension/entrypoints/background/record-replay/flow-store.ts`（存储抽象）。
  - `app/chrome-extension/entrypoints/background/record-replay/flow-runner.ts`（回放编排器）。
  - `app/chrome-extension/entrypoints/background/record-replay/selector-engine.ts`（多策略定位与回退）。
  - `app/chrome-extension/entrypoints/background/record-replay/types.ts`（类型定义）。
  - UI：Popup 下新增“录制/回放/列表”视图与“流编辑器”（Vue 组件），路径沿用 `app/chrome-extension/entrypoints/popup/*`。

说明：先以“扩展本地工作”落地，导入导出通过 JSON；如需长期持久化到文件系统，可在原生宿主（native-server）侧新增文件读写 API（与 `file-handler.ts` 模式一致）。

## 2. 数据模型（TS 接口）

```ts
// design note: comments in English
export type SelectorType = 'css' | 'xpath' | 'attr' | 'aria' | 'text';

export interface SelectorCandidate {
  type: SelectorType;
  value: string; // literal selector or text/aria expression
  weight?: number; // user-adjustable priority; higher first
}

export interface TargetLocator {
  ref?: string; // ephemeral ref from read_page
  candidates: SelectorCandidate[]; // ordered by priority
}

export type StepType =
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'key'
  | 'scroll'
  | 'drag'
  | 'wait'
  | 'assert'
  | 'script'
  | 'navigate';

export interface StepBase {
  id: string;
  type: StepType;
  timeoutMs?: number; // default 10000
  retry?: { count: number; intervalMs: number; backoff?: 'none' | 'exp' };
  screenshotOnFail?: boolean; // default true
}

export interface StepClick extends StepBase {
  type: 'click' | 'dblclick';
  target: TargetLocator;
  before?: { scrollIntoView?: boolean; waitForSelector?: boolean };
  after?: { waitForNavigation?: boolean; waitForNetworkIdle?: boolean };
}

export interface StepFill extends StepBase {
  type: 'fill';
  target: TargetLocator;
  value: string; // may contain {var}
}

export interface StepKey extends StepBase {
  type: 'key';
  keys: string; // e.g. "Backspace Enter" or "cmd+a"
  target?: TargetLocator; // optional focus target
}

export interface StepScroll extends StepBase {
  type: 'scroll';
  mode: 'element' | 'offset' | 'container';
  target?: TargetLocator; // when mode = element / container
  offset?: { x?: number; y?: number };
}

export interface StepDrag extends StepBase {
  type: 'drag';
  start: TargetLocator;
  end: TargetLocator;
  path?: Array<{ x: number; y: number }>; // sampled trajectory
}

export interface StepWait extends StepBase {
  type: 'wait';
  condition:
    | { selector: string; visible?: boolean }
    | { text: string; appear?: boolean }
    | { navigation: true }
    | { networkIdle: true };
}

export interface StepAssert extends StepBase {
  type: 'assert';
  assert:
    | { exists: string }
    | { visible: string }
    | { textPresent: string }
    | { attribute: { selector: string; name: string; equals?: string; matches?: string } };
}

export interface StepScript extends StepBase {
  type: 'script';
  world?: 'MAIN' | 'ISOLATED';
  code: string; // user script string
  when?: 'before' | 'after';
}

export type Step =
  | StepClick
  | StepFill
  | StepKey
  | StepScroll
  | StepDrag
  | StepWait
  | StepAssert
  | StepScript
  | (StepBase & { type: 'navigate'; url: string });

export interface VariableDef {
  key: string;
  label?: string;
  sensitive?: boolean;
  default?: string;
  rules?: { required?: boolean; pattern?: string };
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  version: number;
  meta?: {
    createdAt: string;
    updatedAt: string;
    domain?: string;
    tags?: string[];
    bindings?: Array<{ type: 'domain' | 'path' | 'url'; value: string }>;
  };
  variables?: VariableDef[];
  steps: Step[];
}

export interface RunLogEntry {
  stepId: string;
  status: 'success' | 'failed' | 'retrying';
  message?: string;
  tookMs?: number;
  screenshotBase64?: string; // small thumbnail (optional)
  consoleSnippets?: string[]; // critical lines
  networkSnippets?: Array<{ method: string; url: string; status?: number; ms?: number }>;
}

export interface RunRecord {
  id: string;
  flowId: string;
  startedAt: string;
  finishedAt?: string;
  success?: boolean;
  entries: RunLogEntry[];
}
```

## 3.1（V2）可视化节点编排（DAG 模型）

- 兼容策略：现有线性 `steps[]` 作为“链式节点图”（head→...→tail）。V2 引入节点与连线定义，保留对线性的完全兼容。
- 核心接口：

```ts
// Node/Edge graph model (V2)
export type NodeType =
  | 'click'
  | 'fill'
  | 'key'
  | 'wait'
  | 'assert'
  | 'script'
  | 'navigate'
  | 'openTab'
  | 'switchTab'
  | 'closeTab'
  | 'http'
  | 'extract'
  | 'foreach'
  | 'if'
  | 'while'
  | 'datasetWrite'
  | 'clipboard'
  | 'delay';

export interface NodeBase {
  id: string;
  type: NodeType;
  name?: string;
  disabled?: boolean;
  config?: any;
  ui?: { x: number; y: number };
}
export interface Edge {
  id: string;
  from: string;
  to: string;
  label?: 'default' | 'true' | 'false' | 'onError';
}

export interface FlowV2 extends Flow {
  nodes?: NodeBase[];
  edges?: Edge[]; // when present, runner uses graph mode
  // optional subflows for foreach/while to encapsulate loops
  subflows?: Record<string, { nodes: NodeBase[]; edges: Edge[] }>;
}

// Node registry
export interface NodeRuntime<T = any> {
  // Validate config and infer IO schema
  validate(config: T): { ok: boolean; errors?: string[] };
  // Execute with context
  run(ctx: NodeContext, config: T): Promise<NodeResult>;
}
export interface NodeContext {
  tabId: number;
  vars: Record<string, any>;
  outputs: Record<string, any>;
  runId: string;
  logger: (e: RunLogEntry) => void;
}
export interface NodeResult {
  output?: any;
  error?: string;
}
```

- 执行语义：按 edges 拓扑驱动；对有条件边（true/false）、错误边（onError）进行分支控制；支持 `foreach/while` 的子流程封装。
- 工具复用映射：
  - click/fill/key/wait/assert/script/navigate：映射到现有工具（chrome_computer / read_page / wait-helper / inject_script）。
  - openTab/switchTab/closeTab：映射 window/navigate 工具。
  - http：映射 `network_request` 工具；响应裁剪字段输出到上下文。
  - extract：复用 accessibility-tree + DOM 查询抽取文本/属性。
  - datasetWrite/clipboard/delay：新建工具或复用浏览器 API（clipboard 需权限）。

## 5.1（V2）执行器与兼容

- 线性兼容：当 `nodes/edges` 缺省时，将 `steps[]` 转换为线性节点图执行。
- OnError：每个节点可定义错误策略（停止/重试/跳转 onError 边）；重试按 `retry`。
- 并发：仅 `foreach` 节点允许并发执行其子流（受全局并发上限约束）。

## 3. 录制器（recorder.js）

- 注入方式：ISOLATED world 内容脚本 + 事件监听；必要时在 MAIN world 执行最小代理（通过已有 `inject-bridge.js`）。
- 事件捕获：
  - click/dblclick：使用捕获阶段监听，提取 `target`；调用 `accessibility-tree-helper` 的 `generateSelector` 逻辑生成候选；同时基于标签、role、aria-label、文本生成 `aria/text` 候选。
  - input/change：对可填写元素读取 `name/id/data-testid/type`；值不入库，默认转变量（密码/信用卡自动标记 `sensitive`）。
  - keydown/keyup：记录组合键（ctrl/cmd/alt/shift + key）；IME 记录 compositionstart/update/end，回放时先 focus 再 `insertText`。
  - scroll：记录目标（页面/容器/元素），节流每 200ms 或每 120px 采样一次。
  - drag&drop：记录起点、终点与离散路径（节流 50ms）。
  - 导航/刷新/标签页切换：由 background 统一感知（tabs.onUpdated/onActivated）并记录。
- 元素标识：
  - 优先生成 `ref`（复用 `__claudeElementMap` 机制，在 recorder 首次引用时确保注册）。
  - 同步生成多策略候选（见 SelectorCandidate）。
- 安全与隐私：
  - 密码类输入统一转 `{var}`；默认 `sensitive=true`；实际值仅出现在回放参数弹窗，不写入 Flow。
- 与后台通信：通过 `chrome.runtime.sendMessage` 发送序列化 Step，将录制缓存到 `flow-store`（未命名的新建 Flow 草稿）。

（V2 扩展）

- 录制为节点：录制完成后将线性 steps 转换为 `nodes/edges` 链路，便于在画布上编辑；点击/输入节点自动生成 `target` 与候选选择器；可选择合并相邻 wait 为 click.after.wait。

## 4. 选择器引擎（selector-engine.ts）

- 定位顺序（可配置/可在编辑器中调整优先级）：
  1. `ref`（若仍可解析，最稳）。
  2. `id`/`data-testid`/`name` 类唯一选择器。
  3. 唯一 CSS（短路径优先）。
  4. ARIA role + name（`aria/*`）。
  5. 文本相似（阈值 0.85，可引入已有相似度引擎做兜底）。
  6. XPath（最后兜底，成本高）。
- 自动回退：若首选失败，依次尝试；成功后记录“回退路径”（用于提示“建议更新”）。
- 可见性与可交互校验：找到元素后，`scrollIntoView` + `isVisible` 校验；失败即认为本候选不可用。

## 5. 回放编排（flow-runner.ts）

- 执行策略：串行逐步执行（未来可支持分段并发，如多 Tab）。
- 核心流程：
  1. 初始化上下文：根据 PRD 选择目标 Tab/新建 Tab，必要时刷新；若启用抓包，则开始网络监听。
  2. 变量解析：合并默认值与用户输入；`sensitive` 变量只驻内存。
  3. 逐步执行：
     - 定位：`selector-engine.locate(step.target)`
     - 自动等待：可见/可交互；必要时 `wait-helper.js` 的 `waitForText/selector`。
     - 执行：优先复用现有工具：
       - click/dblclick/drag/scroll：`chrome_computer` 对应动作（CDP 精准坐标/按钮/路径）。
       - fill：`chrome_computer` 的 `fill` 或 `chrome_fill_or_select`（两者保留一条黄金路径，建议统一到 `chrome_computer` 以减少脚本注入次数）。
       - key：`chrome_computer` 的 `key`（带组合键），或降级 `keyboardTool`。
       - wait/assert：使用 `wait-helper.js` 与 `read_page` 结合；assert 失败策略按 Step 配置。
       - script：`chrome_inject_script`（MAIN/ISOLATED）+ `chrome_send_command_to_inject_script`。
     - 导航判断：click 后若监听到 URL 变化或 beforeunload，自动进入导航等待（默认 10~15s）。
     - 日志：记录耗时、状态、必要的截图（失败必带截图，成功缩略图可按需）。
  4. 收尾：关闭抓包，生成 RunRecord。
- 重试与超时：Step 级重试（次数/间隔/指数退避），全局超时保护。
- 错误分级：选择器失败/可见性失败/交互失败/导航超时/脚本异常，分类统计便于 UX 展示。

## 5.2（V2/V3）触发器与调度

- 触发器类型：
  - manual：手动触发（UI 按钮）。
  - onPage: URL 匹配（域/路径/URL 正则），基于 `tabs.onUpdated`，可指定目标 flow 与参数默认值。
  - cron: 定时（`chrome.alarms`），支持一次/重复；浏览器重启后恢复。
  - hotkey: 快捷键（`commands`）。
- 存储：`triggers:{id}`，包含类型、匹配规则、目标 flowId、默认变量。
- 安全：onPage/cron 执行前可弹出确认开关（策略项）。

## 5.3（V2）变量与表达式引擎

- 模板：支持 Mustache 风格 `{var}` 与 `${path}`（JSONPath/简化路径）混用；提供“选择上游节点输出字段” UI（自动生成路径）。
- 实现：
  - 变量表：`vars`（初始为 flow.variables + 用户输入）。
  - 输出表：`outputs[nodeId] = any`（节点运行结果）。
  - 解析：在节点运行前对其 config 中的可绑定字段做模板替换与路径解析（只读、无代码执行，防 XSS）。

## 5.4（V2）数据集（Dataset）与导出

- 数据集模型：`datasets:{flowId}` -> rows（列动态，基于第一行 schema 推断）。
- 节点：`datasetWrite` 将对象写入数据集；`datasetExport` 导出 CSV/JSON；`clipboard` 复制文本。
- 限制：数据集行数/单元大小限额（如 5k 行/单单元 32KB），超限提示分段导出。

## 5.5（V3）并发与限流

- `foreach` 节点接受 `concurrency` 配置（默认 3，最大 10），使用 PromisePool 执行子流实例；
- 全局并发上限控制避免资源枯竭；域级速率限制（同一域名内请求间隔）。

## 6. 存储与导入导出（flow-store.ts）

- 首选：`chrome.storage.local`（键：`flows:{id}`、`runs:{flowId}`、`schedules`）。
- 导出：合并导出为单一 JSON（包含 flows 与基本 runs 索引），不含敏感值与截图大对象（可选内嵌小缩略图）。
- 导入：支持版本迁移（`version` 字段）；ID 冲突策略（新建副本或覆盖）。
- 可选文件持久化：通过 native-server 新增 `saveFlow/readFlow` API 落地到工作目录，便于 Git 版本管理。

（V2 扩展）

- 版本与迁移：Flow `version` 增量；当检测到 `nodes/edges` 缺失时保持线性模式；从线性迁移到 DAG 时保留 `steps` 作为备份字段，支持回滚。

## 7. UI 交互（Popup + 编辑器）

- Popup：
  - 顶部：开始/暂停/停止录制；范围选择（当前/全局）；抓包开关。
  - 中部：当前页面资源 -> 绑定的 Flow 快捷入口；最近运行记录。
  - 底部：进入“录制流列表”。
- 流编辑器：
  - 左侧时间线列表，支持拖拽排序、批量删除/禁用步骤。
  - 右侧属性面板：目标定位/等待/断言/参数化/脚本节点/重试配置。
  - 顶部工具栏：回放此流、从某步开始回放、保存、导出。
- 回放面板（浮层）：实时高亮当前步骤，显示日志项与失败截图；一键“在失败点重试”。

（V2 扩展）画布编辑器：

- 底层：建议 Cytoscape.js / Elk + Vue 封装；支持节点拖拽、连线、分支条件标签（true/false/onError）、子流程折叠；
- 属性面板：节点类型选择、输入映射（变量/上游输出）、错误策略与重试；
- 调试：从任一节点开始执行、单步/断点、查看节点输出快照。

## 8. 安全与隐私

- 变量敏感值仅驻内存；不入库、不导出。
- 坐标点击使用 `screenshot-context` 的域名校验（已有实现），防止跨站误点击。
- 跨域 iframe：V1 不注入；检测到则弹提示。
- MAIN world 注入严格按需、最小化代码面。

（V3 扩展）凭据与密钥：

- HTTP 节点引用“凭据”占位（key id），实际值仅在内存中使用；如需持久化，优先调用 native-server 提供的加密存储（可选）。

## 9. 兼容性与降级

- DevTools/调试器占用：无法开启 Debugger 抓包时，退回 WebRequest 捕获或关闭抓包，并提示。
- 选择器劣化：`ref` 失效 -> 候选优先级回退 -> 文本/ARIA -> 失败。
- IME：回放优先 `Input.insertText`（CDP）+ DOM 事件兜底。

（V2 扩展）

- DAG 无法执行情况（循环/断边）：在编辑器即时校验并给出修复建议；运行时保护最大步数与最大深度。

## 10. 性能与可靠性

- 录制阶段：所有监听都节流/去抖；最大轨迹点数量可配置（默认 150）。
- 回放阶段：
  - 默认等待策略“快失败 + 回退重试”，避免长时间卡死。
  - 日志与截图大小控制（缩略图 base64 < 200KB）。
- 存储清理：运行记录只保留最近 N 条（默认 10）。

（V2/V3 扩展）

- 并发的内存/CPU 保护：超过资源阈值自动降并发并警告；
- 节点运行超时监控：长耗时节点（http/脚本）默认 30s 超时，可配置。

## 11. 与现有代码的集成点

- `accessibility-tree-helper.js`：
  - 直接复用 `generateSelector` 与 `__claudeElementMap`，recorder 首次访问目标时确保注册以生成 `ref`。
- `computer.ts`：
  - 作为主要执行通道；注意其已做 hostname 校验与 `read_page` ref 解析能力，可显著提升稳定性。
- `wait-helper.js`：
  - 用于 `waitForText/selector`，封装在 `flow-runner` 的等待环节。
- `screenshot.ts`：
  - 失败时调用获取截图；也可用于生成步骤缩略图（裁切元素）。
- 网络捕获：
  - 按 PRD 开关选择 `network-capture-web-request`（轻量）或 `network-capture-debugger`（深度）。

## 12. 开发分期（Milestones）

- M1（基础闭环）：
  - 录制 click/fill/key/wait + 导出 JSON；回放串行执行；基本列表与回放日志；变量输入弹窗；失败截图。
- M2（鲁棒性与编辑）：
  - 选择器多策略与回退；流编辑器（时间线 + 属性面板）；断言/脚本节点；绑定页面入口；导入导出。
- M3（高级能力）：

  - drag/scroll/全局录制/标签页切换；抓包与网络片段；定时回放；失败点重试；相似度兜底。

- M4（可视化与节点化）：
  - DAG 画布（Cytoscape/Elk）、节点注册表、线性到 DAG 自动转换；If/Foreach/While、Open/Switch/CloseTab；HTTP/Extract/Dataset/Clipboard/Delay；OnError 边与节点级错误策略；表达式/变量映射与上游输出选择器；并发与全局限流；触发器中心（manual/onPage/cron/hotkey）。

## 16. MCP 动态工具集成（注册 / Schema / 执行 / 热更新）

### 16.1 总体思路

- 保持扩展侧“执行”收口为一个通用入口（建议新增 background 工具：`flow_run`），以 `flowId + args` 运行；
- 原生宿主（native-server）侧负责“动态注册 MCP 工具”，为每个 Flow 发布一个独立工具名（proxy），调用时转发到通用入口。

### 16.2 注册路径（native-server）

- 组件：`app/native-server/src/mcp/register-tools.ts`
- 新增职责：
  - 从 `chrome.storage.local`（通过扩展消息）或本地工作区文件加载“已发布” Flow 列表；
  - 为每个 Flow 生成一个 MCP Tool 定义：
    - `name`: `flow.<slug>`；
    - `description`: 来自 `meta.tool.description` 或 Flow 描述；
    - `inputSchema`: 由 variables + 运行选项生成（见 16.3）；
    - `onCall`: 调用“通用入口”并等待结果（透传 runId/summary/outputs）。
  - 监听扩展的“flow_publish/flow_unpublish/flow_update”事件，动态增删改 MCP 工具并刷新工具列表。

### 16.3 输入 Schema 生成

- 变量到 JSON Schema：
  - type: `string|number|boolean|array|enum`；
  - default/required/sensitive（敏感仅在 Schema 上标注说明，实际必须在调用参数中提供）。
- 运行选项 Schema：

```jsonc
{
  "type": "object",
  "properties": {
    "tabTarget": { "type": "string", "enum": ["current", "new"], "default": "current" },
    "refresh": { "type": "boolean", "default": false },
    "captureNetwork": { "type": "boolean", "default": false },
    "returnLogs": { "type": "boolean", "default": false },
    "timeoutMs": { "type": "number", "minimum": 0 },
  },
}
```

- 合并：将变量 Schema 与运行选项合并为工具最终 `inputSchema`（变量字段在根级，或置于 `vars` 字段——建议根级，调用简单）。

### 16.4 执行桥接

- MCP 工具（proxy）被调用 → native-server `onCall` → 通过原生消息发给扩展 background：
  - action: `record_replay.run_flow`
  - payload: `{ flowId, args }`
- background 调用 `flow-runner.runFlow()` 执行；完成后返回统一结果体：`{ runId, success, summary, url, outputs, logs? }`。

### 16.5 热更新与版本

- Flow 保存为“已发布” → 扩展发送 `flow_publish(flow)` 给原生宿主 → 注册工具；
- Flow 更新：
  - 新版本：注册 `flow.<slug>@v2`，同时更新 `@latest` 指向；
  - 覆盖当前：替换 `flow.<slug>` 的 `inputSchema/description` 并刷新。
- 取消发布：原生宿主移除对应工具。

### 16.6 安全与边界

- 绑定域/路径校验：背景执行前校验当前 Tab/导航域是否符合，否则拒绝或在“新标签页 + startUrl”模式下执行；
- 敏感变量：只允许从调用参数进入，不在任何持久化中出现；
- 执行超时：尊重 `timeoutMs`，到时强制结束并返回失败；
- 错误返回：保留 error category（selector/navigation/script 等），便于客户端指引修复。

## 13. 关键伪代码

```ts
// flow-runner.ts (core execution sketch)
async function runFlow(
  flow: Flow,
  runId: string,
  options: {
    tabTarget: 'current' | 'new';
    refresh?: boolean;
    captureNetwork?: boolean;
    vars?: Record<string, string>;
  },
) {
  const tab = await ensureTab(options);
  const run: RunRecord = {
    id: runId,
    flowId: flow.id,
    startedAt: new Date().toISOString(),
    entries: [],
  };
  try {
    if (options.captureNetwork) await startNetworkCapture(tab.id!);
    const vars = resolveVariables(flow.variables, options.vars);

    for (const step of flow.steps) {
      const start = performance.now();
      try {
        await executeStep(tab, step, vars);
        run.entries.push({ stepId: step.id, status: 'success', tookMs: performance.now() - start });
      } catch (e: any) {
        const img = await safeScreenshot(tab.id!); // best-effort
        run.entries.push({
          stepId: step.id,
          status: 'failed',
          message: e?.message || String(e),
          tookMs: performance.now() - start,
          screenshotBase64: img,
        });
        if (!shouldRetry(step, e)) throw e;
        await retryWithBackoff(() => executeStep(tab, step, vars), step.retry);
      }
    }
    run.success = true;
  } catch (e) {
    run.success = false;
  } finally {
    if (options.captureNetwork) await stopNetworkCapture(tab.id!);
    run.finishedAt = new Date().toISOString();
    await saveRun(run);
  }
}
```

## 14. 风险与对策

- 选择器脆弱：通过 `ref` + 多候选 + 相似度兜底 + 用户提示更新，降低回放失败概率。
- 页面异步/动画：默认增加短暂 wait 与 `wait-helper`，并允许编辑器细化等待条件。
- 录制脚本与站点脚本冲突：ISOLATED world + 最小化事件写入，避免污染页面。

## 15. 验收清单（技术）

- 典型登录用例 10 次回放 ≥ 95% 成功。
- 选择器回退路径在 UI 明确可见并可一键更新。
- 敏感变量不落盘；导出文件不含任何敏感值。
- 失败报告包含失败截图与错误分级。

```text
Note: 本设计严格贴合现有代码结构与工具能力，优先复用 chrome_read_page / chrome_computer / wait-helper 等模块，控制新增复杂度并确保可落地性。
```
