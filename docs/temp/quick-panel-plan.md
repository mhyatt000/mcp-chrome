# Quick Panel 功能完善实施计划

## 一、背景与现状分析

### 1.1 PRD 核心目标

Quick Panel 是一个类 Raycast 的浏览器命令面板，提供：

- **统一入口**：标签页/书签/历史/命令的聚合搜索
- **键盘优先**：全程键盘操作，快捷键丰富
- **本地优先**：数据本地处理，隐私安全
- **差异化能力**：利用 CDP/Native Host/MCP 实现独特功能

### 1.2 当前实现状态（P0 + 部分 P1，更新于 2026-01-03）

| 模块                | 状态    | 说明                                                                                            |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| Shadow DOM 宿主     | ✅ 完成 | `ui/shadow-host.ts` 样式隔离、事件阻断、主题同步                                                |
| AI Chat 面板        | ✅ 完成 | `ui/ai-chat-panel.ts` 流式对话、SSE、取消                                                       |
| AI Chat View        | ✅ 完成 | `ui/ai-chat-view.ts` 可嵌入的 View 组件（Phase 1）                                              |
| 双视图 Shell        | ✅ 完成 | `ui/panel-shell.ts` 已集成到 Controller                                                         |
| SearchEngine        | ✅ 完成 | `core/search-engine.ts` 已接入 UI                                                               |
| Tabs Provider       | ✅ 完成 | `providers/tabs-provider.ts` 已接入 SearchView                                                  |
| Search View         | ✅ 完成 | `ui/search-view.ts` 搜索视图容器（Phase 2）                                                     |
| 键盘导航            | ✅ 完成 | `core/keyboard-controller.ts` IME 支持（Phase 3）                                               |
| 结果列表 UI         | ✅ 完成 | 集成在 search-view.ts，支持 favicon 优先显示                                                    |
| 动作面板 UI         | ✅ 完成 | `ui/action-panel.ts` 支持 Tab 动作（Phase 4）                                                   |
| Bookmarks Provider  | ✅ 完成 | `providers/bookmarks-provider.ts` 书签搜索（Phase 5）                                           |
| History Provider    | ✅ 完成 | `providers/history-provider.ts` 历史搜索（Phase 5）                                             |
| Content Provider    | ✅ 完成 | `providers/content-provider.ts` 内容搜索（Phase 7）                                             |
| Commands Provider   | ✅ 完成 | `providers/commands-provider.ts` 页面/标签命令（Phase 5）                                       |
| 使用历史追踪        | ✅ 完成 | 最近使用记录与排序（Phase 6）                                                                   |
| Workspaces Provider | ✅ 完成 | `providers/workspaces-provider.ts` 会话快照（Phase 11）                                         |
| Diagnostics Suite   | ✅ 完成 | Debug Bundle + API Detective（Phase 13）                                                        |
| Clipboard History   | ✅ 完成 | `providers/clipboard-provider.ts` + `background/quick-panel/clipboard-handler.ts`（Phase 15.1） |
| Quick Notes         | ✅ 完成 | `providers/notes-provider.ts` + `background/quick-panel/notes-handler.ts`（Phase 15.2）         |
| Focus Mode          | ✅ 完成 | `providers/focus-provider.ts` + `background/quick-panel/focus-handler.ts`（Phase 15.3）         |
| Web Monitor         | ✅ 完成 | `providers/monitor-provider.ts` + `background/quick-panel/monitor-handler.ts`（Phase 15.4）     |
| Tool Audit Log      | ✅ 完成 | `providers/audit-provider.ts` + `background/quick-panel/audit-handler.ts`（Phase 14）           |

> 注：PRD 中的 “AI 编排与可控工具层（Agent Mode）/ 个人效率与提醒” 已完成第一版（Phase 14/15）；后续仍可扩展（见下文）。

### 1.3 关键架构冲突（✅ 已解决）

~~当前存在 **双 overlay 冲突**~~：

- ~~`panel-shell.ts:139` 创建 `.qp-overlay/.qp-panel`~~
- ~~`ai-chat-panel.ts:272` 也创建 `.qp-overlay/.qp-panel`~~
- ~~Controller 直接使用 AI Chat（绕过 Shell）~~

**解决方案**（Phase 1 已实现）：

- `ai-chat-view.ts` - 不创建 overlay，只渲染内容到 mount points
- `ai-chat-panel.ts` - 改为 Shell + View 的 wrapper，保持 API 兼容
- `index.ts` - Controller 使用 Shell 作为唯一容器

---

## 二、实施策略：增量迁移

采用 **增量迁移** 策略，保持现有 AI Chat 功能可用的同时逐步引入搜索面板能力。

### 核心原则

1. Shell 作为唯一容器
2. AI Chat 改造为可嵌入的 View
3. 搜索功能逐步接入
4. 保持向后兼容

---

## 三、阶段划分

### Phase 1: 架构重构 - Shell 统一容器

**目标**：让 Shell 成为唯一容器，AI Chat 作为其 chat view

#### 1.1 重构 AI Chat Panel 为 View 组件

- **新建** `ui/ai-chat-view.ts` - 不创建 overlay/panel，只渲染内容
  - Header 内容 → `headerChatMount`
  - Messages/Empty → `contentChatMount`
  - Composer → `footerChatMount`
- **修改** `ai-chat-panel.ts` - 改为内部调用 shell + view 的 wrapper（保持 API 兼容）

#### 1.2 重构 Controller

- **修改** `index.ts`
  - 使用 `mountQuickPanelShell` 作为唯一容器
  - 默认显示 search view（而非直接显示 chat）
  - 支持 view 切换

#### 关键文件

```
app/chrome-extension/shared/quick-panel/
├── index.ts                    # 修改
├── ui/
│   ├── panel-shell.ts          # 保持
│   ├── ai-chat-panel.ts        # 修改（wrapper）
│   └── ai-chat-view.ts         # 新建
```

---

### Phase 2: 搜索主链路

**目标**：打通 SearchEngine + Provider → UI 的完整链路

#### 2.1 实现搜索视图 UI

- **新建** `ui/search-view.ts` - 搜索视图容器
  - 挂载 SearchInput 到 `headerSearchMount`
  - 挂载 QuickEntries 到 `contentSearchMount`
  - 挂载 ResultList 到 `contentSearchMount`
  - 挂载 Footer 提示 到 `footerSearchMount`

#### 2.2 实现结果列表

- **新建** `ui/result-list.ts`
  - 虚拟滚动（处理大量结果）
  - 选中态管理
  - 空状态/加载状态
- **新建** `ui/result-item.ts`
  - 图标/标题/副标题
  - 选中态样式
  - Favicon 显示

#### 2.3 接入 SearchEngine

- **修改** `ui/search-view.ts`
  - 创建 SearchEngine 实例
  - 注册 TabsProvider
  - 监听 SearchInput 输入，调用 engine.schedule()
  - 渲染搜索结果

#### 关键文件

```
app/chrome-extension/shared/quick-panel/ui/
├── search-view.ts              # 新建
├── result-list.ts              # 新建
├── result-item.ts              # 新建
└── search-input.ts             # 已存在，确认接入
```

---

### Phase 3: 键盘导航系统

**目标**：实现 PRD 要求的完整键盘交互

#### 3.1 KeyboardController 核心

- **新建** `core/keyboard-controller.ts`
  - 状态机：`search` | `chat` | `action-panel`
  - 事件监听：ShadowRoot capture 级别
  - 快捷键映射表

#### 3.2 搜索视图键盘交互

| 快捷键        | 动作                 |
| ------------- | -------------------- |
| `↑/↓`         | 列表导航             |
| `Enter`       | 执行默认动作         |
| `Cmd+Enter`   | 新标签打开           |
| `Tab/→`       | 打开动作面板         |
| `Backspace/←` | 返回（输入框为空时） |
| `Esc`         | 关闭面板             |
| `Cmd+T/B/H`   | 切换 Scope           |

#### 3.3 动作面板键盘交互

| 快捷键  | 动作         |
| ------- | ------------ |
| `↑/↓`   | 动作列表导航 |
| `Enter` | 执行选中动作 |
| `Esc/←` | 返回搜索视图 |

#### 关键文件

```
app/chrome-extension/shared/quick-panel/core/
└── keyboard-controller.ts      # 新建
```

---

### Phase 4: 动作面板

**目标**：实现二级动作选择界面

#### 4.1 动作面板 UI

- **新建** `ui/action-panel.ts`
  - 动作列表渲染
  - 键盘导航
  - 执行后关闭
  - 危险动作样式（tone: danger）

#### 4.2 扩展 Tabs 动作

**前端**（tabs-provider.ts）:

- 复制 URL
- 复制 Markdown
- 固定/取消固定
- 静音/取消静音

**后端**（tabs-handler.ts）新增消息类型:

- `QUICK_PANEL_TAB_SET_PINNED`
- `QUICK_PANEL_TAB_SET_MUTED`

#### 关键文件

```
app/chrome-extension/shared/quick-panel/
├── ui/action-panel.ts                          # 新建
├── providers/tabs-provider.ts                  # 修改
app/chrome-extension/entrypoints/background/quick-panel/
└── tabs-handler.ts                             # 修改
app/chrome-extension/common/
└── message-types.ts                            # 修改
```

---

### Phase 5: 更多 Providers

**目标**：实现 PRD P0 的完整 Provider 体系

#### 5.1 Bookmarks Provider

- **新建** `providers/bookmarks-provider.ts`
- **新建** `background/quick-panel/bookmarks-handler.ts`
- 复用现有 `tools/browser/bookmark.ts` 的 chrome.bookmarks API

#### 5.2 History Provider

- **新建** `providers/history-provider.ts`
- **新建** `background/quick-panel/history-handler.ts`
- 复用现有 `tools/browser/history.ts` 的 chrome.history API

#### 5.3 Commands Provider

- **新建** `providers/commands-provider.ts`
- **新建** `core/command-registry.ts`
- **新建** `commands/` 目录
  - `page-commands.ts` - 复制链接/Markdown/截图
  - `tab-commands.ts` - 新建标签/窗口

---

### Phase 6: 使用历史追踪

**目标**：实现最近使用记录与排序

#### 6.1 HistoryTracker 模块

- **新建** `core/history-tracker.ts`
  - `recordUsage(key, ts)` - 记录使用
  - `getSignals(keys)` - 获取使用信号
  - `getRecentList()` - 获取最近使用列表
  - 存储：`chrome.storage.local`

#### 6.2 排序集成

- **修改** Controller/SearchView
  - 获取搜索结果后，注入 usage signal 做二次排序
  - 面板打开时优先显示最近使用

---

### Phase 7: 内容搜索 Provider

**目标**：实现 PRD 的“内容搜索”能力（scope: `c `），可在打开的标签页中按正文内容检索。

#### 7.1 后台内容缓存

- **新建** `background/quick-panel/content-handler.ts`
- 复用 `inject-scripts/web-fetcher-helper.js`（Readability）抽取可读正文
- 内容截断到 50KB（best-effort），并限制缓存最多 200 个标签页
- 触发时机（best-effort）：
  - `tabs.onUpdated` (status === 'complete')
  - `webNavigation.onHistoryStateUpdated` (SPA 路由变化)
  - `tabs.onRemoved` (清理缓存)

#### 7.2 Content Provider

- **新建** `providers/content-provider.ts`
- 默认动作：切换到匹配标签页；`Cmd/Ctrl+Enter` 以新标签打开 URL
- 二级动作：新标签打开、复制 URL、关闭标签页

---

### Phase 8: 标签页高级管理（Commands）

**目标**：实现 PRD P1 的高频标签页管理能力，并复用现有 `>` Commands 体系（不新增 UI 复杂度）。

#### 8.1 新增命令项（Commands Provider）

- **修改** `providers/commands-provider.ts`
  - Close other tabs（关闭当前窗口其它未固定标签）
  - Close tabs to the right（关闭右侧未固定标签）
  - Discard inactive tabs（丢弃当前窗口未固定的非激活标签，释放内存）
  - Merge all windows（将其它窗口的标签移动到当前窗口）

#### 8.2 扩展后台命令执行能力

- **修改** `background/quick-panel/page-commands-handler.ts`
  - 新增 page command：`close_other_tabs` / `close_tabs_to_right` / `discard_inactive_tabs` / `merge_all_windows`
- **修改** `common/message-types.ts`
  - 扩展 `QuickPanelPageCommand` union

---

### Phase 9: 多引擎搜索 & 快捷链接（来自 `.docs/tansuo.md`）

**目标**：在 Quick Panel 内用前缀快速打开常用搜索引擎与 URL 模板（例如 `g react hooks`、`gh openai`、`npm vitest`），减少上下文切换。

#### 9.1 Scope / Prefix 扩展（输入协议）

- **修改** `core/types.ts`
  - 扩展 `QuickPanelScope` / `QUICK_PANEL_SCOPES`（新增若干 “Web Search” scope）
  - 扩展 `parseScopePrefixedQuery`：识别 `g ` / `gh ` / `npm ` / `so ` / `mdn ` 等前缀（按 PRD 精简）
- 约束：新增 scope **仅前缀触发**，不强制增加新的键盘切换快捷键，避免 UI 复杂度膨胀

#### 9.2 Web Search Provider

- **新建** `providers/web-search-provider.ts`
  - scope 驱动：不同 scope → 不同 engine URL 模板（Google/GitHub/NPM/StackOverflow/MDN…）
  - 动作：Enter 在当前标签打开；`Cmd/Ctrl+Enter` 新标签打开（复用 openMode → `QUICK_PANEL_OPEN_URL`）
- **新建** `core/url-template.ts`（纯函数）
  - 统一处理 URL 模板填充与编码规则（`{query}`、可选的 `{rawQuery}` 等）
  - 提供可测试的最小接口：`buildSearchUrl(engine, query)`

#### 9.3 配置（可选）

- **可选**：支持用户自定义搜索引擎模板（`chrome.storage.sync`），并提供默认模板集作为 fallback
  - 说明：建议优先做 “内置 5-8 个引擎 + 可编辑” 的闭环，再考虑更泛化的模板 DSL

---

### Phase 10: 页面工具（Zen / Dark / Reader / Outline / Clean URL / PIP / Allow Copy）

**目标**：补齐 PRD P1 “页面工具”能力，优先以 `>` Commands 落地（低 UI 成本），并复用既有 background bridge。

#### 10.1 无参数 Commands（toggle / one-shot 优先）

- **修改** `providers/commands-provider.ts`
  - Page Skins：VS Code / Terminal / Retro / Paper / Off（始终显示 “Skin mode” 水印，避免产生“伪装”歧义）
  - Clean URL：去除常见追踪参数（utm/fbclid/gclid 等），支持复制与新标签打开
  - Zen Mode：注入 CSS 隐藏干扰元素（best-effort），支持关闭还原
  - Force Dark：CSS filter 强制暗色（best-effort），支持关闭还原
  - Allow Copy：解除复制/选中限制（best-effort，不承诺对所有站点有效）
  - Picture-in-Picture：对页面内可用 `<video>` 触发 PIP
  - Privacy Curtain：一键遮罩/模糊当前页面（屏幕共享/公共场景的隐私保护）
- **修改** `background/quick-panel/page-commands-handler.ts`
  - 统一走 `QUICK_PANEL_PAGE_COMMAND`，按 command 分支注入脚本或调用现有 tool
- **修改** `common/message-types.ts`
  - 扩展 `QuickPanelPageCommand` union + 消息 typing

#### 10.2 Reader / Outline（需要“列表型结果”的承载）

- **Reader Mode（建议优先）**
  - 复用 `inject-scripts/web-fetcher-helper.js`（Readability）抽取正文
  - 输出策略二选一（需要产品决策）：
    - 方案 A：新增 `ui/reader-view.ts`（作为第三视图，复用 Shell）
    - 方案 B：生成纯 HTML/Markdown 并在新标签打开（更轻量、可先闭环）
- **Page Outline（目录）**
  - 注入脚本抽取 H1-H6（含 text + id + offset），并提供跳转能力（`scrollIntoView`）
  - 承载方式建议同 Reader：要么独立 view，要么先做 “复制目录为 Markdown”

---

### Phase 11: 会话 / 工作区（Session Time Machine）

**目标**：把 “保存/恢复一组标签页” 做成一等能力，支持项目上下文切换，并为后续 AI 编排提供可复用的基础工具。

#### 11.1 后台存储与消息协议

- **新建** `background/quick-panel/workspaces-handler.ts`
  - 负责：保存快照、列出快照、恢复快照、删除快照
  - 存储：`chrome.storage.local`（先闭环；后续可选迁移到 `storage.sync`）
- **修改** `common/message-types.ts`
  - 新增：`QUICK_PANEL_WORKSPACES_LIST` / `QUICK_PANEL_WORKSPACES_SAVE` / `QUICK_PANEL_WORKSPACES_OPEN` / `QUICK_PANEL_WORKSPACES_DELETE`

#### 11.2 Provider & UX

- **新建** `providers/workspaces-provider.ts`
  - 建议 scope 前缀：`ws `（仅前缀触发）
  - 空查询：展示最近快照 + “Save current session”
  - 有查询：过滤匹配，并提供虚拟条目 “Save session as <query>” 以承载命名输入
  - 打开动作：当前窗口恢复 / 新窗口恢复（至少二选一）
- **风险控制**
  - 恢复快照可能导致批量打开标签：需要二次确认策略（UI/交互待确认）
  - Incognito 与 normal 之间禁止互相恢复（避免隐私边界破坏）

---

### Phase 12: 工具箱（文本转换 + 开发者常用）

**目标**：把 `.docs/tansuo.md` 中高频 “瑞士军刀” 能力落到 Quick Panel，优先以可测试的纯函数实现，并在 UI 上以 “结果 + 一键复制” 闭环。

#### 12.1 文本/数据转换（Argument Commands）

- 典型命令（示例）：`> json {...}` / `> base64 encode ...` / `> url decode ...` / `> ts 1700000000` / `> uuid` / `> jwt <token>`
- 实现建议：
  - **扩展** `providers/commands-provider.ts`：引入 “argument command” 概念（基于 query tokens 动态生成结果）
  - **新建** `core/toolbox/`：放置可复用纯函数（json/url/base64/ts/jwt/uuid/regex）
  - 结果呈现：subtitle 展示截断预览，动作面板提供 Copy/Copy raw 等

#### 12.2 开发者工具（复用现有 browser tools）

- 复用 `app/chrome-extension/entrypoints/background/tools/browser/*`：
  - Cookie 查看/导出（`chrome.cookies`）
  - LocalStorage/SessionStorage 读取（注入脚本）
  - Network capture（webRequest/debugger 两种实现）
  - Performance trace、Console capture、Read Page 等
- Quick Panel 侧落地形式：
  - 先做 “`>` Commands → 执行并导出/复制结果” 的闭环
  - 复杂交互（列表/筛选）再升级为独立 view（避免早期 UI 失控）

---

### Phase 13: 差异化诊断套件（Debug Bundle / API Detective）

**目标**：把 PRD P2 的差异化能力做成可售卖的核心卖点：一键采集 Bug 报告包、抓包反推 API。

#### 13.1 Debug Bundle（一键 Bug 报告）

- 编排现有 Tools（截图/Console/Network/Performance），输出到 Downloads（zip 或目录）
- 关键要求：
  - 可取消、可重试、失败可定位（每一步单独 error）
  - 高风险能力（debugger/network body）需要显式提示/确认

#### 13.2 API Detective（抓包反推 API）

- Quick Panel 命令开始抓包 → 用户执行操作 → 命令停止抓包 → 列表展示关键请求
- 输出能力：复制为 curl / fetch、请求重放（复用 `network-request`）

---

### Phase 14: AI 编排与可控工具层（Agent Mode，探索）

**目标**：将上述能力封装为可被 AI 调用的 “Tools”，提供权限分级、确认门槛与可回放 action log，支撑商业级可控性。

- 方向（来自 `.docs/tansuo.md`）：
  - tool schema（输入/输出契约）+ 统一执行通道
  - 风险分级（读/写/破坏性/外部网络/本地文件）+ 二次确认
  - Plan mode：先展示计划，再执行
  - Action log：可审计、可回放、可撤销（best-effort）

---

### Phase 15: 个人效率与提醒（Clipboard / Notes / Pomodoro / Focus / Monitor）

**目标**：落地 `.docs/tansuo.md` 中的高频个人效率能力：剪贴板历史、快速笔记、番茄钟/专注模式、网页监控与提醒（分阶段）。

#### 15.1 Clipboard History（先做 Quick Panel 内来源）

- **新建** `providers/clipboard-provider.ts`（建议 scope 前缀：`clip `）
- **新建** `background/quick-panel/clipboard-handler.ts`
  - 仅记录来自 Quick Panel 的复制行为（Copy URL/Copy Markdown/工具箱 Copy 结果等）
  - 可选增加显式命令：`> clip save`（在用户手势内读取当前剪贴板，避免无授权读取）

#### 15.2 Quick Notes（本地优先）

- **新建** `providers/notes-provider.ts`（建议 scope 前缀：`note `）
- **新建** `background/quick-panel/notes-handler.ts`
  - 通过 query 创建/搜索笔记，默认本地存储（`chrome.storage.local`）

#### 15.3 Pomodoro / Focus Mode（专注与防打断）

- **新建** `providers/focus-provider.ts`（或以 `>` Commands 先闭环）
- 后台使用 `chrome.alarms` 实现计时与状态持久化
- 网站屏蔽策略（可选）：
  - 复用 `declarativeNetRequest` 动态规则，在专注期间阻断/重定向干扰域名
  - 提供一键暂停/延长（带“心理 friction”）
  - Implemented timed blocking snooze/resume (`focus snooze 5` / `focus resume-blocking`) to avoid “forgotten disable” scenarios.

#### 15.4 Web Monitor / Price Track（可选）

- 后台定时抽取页面关键元素（best-effort），发生变化时提示用户
- 备注：通知形态需要产品决策（面板内提示 vs 增加 `notifications` 权限）

## 四、文件变更清单

### 新建文件

```
app/chrome-extension/shared/quick-panel/
├── ui/
│   ├── ai-chat-view.ts         # AI Chat 作为 View 组件
│   ├── search-view.ts          # 搜索视图容器
│   ├── result-list.ts          # 结果列表
│   ├── result-item.ts          # 结果项
│   └── action-panel.ts         # 动作面板
├── core/
│   ├── keyboard-controller.ts  # 键盘控制器
│   ├── history-tracker.ts      # 使用历史追踪
│   ├── content-search.ts       # 内容搜索（snippet + token scoring）
│   └── command-registry.ts     # 命令注册表
├── providers/
│   ├── bookmarks-provider.ts   # 书签 Provider
│   ├── history-provider.ts     # 历史 Provider
│   ├── content-provider.ts     # 内容 Provider
│   └── commands-provider.ts    # 命令 Provider
└── commands/
    ├── page-commands.ts        # 页面操作命令
    └── tab-commands.ts         # 标签页命令

app/chrome-extension/entrypoints/background/quick-panel/
├── bookmarks-handler.ts        # 书签后台处理
├── history-handler.ts          # 历史后台处理
└── content-handler.ts          # 内容搜索后台处理
```

### 修改文件

```
app/chrome-extension/shared/quick-panel/
├── index.ts                    # Controller 重构
├── ui/
│   ├── ai-chat-panel.ts        # 改为 Shell + View 的 wrapper
│   └── panel-shell.ts          # 可能需要微调
├── providers/
│   └── tabs-provider.ts        # 扩展动作
app/chrome-extension/shared/quick-panel/ui/
└── search-view.ts              # 更新 placeholder/scopes
app/chrome-extension/shared/quick-panel/providers/
└── index.ts                    # 导出 Content provider
app/chrome-extension/shared/quick-panel/providers/
└── commands-provider.ts         # 新增标签管理命令（P1）
app/chrome-extension/entrypoints/background/quick-panel/
└── tabs-handler.ts             # 新增 pin/mute 消息处理
app/chrome-extension/entrypoints/background/quick-panel/
└── page-commands-handler.ts     # 扩展 page commands（P1）
app/chrome-extension/entrypoints/background/
└── index.ts                    # 初始化 Content handler
app/chrome-extension/common/
└── message-types.ts            # 新增消息类型
```

### Phase 9+ 预期文件增量（部分已实现）

> 说明：以下为从 `.docs/tansuo.md` 提炼出的可落地 backlog 对应的预期文件增量，具体以 Phase 9+ 的产品决策为准。

#### 新建（建议）

- `app/chrome-extension/shared/quick-panel/providers/clipboard-provider.ts`
- `app/chrome-extension/entrypoints/background/quick-panel/clipboard-handler.ts`
- `app/chrome-extension/shared/quick-panel/providers/notes-provider.ts`
- `app/chrome-extension/entrypoints/background/quick-panel/notes-handler.ts`
- `app/chrome-extension/shared/quick-panel/providers/focus-provider.ts`
- （可选）`app/chrome-extension/shared/quick-panel/ui/reader-view.ts`

#### 已实现（摘录）

- `app/chrome-extension/shared/quick-panel/providers/web-search-provider.ts`
- `app/chrome-extension/shared/quick-panel/core/url-template.ts`
- `app/chrome-extension/shared/quick-panel/providers/workspaces-provider.ts`
- `app/chrome-extension/entrypoints/background/quick-panel/workspaces-handler.ts`
- `app/chrome-extension/shared/quick-panel/core/toolbox/*`

#### 修改（必需）

- `app/chrome-extension/shared/quick-panel/core/types.ts`（scope/prefix 扩展）
- `app/chrome-extension/common/message-types.ts`（workspaces + page tools + toolbox 协议）
- `app/chrome-extension/entrypoints/background/quick-panel/page-commands-handler.ts`（新增页面工具命令）
- `app/chrome-extension/shared/quick-panel/providers/commands-provider.ts`（argument commands + 页面工具命令入口）

---

## 五、消息协议扩展

### 新增消息类型

```typescript
// Tabs
QUICK_PANEL_TABS_QUERY: 'quick_panel_tabs_query',
QUICK_PANEL_TAB_ACTIVATE: 'quick_panel_tab_activate',
QUICK_PANEL_TAB_CLOSE: 'quick_panel_tab_close',

// Tabs 二级动作
QUICK_PANEL_TAB_SET_PINNED: 'quick_panel_tab_set_pinned',
QUICK_PANEL_TAB_SET_MUTED: 'quick_panel_tab_set_muted',

// Bookmarks
QUICK_PANEL_BOOKMARKS_QUERY: 'quick_panel_bookmarks_query',
QUICK_PANEL_BOOKMARK_REMOVE: 'quick_panel_bookmark_remove',

// History
QUICK_PANEL_HISTORY_QUERY: 'quick_panel_history_query',
QUICK_PANEL_HISTORY_DELETE: 'quick_panel_history_delete',

// Content
QUICK_PANEL_CONTENT_QUERY: 'quick_panel_content_query',

// Navigation & Commands
QUICK_PANEL_OPEN_URL: 'quick_panel_open_url',
QUICK_PANEL_PAGE_COMMAND: 'quick_panel_page_command',

// Usage
QUICK_PANEL_USAGE_RECORD: 'quick_panel_usage_record',
QUICK_PANEL_USAGE_GET_ENTRIES: 'quick_panel_usage_get_entries',
QUICK_PANEL_USAGE_LIST_RECENT: 'quick_panel_usage_list_recent',

// Workspaces (Phase 11+)
QUICK_PANEL_WORKSPACES_LIST: 'quick_panel_workspaces_list',
QUICK_PANEL_WORKSPACES_SAVE: 'quick_panel_workspaces_save',
QUICK_PANEL_WORKSPACES_OPEN: 'quick_panel_workspaces_open',
QUICK_PANEL_WORKSPACES_DELETE: 'quick_panel_workspaces_delete',

// Clipboard / Notes / Focus (Phase 15+)
QUICK_PANEL_CLIPBOARD_LIST: 'quick_panel_clipboard_list',
QUICK_PANEL_CLIPBOARD_SAVE: 'quick_panel_clipboard_save',
QUICK_PANEL_NOTES_QUERY: 'quick_panel_notes_query',
QUICK_PANEL_NOTES_CREATE: 'quick_panel_notes_create',
QUICK_PANEL_NOTES_DELETE: 'quick_panel_notes_delete',
QUICK_PANEL_FOCUS_START: 'quick_panel_focus_start',
QUICK_PANEL_FOCUS_STOP: 'quick_panel_focus_stop',
QUICK_PANEL_FOCUS_STATUS: 'quick_panel_focus_status',
```

---

## 六、验收标准

### Phase 1 完成标准 ✅ (2025-12-30)

- [x] Shell 作为唯一容器
- [x] AI Chat 可通过搜索 "ai" 或 Tab 键切换进入
- [x] 现有 AI Chat 功能无回归（ai-chat-panel.ts 保持 API 兼容）

### Phase 2 完成标准 ✅ (2025-12-30)

- [x] 输入关键词可搜索标签页
- [x] 结果列表正确显示（支持 favicon 优先）
- [x] 点击结果可切换到对应标签页

### Phase 3 完成标准 ✅ (2025-12-30)

- [x] ↑↓ 键可导航结果列表
- [x] Enter 执行默认动作
- [x] Tab/→ 打开动作面板（AI 条目则切换到 Chat）
- [x] Esc 关闭面板（或先关闭动作面板）
- [x] IME 输入法兼容（isComposing 守卫）

### Phase 4 完成标准 ✅ (2025-12-30)

- [x] 动作面板正确显示
- [x] 可执行所有标签页动作
- [x] Pin/Mute 功能正常

### Phase 5 完成标准 ✅ (2025-12-31)

- [x] 书签搜索功能正常
- [x] 历史搜索功能正常
- [x] 基础命令可执行

### Phase 6 完成标准 ✅ (2025-12-31)

- [x] 使用记录正确保存（chrome.storage.local，防抖写入）
- [x] 面板打开显示最近使用（空查询时刷新 recent list）
- [x] 搜索结果融合使用频次排序（applyUsageBoost 二次排序）

### Phase 7 完成标准 ✅ (2026-01-03)

- [x] `c ` scope 可返回匹配结果并显示 snippet
- [x] 后台自动缓存正文（best-effort），并在 SPA 路由变化后更新
- [x] 受限页面不会导致错误扩散（无法抓取则跳过）

### Phase 8 完成标准 ✅ (2026-01-03)

- [x] `>` Commands 增加标签管理命令（close others / close right / discard inactive / merge windows）
- [x] 后台执行使用同一 `QUICK_PANEL_PAGE_COMMAND` 通道（不新增消息体系复杂度）

### Phase 9 完成标准 ✅ (2026-01-03)

- [x] `g ` / `gh ` / `npm ` / `so ` / `mdn ` 前缀可用，并只返回 Web Search 结果（不污染 tabs/bookmarks/history）
- [x] Enter / `Cmd/Ctrl+Enter` 的打开行为与 `openMode` 一致（复用 `QUICK_PANEL_OPEN_URL`）
- [x] URL 模板填充与编码逻辑有单元测试覆盖（`core/url-template.ts`）

### Phase 10 完成标准 ✅ (2026-01-03)

- [x] `>` 页面工具命令可用：Clean URL / Zen / Dark / Allow Copy / PIP / Privacy Curtain，并且支持关闭还原
- [x] Reader Mode 形成闭环（in-page overlay，Esc/Close 关闭还原）
- [x] 注入失败（受限页/权限）不影响 Quick Panel 主链路（best-effort）

### Phase 11 完成标准 ✅ (2026-01-03)

- [x] `ws ` scope 可保存/列出/搜索/恢复/删除工作区，并支持命名输入（通过 query 生成虚拟条目）
- [x] 恢复快照不跨 incognito 边界；批量操作具备确认门槛（默认新窗口打开，当前窗口恢复需要 `Cmd/Ctrl+Enter`）
- [x] 存储 schema 包含版本字段，支持后续迁移与回滚

### Phase 12 完成标准 ✅ (2026-01-03)

- [x] Argument Commands 覆盖 ≥5 个高频工具（已实现：json/url/base64/ts/uuid/jwt），并可一键复制结果
- [x] 核心逻辑以纯函数实现，并补齐单元测试（`core/toolbox/*` + `tests/quick-panel/toolbox.test.ts`）
- [x] 开发者工具以 “命令执行 + 导出/复制结果” 先闭环（已实现：Console export / Network capture (10s) / Performance trace (5s) / read_page export）

### Phase 13 完成标准 ✅ (2026-01-03)

- [x] Debug Bundle 可在 Downloads 生成报告包（目录形式，包含 screenshot/console/network/performance/read_page + manifest.json）
- [x] API Detective 支持 start/stop 抓包、列表展示请求、复制 curl/fetch 片段，并支持请求重放（Replay 标记为危险动作）
- [x] 支持取消与错误定位（Debug Bundle 每一步单独记录 success/error，并提供 cancel 命令；API Detective 高风险抓包提供显式“danger”入口）

### Phase 14 完成标准 ✅ (2026-01-03)

- [x] tool schema + 权限分级 + 二次确认机制落地（覆盖高风险动作）
- [x] action log 可审计（至少记录：工具、参数摘要、结果摘要、时间）
- [x] 支持 Plan mode：先展示计划，再执行（用户可确认/取消）

### Phase 15 完成标准 ✅ (2026-01-03)

- [x] `clip ` scope 可查看/搜索剪贴板历史（覆盖 Quick Panel 内复制来源），并支持 pin/复制（Phase 15.1 ✅）
- [x] `note ` scope 可创建/搜索笔记并本地持久化（Phase 15.2 ✅）
- [x] Pomodoro/Focus 可启动/停止计时并恢复状态；（可选）站点屏蔽规则可一键暂停/延长（Phase 15.3 ✅）
- [x] Focus blocking supports timed snooze/resume (Phase 15.3 hardening ✅)
- [x] （可选）`mon ` scope 可创建/管理网页监控并记录变更提醒（无 notifications 权限，使用徽标 + 面板内列表）（Phase 15.4 ✅）

---

## 七、风险与应对

| 风险                        | 应对措施                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| AI Chat 改造影响现有功能    | 保留兼容 wrapper，增量测试                                       |
| 键盘快捷键与网站冲突        | ShadowRoot capture + stopPropagation                             |
| 大量标签页性能问题          | 虚拟滚动 + 防抖 + 分页                                           |
| 特殊页面无法注入            | 提供 Popup fallback（P1）                                        |
| Scope 前缀扩展误触发        | 仅识别“带空格”的前缀（如 `g `），并在 UI 明确展示当前 scope      |
| 批量操作/诊断采集的隐私风险 | 高风险命令显式提示与确认；默认本地生成与存储；可清理日志与产物   |
| 页面工具注入兼容性风险      | Best-effort + 可关闭还原；失败不阻断主链路；避免持久化侵入式修改 |

---

## 八、已确认决策

| 决策项       | 结论                                                               |
| ------------ | ------------------------------------------------------------------ |
| AI Chat 定位 | **作为二级视图**：通过 Tab 键或搜索 "ai" 选中进入，类 Raycast 交互 |
| 实施节奏     | **按 Phase 分批**：先完成 Phase 1-3，验证后继续                    |
| 快捷键       | **保持 Cmd+Shift+U**：避免与其他软件冲突                           |

### 待确认决策（Phase 9+，来自 `.docs/tansuo.md`）

- Scope 扩展策略：为每个引擎新增 scope（`g/gh/npm/...`） vs 引入可配置的前缀路由（更灵活但需要改动 query 协议）
- Reader/Outline 承载方式：新增 view（更一致） vs 新标签打开（更轻量、先闭环）
- Workspaces 存储与同步：`chrome.storage.local`（先闭环） vs `storage.sync`（跨设备，但容量/延迟/隐私需评估）
- 批量/破坏性动作的确认门槛：统一确认 UI（一次性） vs 仅对高风险命令提示（更轻量）
- Tab 分组能力是否纳入 P1：如需要 `tabGroups` 权限，需评估安装劝退成本与替代方案
- 诊断套件输出格式：zip vs 目录；是否默认采集 response body（隐私/体积/权限）
- AI Tooling：默认 “Plan mode” 是否开启、工具权限分级粒度、action log 的保存与导出策略

---

## 九、第一批实施详细任务（Phase 1-3）

### 任务清单

#### Phase 1: 架构重构 - Shell 统一容器

**Task 1.1: 创建 AI Chat View 组件**

- 文件：`ui/ai-chat-view.ts`（新建）
- 职责：
  - 提供 `mountQuickPanelAiChatView(options)` 函数
  - 接收 mount points: `headerMount`, `headerRightMount`, `contentMount`, `footerMount`
  - 不创建 overlay/panel，只渲染内容
  - Header: 标题/副标题/流式状态指示
  - Content: 消息列表/空状态
  - Footer: 输入框/发送按钮/停止按钮/提示
- 复用现有 `ai-chat-panel.ts` 的核心逻辑

**Task 1.2: 修改 AI Chat Panel 为兼容 Wrapper**

- 文件：`ui/ai-chat-panel.ts`（修改）
- 改动：内部调用 `mountQuickPanelShell` + `mountQuickPanelAiChatView`
- 保持现有 API 不变，确保向后兼容

**Task 1.3: 重构 Controller**

- 文件：`index.ts`（修改）
- 改动：
  - 使用 Shell 作为唯一容器
  - 默认显示 search view（空白/最近使用）
  - 支持 `setView('search' | 'chat')` 切换
  - 监听 Shell 的 `onRequestClose`

#### Phase 2: 搜索主链路

**Task 2.1: 创建搜索视图容器**

- 文件：`ui/search-view.ts`（新建）
- 职责：
  - 提供 `mountQuickPanelSearchView(options)` 函数
  - 接收 Shell 的 mount points
  - 协调 SearchInput + QuickEntries + ResultList + Footer
  - 管理 SearchEngine 实例
  - 处理搜索状态

**Task 2.2: 实现结果列表组件**

- 文件：`ui/result-list.ts`（新建）
- 职责：
  - 渲染 `SearchResult[]`
  - 选中态管理（selectedIndex）
  - 空状态/加载状态/错误状态
  - 滚动到选中项（scrollIntoView）
- 样式：复用 `.qp-*` 样式变量

**Task 2.3: 实现结果项组件**

- 文件：`ui/result-item.ts`（新建）
- 职责：
  - 渲染单个结果项
  - 图标（emoji/favicon/SVG）
  - 标题 + 副标题
  - 选中态/hover 态样式
  - 右侧快捷键提示

**Task 2.4: 注册 TabsProvider 并接入 UI**

- 文件：`ui/search-view.ts`（修改）
- 改动：
  - 创建 SearchEngine 实例
  - 注册 `createTabsProvider()`
  - 监听 SearchInput 的 `onChange`
  - 调用 `engine.schedule()` 执行搜索
  - 将结果传递给 ResultList

**Task 2.5: 实现 Footer 提示栏**

- 文件：`ui/search-footer.ts`（新建）
- 职责：
  - 显示快捷键提示：`↑↓ 导航  ↵ 选择  Tab 动作  Esc 关闭`
  - 显示当前 Scope 标签
  - 显示搜索状态

#### Phase 3: 键盘导航系统

**Task 3.1: 创建 KeyboardController**

- 文件：`core/keyboard-controller.ts`（新建）
- 职责：
  - 状态机管理：`{ view: 'search' | 'chat', subState: 'list' | 'action-panel' }`
  - 在 ShadowRoot capture 级别监听键盘事件
  - 输入控件免打扰守卫（input/textarea 焦点时不拦截字母键）
  - 快捷键映射表

**Task 3.2: 实现搜索视图键盘交互**

- 快捷键实现：
  ```
  ↑/↓       - 导航结果列表（调用 ResultList.selectPrev/selectNext）
  Enter     - 执行默认动作
  Cmd+Enter - 新标签打开（如适用）
  Tab/→     - 打开动作面板（或进入 AI Chat）
  Backspace - 返回（输入框为空时）
  Esc       - 关闭面板
  ```

**Task 3.3: AI Chat 进入逻辑**

- 场景 1：输入框空白时按 Tab → 显示 "AI Assistant" 作为特殊结果项
- 场景 2：搜索 "ai" → 结果列表显示 "AI Assistant" 入口
- 场景 3：选中 "AI Assistant" 后按 Enter → 切换到 chat view

**Task 3.4: 集成到 Controller**

- 文件：`index.ts`（修改）
- 改动：
  - 创建 KeyboardController 实例
  - 传递给 SearchView 和 ChatView
  - 在 Shell 显示时激活，隐藏时禁用

### 第一批完成标准

- [x] Shell 作为唯一容器工作
- [x] 搜索框可输入并搜索标签页
- [x] 结果列表正确显示标签页
- [x] ↑↓ 键可导航结果列表
- [x] Enter 可切换到选中标签页
- [x] Tab 或搜索 "ai" 可进入 AI Chat
- [x] Esc 关闭面板
- [x] 现有 AI Chat 功能无回归

---

## 十、技术实现细节

### 10.1 AI Chat View 拆分细节

**需要从 `ai-chat-panel.ts` 剥离的"容器逻辑"**（迁移到 Shell + Controller）：

- Overlay/Panel 创建：`:272`, `:277`
- Backdrop click 关闭：`:934`
- Close button：`:943`
- 全局 ESC 关闭：`:974`

**需要保留在 Chat View 的"内容逻辑"**：

- 消息渲染与 streaming 更新
- Composer（banner/textarea/actionBtn）
- 发送/取消请求
- Context 收集
- Textarea auto-resize

**滚动处理**：

- 使用 Shell 的 `elements.content` 作为唯一 scroll container
- Chat View 的 `emptyEl`/`messagesEl` 直接挂到 `contentChatMount`
- `createQuickPanelMessageRenderer({ scrollContainer })` 传入 `shellElements.content`

**视图切换时的滚动处理**：

```typescript
// shell.onViewChange
if (view === 'chat') {
  // 有消息时滚动到底部，否则 scrollTop = 0
  if (hasMessages) renderer.scrollToBottom();
  else shellElements.content.scrollTop = 0;
} else if (view === 'search') {
  shellElements.content.scrollTop = 0;
}
```

### 10.2 SearchInput 集成方式

现有 API（`ui/search-input.ts:141`）：

```typescript
const searchInput = createSearchInput({
  container: shellElements.headerSearchMount,
  initialScope: 'all',
  placeholder: 'Search tabs, bookmarks, commands...',
  autoFocus: true,
  availableScopes: ['all', 'tabs', 'commands'], // Phase 1 可用
  onChange: ({ scope, query }) => {
    searchEngine.schedule({ scope, query });
  },
});
```

**无需修改**，直接可用。

### 10.3 QuickEntries 集成方式

现有 API（`ui/quick-entries.ts:72`）：

```typescript
const quickEntries = createQuickEntries({
  container: shellElements.contentSearchMount,
  scopes: ['tabs', 'bookmarks', 'history', 'commands'],
  onSelect: (scope) => {
    searchInput.setScope(scope);
    searchInput.focus();
  },
});

// Phase 1 只有 tabs，禁用其他
quickEntries.setDisabled('bookmarks', true);
quickEntries.setDisabled('history', true);
// commands 可以保留（用于 AI 入口）
```

### 10.4 结果列表样式（需新增）

在 `ui/styles.ts` 新增以下 CSS 类：

```css
/* 结果列表容器 */
.qp-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 结果项 */
.qp-result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--ac-radius-inner);
  cursor: pointer;
  transition: background 0.15s;
}

.qp-result:hover {
  background: var(--qp-input-bg);
}

.qp-result[data-selected='true'] {
  background: var(--ac-accent-subtle);
}

/* 结果图标 */
.qp-result-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

/* 结果内容 */
.qp-result-content {
  flex: 1;
  min-width: 0;
}

.qp-result-title {
  font-size: 13px;
  color: var(--ac-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qp-result-subtitle {
  font-size: 11px;
  color: var(--ac-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 结果右侧提示 */
.qp-result-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--ac-text-subtle);
}
```

### 10.5 KeyboardController 状态机

```typescript
interface KeyboardState {
  view: 'search' | 'chat';
  subState: 'idle' | 'results' | 'action-panel';
  selectedIndex: number;
}

// 快捷键映射
const SEARCH_VIEW_KEYS = {
  ArrowUp: 'selectPrev',
  ArrowDown: 'selectNext',
  Enter: 'executeDefault',
  'Meta+Enter': 'executeInNewTab',
  Tab: 'openActionPanel',
  Escape: 'close',
  Backspace: 'backOrClear', // 输入框空时返回
};

// 输入控件守卫
function shouldIgnoreKey(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement;
  const isInput =
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

  // 在输入控件中，只拦截导航键，不拦截字母键
  if (isInput) {
    return !['ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'Tab'].includes(e.key);
  }
  return false;
}
```

### 10.6 AI Chat 入口实现

**作为特殊搜索结果**：

```typescript
// 在 SearchView 中注入 AI 入口
function injectAiEntry(results: SearchResult[], query: string): SearchResult[] {
  // 场景 1: 空查询时显示 AI 入口
  // 场景 2: 查询包含 "ai" 时显示
  const shouldShowAi = query.trim() === '' || query.toLowerCase().includes('ai');

  if (shouldShowAi) {
    results.push({
      id: '__ai_assistant__',
      provider: 'system',
      title: 'AI Assistant',
      subtitle: 'Chat with AI about this page',
      icon: '✨',
      data: { type: 'ai-entry' },
      score: query.toLowerCase().includes('ai') ? 100 : 50,
    });
  }

  return results;
}

// 执行动作时检查
function executeResult(result: SearchResult): void {
  if (result.id === '__ai_assistant__') {
    shell.setView('chat');
    return;
  }
  // ... 正常执行 provider 动作
}
```

---

## 十一、实施顺序建议

为确保增量可测试，建议按以下顺序实施：

```
Phase 1.1 → Phase 1.2 → Phase 1.3 → 测试 AI Chat 无回归 ✅
    ↓
Phase 2.5 → Phase 2.2 → Phase 2.3 → Phase 2.1 → Phase 2.4 → 测试搜索链路 ✅
    ↓
Phase 3.1 → Phase 3.2 → Phase 3.3 → Phase 3.4 → 测试键盘导航 ✅
    ↓
Phase 4 → 测试动作面板 ✅
    ↓
Phase 5 → 测试 Bookmarks/History/Commands Providers ✅
    ↓
Phase 6 → 测试使用历史追踪 ✅
```

**解释**：

- Phase 1 必须按顺序（先拆分 View，再改 wrapper，最后改 Controller）
- Phase 2 先做 Footer（简单），再做列表组件，最后组装
- Phase 3 必须在 Phase 2 完成后才能测试

---

## 十二、实施记录

### Phase 1-3 实施记录 (2025-12-30)

#### 新建文件

| 文件                          | 说明                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| `ui/ai-chat-view.ts`          | AI Chat 作为可嵌入的 View 组件，不创建 overlay             |
| `ui/search-view.ts`           | 搜索视图容器，协调 SearchInput + QuickEntries + ResultList |
| `core/keyboard-controller.ts` | 键盘控制器，ShadowRoot capture 级别，IME 兼容              |

#### 修改文件

| 文件                  | 修改内容                                                                     |
| --------------------- | ---------------------------------------------------------------------------- |
| `ui/ai-chat-panel.ts` | 改为 Shell + View 的 wrapper，保持 API 兼容                                  |
| `ui/styles.ts`        | 新增搜索相关 CSS 样式，修复 `--ac-text-danger`                               |
| `index.ts`            | Controller 重构使用 Shell，集成 SearchEngine/TabsProvider/KeyboardController |

#### Codex Review 修复记录

| 问题                       | 修复                                             |
| -------------------------- | ------------------------------------------------ |
| Result execution broken    | 通过 `provider.getActions(result)` 查找 provider |
| Icon typing mismatch       | 支持 `string \| Node`，favicon 优先显示          |
| Loading state not rendered | 设置 loading 后立即调用 `renderResults()`        |
| CSS undefined token        | `--ac-text-danger` → `--ac-danger`               |
| IME composition            | 添加 `event.isComposing` 守卫                    |
| Stale search results       | 清除查询时调用 `searchEngine.cancelActive()`     |
| Results during loading     | 设置 loading 时清空 `results[]` 防止执行旧结果   |
| Favicon priority           | 优先显示 `data.favIconUrl`，失败回退到 `icon`    |

#### 架构决策

| 决策           | 说明                                                         |
| -------------- | ------------------------------------------------------------ |
| Shell 唯一容器 | 解决双 overlay 冲突，统一管理 search/chat 视图               |
| View 可嵌入    | AI Chat View 不创建 overlay，渲染到 mount points             |
| 资源持久化     | SearchEngine/AgentBridge 跨 show/hide 持久化，支持缓存和会话 |
| 键盘分层       | KeyboardController 在 ShadowRoot capture 级别，守卫输入控件  |

---

### Phase 4 实施记录 (2025-12-30)

#### 新建文件

| 文件                 | 说明                                 |
| -------------------- | ------------------------------------ |
| `ui/action-panel.ts` | 动作面板组件，显示结果的可用操作列表 |

#### 修改文件

| 文件                                     | 修改内容                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common/message-types.ts`                | 新增 `QUICK_PANEL_TAB_SET_PINNED` 和 `QUICK_PANEL_TAB_SET_MUTED` 消息类型及对应的 Payload/Response 接口                                                                                           |
| `background/quick-panel/tabs-handler.ts` | 新增 `handleSetPinned` 和 `handleSetMuted` 处理函数，注册消息监听器                                                                                                                               |
| `providers/tabs-provider.ts`             | 扩展 `TabsSearchResultData` 增加 `audible/muted` 字段；新增 `writeToClipboard` 和 `formatMarkdownLink` 辅助函数；扩展 `getActions` 返回完整动作列表（Switch/CopyURL/CopyMarkdown/Pin/Mute/Close） |
| `ui/search-view.ts`                      | 集成 ActionPanel；新增 `onGetActions/onActionExecute` 选项；扩展 Manager API（openActionPanel/closeActionPanel/isActionPanelOpen/actionPanelSelectPrev/Next/ExecuteSelected）                     |
| `ui/styles.ts`                           | 新增动作面板 CSS 样式（.qp-action-backdrop/.qp-action-panel/.qp-action-header/.qp-action-list/.qp-action-item）                                                                                   |
| `core/keyboard-controller.ts`            | 新增 `isActionPanelOpen/onCloseActionPanel/onActionPanelNavigateUp/Down/Select` 选项；ArrowLeft/ArrowRight 条件拦截；新增 `handleActionPanelKey` 处理函数                                         |
| `index.ts`                               | 连接 KeyboardController 与 SearchView 的动作面板方法；传递 `onGetActions` 回调获取 provider actions                                                                                               |

#### 动作面板功能

| 动作 ID             | 标题             | 快捷键      | 说明                                         |
| ------------------- | ---------------- | ----------- | -------------------------------------------- |
| `tabs.activate`     | Switch to tab    | Enter       | 切换到标签页                                 |
| `tabs.copyUrl`      | Copy URL         | Cmd+C       | 复制 URL 到剪贴板                            |
| `tabs.copyMarkdown` | Copy as Markdown | Cmd+Shift+C | 复制为 Markdown 链接                         |
| `tabs.pin/unpin`    | Pin/Unpin tab    | Cmd+P       | 固定/取消固定标签页                          |
| `tabs.mute/unmute`  | Mute/Unmute tab  | Cmd+M       | 静音/取消静音（仅对 audible/muted 标签显示） |
| `tabs.close`        | Close tab        | Cmd+W       | 关闭标签页（danger 样式）                    |

#### 键盘交互

| 按键  | 结果列表模式 | 动作面板模式 |
| ----- | ------------ | ------------ |
| ↑/↓   | 导航结果列表 | 导航动作列表 |
| Tab/→ | 打开动作面板 | 关闭动作面板 |
| Enter | 执行默认动作 | 执行选中动作 |
| Esc   | 关闭面板     | 关闭动作面板 |
| ←     | -            | 关闭动作面板 |

#### 架构决策

| 决策                     | 说明                                                    |
| ------------------------ | ------------------------------------------------------- |
| 动作面板作为子模式       | 动作面板是 SearchView 的内部状态，不是独立的 Shell view |
| ESC 语义分层             | Esc 先关闭动作面板，再关闭 Quick Panel                  |
| ArrowLeft/Right 条件拦截 | 仅当动作面板打开时拦截，否则让输入框处理光标移动        |
| 动作执行后关闭面板       | 执行任何动作后自动关闭 Quick Panel                      |

---

### Phase 5 实施记录 (2025-12-31)

#### 新建文件

| 文件                                              | 说明                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `providers/provider-utils.ts`                     | 共享工具函数：writeToClipboard, formatMarkdownLink, computeWeightedTokenScore |
| `providers/bookmarks-provider.ts`                 | 书签搜索 Provider，优先级 20，包含在 'all' scope                              |
| `providers/history-provider.ts`                   | 历史搜索 Provider，优先级 10，包含在 'all' scope                              |
| `providers/commands-provider.ts`                  | 命令 Provider，优先级 0，不包含在 'all' scope（需 '>' 前缀）                  |
| `background/quick-panel/bookmarks-handler.ts`     | 书签查询后台处理                                                              |
| `background/quick-panel/history-handler.ts`       | 历史查询后台处理                                                              |
| `background/quick-panel/page-commands-handler.ts` | 页面命令和 URL 打开后台处理                                                   |

#### 修改文件

| 文件                         | 修改内容                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `common/message-types.ts`    | 新增 `QUICK_PANEL_BOOKMARKS_QUERY`、`QUICK_PANEL_HISTORY_QUERY`、`QUICK_PANEL_OPEN_URL`、`QUICK_PANEL_PAGE_COMMAND` 消息类型及接口 |
| `providers/tabs-provider.ts` | 重构使用 provider-utils.ts 中的共享工具函数                                                                                        |
| `providers/index.ts`         | 导出新增的 bookmarks/history/commands provider                                                                                     |
| `background/index.ts`        | 注册新的后台处理器                                                                                                                 |
| `index.ts`                   | 注册所有 provider 到 SearchEngine，更新 availableScopes                                                                            |

#### 消息类型

| 消息类型                      | Payload                 | Response                 | 说明                                           |
| ----------------------------- | ----------------------- | ------------------------ | ---------------------------------------------- |
| `QUICK_PANEL_BOOKMARKS_QUERY` | `{ query, maxResults }` | `{ success, bookmarks }` | 书签搜索                                       |
| `QUICK_PANEL_HISTORY_QUERY`   | `{ query, maxResults }` | `{ success, items }`     | 历史搜索                                       |
| `QUICK_PANEL_OPEN_URL`        | `{ url, disposition }`  | `{ success }`            | 打开 URL（current_tab/new_tab/background_tab） |
| `QUICK_PANEL_PAGE_COMMAND`    | `{ command }`           | `{ success }`            | 执行页面命令                                   |

#### 命令列表

| 命令 ID            | 标题             | 说明                 |
| ------------------ | ---------------- | -------------------- |
| `page.reload`      | Reload           | 刷新当前页面         |
| `page.back`        | Back             | 历史后退             |
| `page.forward`     | Forward          | 历史前进             |
| `page.stop`        | Stop             | 停止加载             |
| `tab.close`        | Close tab        | 关闭当前标签页       |
| `tab.duplicate`    | Duplicate tab    | 复制当前标签页       |
| `tab.togglePin`    | Toggle pin       | 切换固定状态         |
| `tab.toggleMute`   | Toggle mute      | 切换静音状态         |
| `copy.url`         | Copy URL         | 复制当前页面 URL     |
| `copy.markdown`    | Copy as Markdown | 复制为 Markdown 链接 |
| `window.newTab`    | New tab          | 新建标签页           |
| `window.newWindow` | New window       | 新建窗口             |

#### 架构决策

| 决策                      | 说明                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| Commands 不在 'all' scope | 用户需用 '>' 前缀显式进入命令模式，避免干扰搜索                   |
| 默认动作为当前标签页      | Bookmarks/History 默认在当前标签页打开，符合用户直觉              |
| 共享工具函数              | 提取 clipboard/markdown/scoring 到 provider-utils.ts，DRY 原则    |
| Provider 优先级           | tabs(50) > bookmarks(20) > history(10) > commands(0)，tabs 最重要 |
| 评分公式统一              | 所有 provider 使用 computeWeightedTokenScore，确保一致的搜索体验  |

#### Codex Review 修复记录 (2025-12-31)

| 问题                          | 修复                                  |
| ----------------------------- | ------------------------------------- |
| writeToClipboard 无 fallback  | 现代 API 失败时正确回退到 execCommand |
| formatMarkdownLink URL 不完整 | URL 中的 `()` 现在正确 percent-encode |
| URL 安全验证缺失              | 阻止 javascript:, data: 等危险 scheme |
| maxResults 无上限             | 后台处理器限制最大 500 条防止过载     |

---

### Phase 6 实施记录 (2025-12-31)

#### 新建文件

| 文件                      | 说明                                                     |
| ------------------------- | -------------------------------------------------------- |
| `core/usage-key.ts`       | 使用键生成规则：`url:<origin+path>` 或 `cmd:<commandId>` |
| `core/history-tracker.ts` | 使用历史追踪器，频次算法：`30*recency + 10*frequency`    |

#### 修改文件

| 文件                | 修改内容                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `ui/search-view.ts` | 集成 HistoryTracker；新增 `refreshRecentList` 空查询显示最近使用；新增 `applyUsageBoost` 频次排序 |
| `index.ts`          | 添加 `ensureHistoryTracker` 函数；`recordResultUsage` 记录使用；传递 historyTracker 到 SearchView |

#### 关键设计决策

| 决策                  | 说明                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- |
| 隐私优先的 URL 归一化 | 仅保留 `origin + pathname`，剥离 query/hash/credentials，仅追踪 http/https                   |
| 频次算法              | `recency = exp(-ageHours * ln(2) / 72)`（3天半衰期），`frequency = log1p(count) / log1p(30)` |
| 最大 boost 分数       | 40 分（30 分 recency + 10 分 frequency）                                                     |
| 存储机制              | ~~`chrome.storage.local`~~ → **IndexedDB**（Phase 6.1 迁移），最大 500 条，LRU 淘汰          |
| 最佳努力原则          | 追踪失败不影响核心搜索体验                                                                   |

#### Codex Review 修复记录 (2025-12-31)

| 问题                        | 修复                                                            |
| --------------------------- | --------------------------------------------------------------- |
| Flush 写入丢失              | 等待 in-flight flush 完成后重新检查 dirty；失败后重新调度 flush |
| URL 隐私泄露                | 剥离 query string（常含敏感 token/ID），仅追踪 http/https 协议  |
| applyUsageBoost 失败破坏 UX | 添加 try-catch，失败时返回原始结果                              |
| 异步竞态条件                | 在 applyUsageBoost 后再次检查 staleness                         |
| 文档注释不准确              | 修正 frecency 公式注释中的 half-life 实现说明                   |

#### 频次算法详解

```typescript
// Recency: 指数衰减，半衰期 72 小时（3天）
// 使用后 3 天，recency ≈ 0.5
// 使用后 1 周，recency ≈ 0.25
recency = exp((-ageHours * ln(2)) / halfLifeHours);

// Frequency: 对数增长，上限 30 次
// count=1 → 0.21, count=5 → 0.53, count=30 → 1.0
frequency = log1p(count) / log1p(countCap);

// Boost: 总分 0-40
// recency 权重 3 倍于 frequency，强调"最近使用"
boost = 30 * recency + 10 * frequency;
```

#### 使用示例

```typescript
// 记录使用
const usageKey = computeUsageKey(result); // "url:https://example.com/page"
await historyTracker.recordUsage(usageKey);

// 获取频次信号
const signals = await historyTracker.getSignals(['url:https://example.com/page']);
const signal = signals.get('url:https://example.com/page');
// { lastUsedAt: 1704000000000, count: 5, recency: 0.87, frequency: 0.53, boost: 31.4 }

// 获取最近使用列表（空查询时显示）
const recentItems = await historyTracker.getRecentList(20);
```

---

### Phase 6.1 IndexedDB 迁移记录 (2025-12-31)

#### 背景

原 Phase 6 实现使用 `chrome.storage.local` 存储使用历史，存在并发写入问题：

- chrome.storage.local 需要完整对象写入（无增量更新）
- 多标签页同时写入会导致数据丢失（后写覆盖先写）
- 防抖机制可缓解但无法完全解决

#### 解决方案

迁移到 IndexedDB + 消息桥模式：

- IndexedDB 在 Background Service Worker 中运行（extension-origin）
- 每个 key 独立 readwrite 事务，避免并发覆盖
- Content scripts 通过 `chrome.runtime.sendMessage` 调用
- 自动从 chrome.storage.local 迁移数据
- 失败时回退到 chrome.storage.local

#### 新建文件

| 文件                                              | 说明                                        |
| ------------------------------------------------- | ------------------------------------------- |
| `background/quick-panel/usage-history-handler.ts` | IndexedDB 后台处理器，含迁移逻辑和 fallback |

#### 修改文件

| 文件                      | 修改内容                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `common/message-types.ts` | 新增 `QUICK_PANEL_USAGE_RECORD`、`QUICK_PANEL_USAGE_GET_ENTRIES`、`QUICK_PANEL_USAGE_LIST_RECENT` 消息类型及接口 |
| `core/history-tracker.ts` | 重写为消息桥客户端，移除本地存储逻辑，保留 frecency 计算                                                         |
| `background/index.ts`     | 注册 `initQuickPanelUsageHistoryHandler`                                                                         |

#### IndexedDB Schema

```typescript
// 数据库
const DB_NAME = 'quick_panel_usage';
const DB_VERSION = 1;

// 对象存储
const STORE = 'usage';
// 复合主键: [namespace, key]

// 索引
const IDX_NAMESPACE_LAST_USED_AT = 'namespace_lastUsedAt'; // 最近使用列表
const IDX_NAMESPACE_LAST_USED_AT_COUNT = 'namespace_lastUsedAt_count'; // LRU 淘汰

// 记录结构
interface UsageEntryRecord {
  namespace: string;
  key: string;
  lastUsedAt: number;
  count: number;
}

// 迁移标记
interface UsageMetaRecord {
  namespace: string;
  key: '__meta__';
  schemaVersion: 1;
  migratedAt: number;
  legacyUpdatedAt: number;
}
```

#### 消息协议

| 消息类型                        | Payload                          | Response               | 说明         |
| ------------------------------- | -------------------------------- | ---------------------- | ------------ |
| `QUICK_PANEL_USAGE_RECORD`      | `{ namespace, key, maxEntries }` | `{ success }`          | 记录使用事件 |
| `QUICK_PANEL_USAGE_GET_ENTRIES` | `{ namespace, keys }`            | `{ success, entries }` | 批量获取条目 |
| `QUICK_PANEL_USAGE_LIST_RECENT` | `{ namespace, limit }`           | `{ success, items }`   | 最近使用列表 |

#### 架构决策

| 决策                       | 说明                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| Background-owned IndexedDB | Content script 的 indexedDB 是 page-origin 作用域，无法跨页面共享  |
| Per-key readwrite 事务     | 避免并发写入导致的数据覆盖，每次操作只锁定单个 key                 |
| 迁移标记 (**meta**)        | 使用特殊 key 标记迁移完成，防止重复迁移                            |
| 错误传播迁移读取           | `readLegacyStoreForMigration` 不吞异常，防止读取失败时误标记已迁移 |
| Legacy fallback            | IndexedDB 失败时自动回退到 chrome.storage.local                    |
| 客户端 key 限制            | `getSignals` 客户端限制 2000 keys，减少无效 IPC                    |

#### Codex Review 修复记录 (2025-12-31)

| 问题                     | 修复                                                        |
| ------------------------ | ----------------------------------------------------------- |
| 迁移读取失败被吞掉       | 新增 `readLegacyStoreForMigration` 函数，传播错误防止误标记 |
| 大型 legacy 存储阻塞迁移 | 迁移前检查 size，超过 MAX_ENTRIES_HARD_CAP 则先截断         |
| 负数 lastUsedAt 破坏索引 | legacy 解析和 IDB 写入时 clamp 到 >= 0                      |
| 损坏记录导致 NaN 传播    | `recordUsageInIdb` 使用 clampInt 处理 existing count        |
| 客户端发送过多 keys      | `getSignals` 添加 `.slice(0, MAX_KEYS_PER_REQUEST)`         |
| IDB 范围边界不够宽       | `IDB_NUMBER_MIN/MAX` 改用 `Number.MIN/MAX_SAFE_INTEGER`     |

#### 数据流

```
┌─────────────────┐      sendMessage       ┌──────────────────────┐
│  Content Script │  ─────────────────────▶│  Background Worker   │
│  HistoryTracker │                        │  usage-history-handler│
│                 │  ◀─────────────────────│                      │
│  (frecency calc)│      response          │  ┌────────────────┐  │
└─────────────────┘                        │  │   IndexedDB    │  │
                                           │  │ quick_panel_   │  │
                                           │  │ usage          │  │
                                           │  └────────────────┘  │
                                           │         │            │
                                           │         ▼ fallback   │
                                           │  ┌────────────────┐  │
                                           │  │chrome.storage  │  │
                                           │  │.local (legacy) │  │
                                           │  └────────────────┘  │
                                           └──────────────────────┘
```
