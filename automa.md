# Automa 块能力对比与 mcp‑chrome 实现差异

## 背景

- 目标：你的录制回放与可视化编排能力需至少达到 Automa 的水准，并与现有 MCP 工具体系打通（动态工具发布/调用）。
- 对比范围：
  - Automa：以 `other/automa/src/utils/shared.js` 中列出的全部块为基准，并参考 `content/blocksHandler/*` 与 `workflowEngine/*` 的实现。
  - 本项目（下称“本实现”）：以 `app/chrome-extension/entrypoints/background/record-replay` 的 Runner/Registry、`tools/browser/*` 工具、`inject-scripts/*` 与 Builder 节点为准。

## 总体结论

- 本实现在线上稳定性与底层能力上已总体领先：
  - 定位与回退：优先 ref，候选（css/attr/aria/text/xpath）自动回退并记录 fallback。
  - 导航与等待：点击后自动富化 `waitForNavigation`，支持 `onHistoryStateUpdated` + 网络空闲兜底；失败截图统一收口。
  - CDP 驱动：键盘/鼠标/拖拽/文件上传/截图等走 CDP，稳定性优于仅 DOM 注入方案。
  - 工具化：可发布为 MCP 动态工具。
- 体验层（专用块）的差距主要在“有用的小块”未显式提供：如 screenshot 节点、trigger event、set attribute、loop elements、switch frame（同源）、下载处理、Dataset 轻量版等。这些可在现有工具之上快速补齐。

## 逐项对比（不漏项）

说明：每项包含「Automa 块」→「本实现情况」→「结论」→「建议」。

### Browser 类

- New tab / Switch tab / Close tab / New window（`new-tab`/`switch-tab`/`close-tab`/`new-window`）

  - 本实现：节点 `openTab/switchTab/closeTab` + `navigate` 支持新窗口与尺寸。
  - 结论：已覆盖，且更稳。
  - 建议：无。

- Go back / Go forward / Reload tab（`go-back`/`forward-page`/`reload-tab`）

  - 本实现：`goBackOrForwardTool` 与 `navigate.refresh` 可替代；编辑器无按钮。
  - 结论：功能可替代。
  - 建议：补“返回/前进/刷新”迷你节点（UX）。

- Take screenshot（`take-screenshot`）

  - 本实现：已有 `screenshot` 工具（整页/元素/拼接/缩放），回放失败自动截图。
  - 结论：能力≥Automa，但缺“截图节点”。
  - 建议：新增“截图”节点（支持保存到变量/下载）。

- Browser event（`browser-event`）

  - 本实现：`wait` 支持 navigation/networkIdle/text/selector；覆盖常用浏览器事件等待。
  - 结论：功能可替代。
  - 建议：可新增“浏览器事件等待”节点壳，统一表述。

- Handle dialog（`handle-dialog`）

  - 本实现：`chrome_handle_dialog` 工具与节点映射已具备。
  - 结论：已覆盖，稳定性更好。
  - 建议：无。

- Handle download（`handle-download`）
  - 本实现：暂无节点，工具侧可用 `chrome.downloads` 扩展实现。
  - 结论：缺失。
  - 建议：新增“等待下载/处理下载”节点（返回 downloadId、命名冲突策略）。

### Web interaction 类

- Click / Double click（`event-click` + dblclick）

  - 本实现：`click/dblclick` 节点，ref 优先 + 候选回退 + 导航等待富化。
  - 结论：你更好（更稳）。
  - 建议：无。

- Forms（`forms`）

  - 本实现：`fill` 支持滚动/聚焦；变量占位；file 输入已自动切换 CDP 上传。
  - 结论：你更好或持平。
  - 建议：无。

- Upload file（`upload-file`）

  - 本实现：CDP `DOM.setFileInputFiles`，已打通（自动识别 input[type=file]）。
  - 结论：你更好。
  - 建议：无。

- Press key（`press-key`）

  - 本实现：`key` 节点 + `computer.key`/CDP chord/insertText。
  - 结论：你更好。
  - 建议：无。

- Hover element（`hover-element`）

  - 本实现：`computer.hover`（CDP mouseMoved）。
  - 结论：你更好。
  - 建议：无。

- Scroll element（`element-scroll`）

  - 本实现：`StepScroll` 支持 element/offset/container + 注入/CDP。
  - 结论：你更好。
  - 建议：无。

- Link（`link`）

  - 本实现：可用 `click`/`navigate`；录制端尚未针对 `target=_blank` 生成 `openTab+switchTab`。
  - 结论：功能可替代。
  - 建议：录制识别 `target=_blank` 自动产出节点组合。

- Trigger event（`trigger-event`）

  - 本实现：可用脚本/注入；无专用节点。
  - 结论：可替代。
  - 建议：新增“触发事件”节点（封装 CDP/注入）。

- Attribute value（读/写）（`attribute-value`）

  - 本实现：读→`extract(attr)`；写→需脚本。
  - 结论：读已覆盖；写缺专用块。
  - 建议：新增 `setAttribute` 节点。

- Switch frame（`switch-to`）

  - 本实现：V1 不支持 frame 切换；录制同域 iframe 聚合未做。
  - 结论：缺失。
  - 建议：新增 `switchFrame(同源)` 节点；录制聚合同域 iframe。

- Save assets（`save-assets`）
  - 本实现：可脚本/提取 URL + 原生下载；无专用节点。
  - 结论：可替代。
  - 建议：新增“收集+下载资产”小节点（便捷）。

### Control flow（条件/循环）

- Conditions / While / Delay / Repeat task（`conditions`/`while`/`delay`/`repeat-task`）

  - 本实现：`if/while/delay` 节点；`repeat-task` 可用 while/foreach 代替。
  - 结论：已覆盖（表达力更强）。
  - 建议：无。

- Loop data / Loop elements / Loop breakpoint / Wait connections（`loop-data`/`loop-elements`/`loop-breakpoint`/`wait-connections`）
  - 本实现：`foreach` + 子流；但缺`loop-elements`便捷块；断点/等待连接未提供（开发者调试向）。
  - 结论：部分缺失。
  - 建议：新增 `loopElements`（生成 selector 数组→foreach）；断点与连接等待可后置。

### Data / Network（数据与网络）

- Get text / Attribute value（`get-text`/`attribute-value`）

  - 本实现：`extract(selector/attr/js)` + `assign/saveAs`；更通用。
  - 结论：已覆盖，且更通用。
  - 建议：无。

- HTTP Request / Webhook（`http request`/`webhook`）

  - Automa：支持 `text/json/form/form-data`（含文件 URL/路径→FormData）、可回填变量/保存数据、fallback 分支。
  - 本实现：`network_request` + `assign/saveAs`；`form-data` 附件需要补参数协议（目前可通过 base64/临时文件绕行）。
  - 结论：基本覆盖；`form-data` 附件差距。
  - 建议：扩展 `network_request` 支持 `{ formData: [ [name, filePath|url, filename?], ... ] }`，交由原生宿主拉取与上传。

- Export data / Insert data / Delete data / Data mapping / Sort data / Slice/Increase/RegEx variable（数据表/变量工具族）
  - 本实现：暂无 Dataset 与批处理；脚本可替代但不友好。
  - 结论：缺失。
  - 建议：Dataset 轻量版（内存表+导出 CSV/JSON），变量小工具可按需补或提供脚本模板。

### Online services（在线服务）

- Google Sheets / Drive 等
  - 本实现：未内置 OAuth；可用 `http` + 用户 token 兜底。
  - 结论：缺失（非 MVP）。
  - 建议：后续按需求集成。

### General / Workflow（通用/工作流）

- Trigger（手动/定时/URL/快捷键/右键/DOM 观察）

  - 本实现：定时（`chrome.alarms`）与绑定（domain/path/url）；无快捷键/右键/DOM 观察。
  - 结论：部分缺失。
  - 建议：补 commands 快捷键与 contextMenus；DOM 观察谨慎评估性能与误触。

- Execute workflow / AI Workflow / Workflow State / Parameter prompt / Note / Notification

  - 本实现：子流（Flow 内部）已支持；跨 Flow 执行未做；运行前全局变量收集浮层已具备；Note/通知未做。
  - 结论：部分缺失。
  - 建议：新增 `executeFlow(flowId,args)` 节点；Note/通知与 State 可后置。

- Clipboard / Cookie / Get tab URL / Get log data / Block package / Create element
  - 本实现：剪贴板/ Cookie/URL/日志/块包/创建元素等可用脚本与工具代替，但无专用节点。
  - 结论：可替代；非核心。
  - 建议：按使用频度择优补（如 createElement/clipboard.read/write）。

## 已补强（本次提交）

- Sidebar 节点面板补全了常用节点（键盘/断言/延迟/打开/切换/关闭标签等），避免“看起来只有少数块”的错觉。
- `fill` 节点运行期自动识别 `input[type=file]` 并切换为 CDP 文件上传（稳定性显著优于注入方式）。

## 优先级与落地建议

- P0（稳定性/体验立竿见影）

  - 录制增强：同源 iframe 聚合；识别 `target=_blank` → `openTab + switchTab`。
  - 新增节点：Screenshot / TriggerEvent / SetAttribute / LoopElements / SwitchFrame(同源)。
  - 运行历史/详情页：按运行记录展示失败截图/回退信息/耗时。

- P1（常见抓取/回填闭环）

  - Dataset 轻量版（内存表 + 导出 CSV/JSON）。
  - Handle download 节点（等待/命名策略/返回 downloadId）。
  - HTTP `form-data` 附件协议支持（结合原生宿主）。

- P2（触达与生态）
  - 快捷键（commands）与右键菜单触发（结合绑定规则）。
  - Online services（Sheets/Drive）按需引入。

## 审核口径与代码定位

- Automa 块清单：`other/automa/src/utils/shared.js`
- Automa 典型 Handler：`other/automa/src/content/blocksHandler/*`、`other/automa/src/workflowEngine/blocksHandler/*`
- 本实现执行层：`app/chrome-extension/entrypoints/background/record-replay/*`（`engine/*`、`nodes/*`、`selector-engine.ts`、`rr-utils.ts`）
- 浏览器工具层：`app/chrome-extension/entrypoints/background/tools/browser/*`
- 录制/注入：`app/chrome-extension/inject-scripts/*`
- Builder 相关：`app/chrome-extension/entrypoints/popup/components/builder/*`

---

结语：
在不牺牲稳定性的前提下，仅需补齐若干“专用块的 UI 层封装”和少量录制增强，即可达到并稳超 Automa 的块级体验与编排表达力。本建议严格基于源码对齐，不夸大，不漏项，优先达成“稳定 + 易用”的目标。
