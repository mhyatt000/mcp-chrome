# 录制系统数据/状态流（Mermaid）

本文件提供录制端到端数据流与完整时序图。消息名与代码一致：

- 后台入口：`RR_START_RECORDING` / `RR_STOP_RECORDING`
- 控制下发：`RR_RECORDER_CONTROL`（`cmd: 'start'|'stop'|'pause'|'resume'`）
- 事件上报：`RR_RECORDER_EVENT`
- 探活：`rr_recorder_ping`

## 数据流（全局）

```mermaid
flowchart TD
  %% 参与者
  P[弹窗 Popup]
  B[[后台 Service Worker\n录制管理器 RecordingManager]]
  S[(本地存储\nRR_RECORDING_STATE)]
  INJ[[注入器\nregisterContentScripts / ensureRecorderInjected]]
  FS[(流程存储 Flow Store\nsaveFlow/listFlows)]

  subgraph TAB[当前活动标签页]
    direction TB
    subgraph CMain[内容脚本（主框架 Main Frame）]
      AGG[聚合器 Aggregator\n收集/批量上报 RR_RECORDER_EVENT\n渲染录制浮窗]
    end
    subgraph CChild[内容脚本（子框架 Frames）]
      COL[事件采集 Collectors\n点击/输入/滚动/键盘...]
    end
  end

  API[[浏览器 API\ntabs/webNavigation/windows]]

  %% 启动
  P -- RR_START_RECORDING(meta) --> B
  B -- 写入 {active:true, sessionId} --> S
  B -- 一次性注册/兜底注入 --> INJ
  B -- ping(rr_recorder_ping)/注入 --> INJ
  INJ -- executeScript(recorder.js) --> TAB

  %% 控制
  B -- RR_RECORDER_CONTROL{cmd:'start', sessionId} --> AGG
  B -- RR_RECORDER_CONTROL{cmd:'pause'|'resume'} --> AGG
  B -- RR_RECORDER_CONTROL{cmd:'stop'} --> AGG

  %% 子框架 → 主框架
  COL -- window.top.postMessage(rr:dom-event) --> AGG

  %% 主框架 → 后台
  AGG -- RR_RECORDER_EVENT(批量步骤) --> B

  %% 浏览器级事件
  API -- 新建/切换/关闭/导航/SPA --> B
  B -- 归并为 BrowserEvent --> B

  %% 会话缓冲（单一数据源）
  B -. 追加事件 .-> B
  B:::note -. RecordingSession.events .- B

  %% 停止
  P -- RR_STOP_RECORDING --> B
  B -- RR_RECORDER_CONTROL{cmd:'stop'} --> AGG
  B -- events → Flow 合成 --> FS
  B -- 写入 {active:false} --> S

  classDef note fill:#f6f8fa,stroke:#c9d1d9,color:#333;
```

备注

- 优先使用 `registerContentScripts(allFrames, matchAboutBlank, document_start)` 常驻注入，`ensureRecorderInjected` 兜底。
- 仅主框架渲染录制浮窗；子框架只采集事件并通过 `postMessage` 上报主框架。
- 后台为唯一权威数据源：统一写入 `RecordingSession.events`。
- 停止时合成 Flow 保存，并清理 `RR_RECORDING_STATE`。

## 录制时序（完整）

```mermaid
sequenceDiagram
  autonumber
  participant 弹窗 as 弹窗(Popup)
  participant 后台 as 后台/录制管理器(RecordingManager)
  participant 存储 as 本地存储(RR_RECORDING_STATE)
  participant 注入 as 注入器(register/ensure)
  participant 主框架 as 内容脚本-主框架(Main)
  participant 子框架 as 内容脚本-子框架(Frames)
  participant 浏览器 as 浏览器API(tabs/webNavigation)
  participant 流程库 as 流程存储(Flow Store)

  rect rgb(245,248,255)
    note over 弹窗,后台: 开始录制
    弹窗->>后台: RR_START_RECORDING(meta)
    后台->>存储: set {active:true, sessionId}
    后台->>注入: registerContentScripts(一次) / ping→inject(兜底)
    注入-->>主框架: recorder.js 可用（含 overlay/采集/聚合）
    注入-->>子框架: recorder.js 可用（仅采集）
    后台->>主框架: RR_RECORDER_CONTROL{cmd:'start', sessionId, meta}
    主框架->>主框架: 重置会话/挂监听/显示浮窗
    主框架-->>后台: RR_RECORDER_EVENT{kind:'start', meta?}
  end

  rect rgb(255,253,245)
    note over 子框架,主框架: 采集与聚合
    子框架-->>主框架: postMessage(rr:dom-event: 点击/输入/滚动...)
    主框架->>主框架: 生成/更新选择器, 批量缓冲
    主框架->>后台: RR_RECORDER_EVENT{steps:[] 批量}
    后台->>后台: 事件去重+写入 RecordingSession.events
  end

  rect rgb(245,255,248)
    note over 浏览器,后台: 浏览器级事件与切换
    浏览器-->>后台: tabs.onActivated / windows.onFocusChanged
    alt 新激活tab可注入
      后台->>主框架: RR_RECORDER_CONTROL{cmd:'pause'}（旧tab隐藏浮窗）
      后台->>主框架: RR_RECORDER_CONTROL{cmd:'start'}（新tab显示浮窗）
      主框架-->>后台: RR_RECORDER_EVENT{kind:'browser', type:'TAB_SWITCH', url}
    else 不可注入
      后台-->>弹窗: 提示“当前tab不支持录制”
      note over 后台: 状态=WaitingForValidTab，等待用户切换
    end
  end

  rect rgb(245,245,255)
    note over 浏览器,后台: 刷新/导航/SPA 续作
    浏览器-->>后台: onCommitted/onCompleted/onHistoryStateUpdated
    note over 后台: 若最近5秒内发生点击，自动为其标记 after.waitForNavigation
    后台->>主框架: RR_RECORDER_CONTROL{cmd:'start'}（同一 sessionId 续作）
    主框架->>主框架: 重新挂监听/保持浮窗
  end

  rect rgb(255,245,245)
    note over 主框架,后台: 新开标签页（_blank）
    主框架->>主框架: 识别 <a target="_blank">
    主框架-->>后台: RR_RECORDER_EVENT{openTab, switchTab}
    浏览器-->>后台: tabs.onCreated/onActivated
    后台->>后台: 追加 BrowserEvent
  end

  rect rgb(250,250,250)
    note over 弹窗,主框架: 暂停/继续
    弹窗->>后台: 用户点击“暂停/继续”
    后台->>主框架: RR_RECORDER_CONTROL{cmd:'pause'|'resume'}
    主框架->>主框架: 更新浮窗文案/监听状态
  end

  rect rgb(240,250,245)
    note over 弹窗,流程库: 停止与归档
    弹窗->>后台: RR_STOP_RECORDING
    后台->>主框架: RR_RECORDER_CONTROL{cmd:'stop'}（广播全部登记帧）
    主框架-->>后台: ack（最佳努力）
    后台->>后台: RecordingSession.events → Flow 合成
    后台->>流程库: saveFlow(flow)
    后台->>存储: set {active:false}
    后台-->>弹窗: 返回结果/统计
  end

  rect rgb(252,248,252)
    note over 后台,主框架: Service Worker 休眠/重启（可选流程）
    后台->>存储: 读取 RR_RECORDING_STATE
    alt active==true
      note over 后台: 防脏：先广播 stop 清理浮窗
      后台->>主框架: RR_RECORDER_CONTROL{cmd:'stop'}
      opt 需要自动恢复
        后台->>主框架: RR_RECORDER_CONTROL{cmd:'start'}（同 sessionId）
      end
    else 未在录制
      note over 后台: 保持 Idle
    end
  end
```

提示

- 探活优先：`rr_recorder_ping` 成功则复用现有脚本，仅切换监听态；失败再注入。
- 不可注入页面：启动失败不记录起始 URL，只提示并等待可注入页面建立起点。
- 自动导航标注：后台在最近点击后短时内捕获导航，自动为该点击标记 `after.waitForNavigation = true`。
