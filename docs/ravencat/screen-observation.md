# RavenCat Screen Observation

> 当前契约：Accessibility、截图与本地 OCR 各自提供一次性事实快照；`read_screen_accessibility` 与 `read_screen_ocr` 已接入正式 Host Tool。
>
> 目标：定义 RavenCat 如何理解“当前屏幕”，并明确 Extract 与 Shot 是两种不同的产品语义，不是简单的主方案与冗余兜底。

## 1. 产品语义

RavenCat 对当前屏幕有两种感知方式：

```text
Screen Observation
├─ Semantic perception
│  └─ Extract / Accessibility
│
└─ Visual perception
   └─ Shot / Screenshot + Vision
```

简化为用户语言：

```text
Extract = 读当前页面
Shot    = 看当前画面
```

它们不是互相替代关系。

当前代码 ownership 明确区分：`src/features/deviceControl` 中的 Device Observer 提供窗口与 Accessibility 技术事实；`src/features/screenCapture` 负责当前窗口安全检查、screenshot capture 与 native cache 生命周期；`src/features/companion` 决定何时、为何截图，以及截图如何进入主动上下文或 Chat attachment。底层 Accessibility 与截图实现仍可位于 `modules/device-observer`。

`read_screen_accessibility` 同样由 `screenCapture` 持有执行 ownership，并作为 `private_read`、
`idempotent`、`hostOnly` Built-in Tool 接入标准 Agent Runtime Registry。Phone Tools Catalog 只负责
将它归类为 Observation 产品能力，不复制 Runtime owner 与风险元数据。

### 1.1 Observation Snapshot Semantics

Screen Observation 提供一次性事实快照，而不是持续追踪用户当前屏幕。每次 observation 分为：

```text
1. snapshot freeze
2. snapshot consume
```

在 freeze 前必须完成可靠窗口确认、Protected Apps admission 和对应 native fence。不同感知方式的
冻结点由其事实来源决定：Accessibility 在 native 通过 expected-window start fence，并成功取得
packageName + windowId 均匹配 expected target 的 root 时冻结；Screenshot 在 bitmap 真正取得并完成
目标一致性确认时冻结。

一旦 snapshot 安全冻结，后续窗口变化不会导致系统自动刷新、重新采集、重定向到新窗口，或仅为了
freshness 作废已有结果。Accessibility traversal 只消费已经绑定的 root；需要最新状态时，由 Agent
发起新的 Tool Call。

### 1.2 OCR Observation

OCR 是 Screen Observation 的第三条感知通道：对已冻结的 screenshot bitmap 读取像素中的文字。
它不是 Vision（理解图标、人物、场景、图表），也不是 Accessibility 的兜底路径。

```text
Host read_screen_ocr Tool
↓
Screen Observation
↓
captureScreenForCurrentWindow()
↓
Protected Apps + screenshot capture fence
↓
frozen screenshot
==================
snapshot frozen
==================
↓
local bundled ML Kit OCR
↓
bounded OCR snapshot
↓
temporary screenshot release
```

正式 application API 是 `readOcrForCurrentWindow()`：

```text
readOcrForCurrentWindow()
→ captureScreenForCurrentWindow()
→ recognize frozen screenshot
→ normalize / bound
→ releaseCapturedScreen()
→ ScreenOcrSnapshot
```

OCR 的 freeze point 是 `captureScreenForCurrentWindow()` 成功返回已经通过
`DeviceScreenshotWindowFence` 的截图快照。从此以后 OCR 只消费这一张 frozen bitmap：OCR 期间用户
切窗（A → B、A → B → A）不影响本次结果，也不触发重新截图或 refresh；需要最新内容时必须重新调用。
`capturedAtEpochMs` 表达的是截图 bitmap 冻结时间，不是 OCR 完成时间；`packageName` / `windowId`
identity 全部来自该截图，禁止 OCR 完成后再次查询当前窗口。

### 1.2.1 一次性与临时截图生命周期

一次 `readOcrForCurrentWindow()` 最多发起 1 次 capture 和 1 次 OCR。`no_text` 不是 retry 条件，
OCR 失败、normalization 失败也不是。无论结果如何，都必须等 OCR 消费结束后再
`releaseCapturedScreen()`：

```text
capture
→ try OCR + normalize
→ release（success / no_text / ocr_failed / normalization failure 全部释放）
```

cleanup 失败不静默吞掉：OCR 成功但释放失败时返回 typed `snapshot_release_failed`；OCR 本身失败
同时释放失败时，保留 OCR 主失败语义，并在 error `cause` 中保留释放失败（不携带截图 URI 或屏幕
内容）。释放失败不做 retry loop。最终 `ScreenOcrSnapshot` 不暴露 screenshot URI。

### 1.2.2 Native OCR adapter

ML Kit 必须通过 Android native 执行，当前复用 `modules/device-observer` 作为 native adapter：

```text
ManagedScreenshotFile.resolve()
→ 只接受 AccessibilityScreenshotWriter 管理的 App 私有缓存 file:// 路径
→ InputImage
→ bundled ML Kit ChineseTextRecognizer（覆盖 Chinese + Latin，不并行运行第二个识别器）
→ bounded primitive OCR DTO（只有 block / line 文本）
```

`device-observer` 只是 OCR 的 native implementation adapter，不成为 OCR 产品 / 策略 owner：
Protected Apps、OCR product policy、Phone Tool、model-facing formatting 都不进入 native Device
Observer。OCR primitive 不知道 expectedWindow、当前 package、windowId fence、revision，也不允许
成为任意本地文件读取器；它也不新建 Accessibility Service。识别器一次请求创建一个、process 后立即
close，不保留全局长期对象。

当前使用 bundled 模型（`com.google.mlkit:text-recognition-chinese:16.0.1`，minSdk 要求 23），
模型在构建期静态链接，运行时不依赖 Google Play Services 下载模型，因此第一次调用不会因为模型
未下载而产生特殊空结果，也不实现 model download state / ModuleInstallClient / 网络 OCR fallback。

### 1.2.3 Bounded OCR snapshot

Native bridge 有更宽松的硬上限（1024 blocks / 4096 lines / 单行 8000 字符 / 总计 262144 字符），
只负责防止 Android 边界产生无界 payload。产品 contract 在 application 层：

```text
maxBlocks = 256
maxLines = 512
maxLineCharacters = 2000
maxTotalCharacters = 32768
```

裁剪规则 deterministic 且可观察：`truncated` + `blockLimitReached` / `lineLimitReached` /
`characterLimitReached`。native 已经发生的裁剪必须继续传播。`plainText` 由最终保留的 blocks
deterministic 生成，与 `blocks` 属于同一 bounded snapshot。normalization 只处理首尾空白、
CRLF → LF 与空 block / line 过滤，不压缩行内空白。坐标、bounding box、cornerPoints、recognized
language、confidence 等 ML Kit 原始元数据不进入 DTO。

`no_text`（识别成功但没有文字）是 SUCCESS：返回 `plainText: ''`、`blocks: []`，不 fallback 到
Accessibility，也不重截。错误 union 复用 `ScreenCaptureFailureReason`，OCR 只补充
`invalid_ocr_input`、`ocr_failed` 与 `snapshot_release_failed`。

### 1.2.4 OCR Tool 边界

当前 `read_screen_ocr` AI Tool：在 `runAsCurrentHostAuthority()` 内调用
`readOcrForCurrentWindow()`，把 bounded `ScreenOcrSnapshot` 投影成模型正文（当前 App identity、
`plainText`、`no_text` 或 truncation 状态）并保留原 snapshot 为结构化结果。Tool 不重复展开
blocks/lines、不暴露截图 URI、不在 Tool 层重做 Protected Apps / screenshot safety；未知
programmer error 不伪装成 OCR 业务失败，`snapshot_release_failed` 保留原语义。OCR 与
Accessibility 仍各自独立，不互为 fallback。

## 2. Extract

Extract 用于页面主要信息存在于可访问语义树中的场景，例如：

- 评论区；
- 文章正文；
- 聊天记录；
- 网页文本；
- 标题、按钮、列表项；
- 结构清晰的普通 Android UI。

用户点击 Extract 的含义是：

> 提取当前页面的文字和必要结构，交给 AI 使用。

因此点击 Extract 后：

- 必须优先走 Accessibility semantic extraction；
- 不应偷偷改成 screenshot；
- 不应因为文本少就自动发送截图，除非产品层未来明确增加“智能观察”模式；
- 失败应返回明确状态。

## 3. Shot

Shot 用于视觉内容本身承载信息的场景，例如：

- 图片；
- 表情包；
- 漫画；
- 视频当前帧；
- 游戏画面；
- 地图；
- 图表；
- 复杂排版；
- Canvas / OpenGL / 自定义渲染；
- Accessibility tree 无法表达的视觉语义。

用户点击 Shot 的含义是：

> 截取当前画面，让 AI 直接看。

因此：

- Shot 仍然保留为独立产品入口；
- 新增 Extract 不得删除现有 screenshot chain；
- Shot 不应被优化成“如果 Accessibility 有文字就不截图”。

## 4. 为什么 Shot 不是冗余 fallback

例如用户在小红书看到一张图片并说“你看这个”。

Accessibility 可能只能取得：

```text
标题
作者
点赞数
评论按钮
```

但用户真正指代的是图片本身。

此时 semantic extraction technically 成功，但产品上失败。

因此：

> Accessibility 与 screenshot 是语义感知和视觉感知两条通道。

只有在“系统自动选择感知方式”的业务里，screenshot 才可以作为 visual fallback。

## 5. 用户显式操作与自动观察必须分开

### 5.1 用户显式 Extract

```text
User taps Extract
→ semantic extraction only
→ success or typed failure
```

### 5.2 用户显式 Shot

```text
User taps Shot
→ screenshot capture
→ visual model input
```

### 5.3 业务观察编排

调用方选择符合产品意图的观察方式。当前两个读屏工具均按需执行，Accessibility 空文本或 OCR `no_text` 都是成功快照，不自动切换另一条通道、不重截，也不调用 Vision 兜底。Companion 的自动截图编排属于 Companion owner，不能改变用户显式 Extract / Shot 的含义。

## 6. Native Semantic Extraction

当前执行 on-demand、read-only semantic extraction。

不做：

- Accessibility click；
- gesture injection；
- 自动滚动；
- 连续后台遍历；
- 全窗口树扫描；
- 把 AccessibilityNodeInfo 长期保存；
- 为 AI 暴露原始完整 node hierarchy。

基本流程：

```text
request semantic snapshot
→ ensure Accessibility service connected
→ execute native read on main thread
→ native expected-window identity fence 确认目标尚未变化
→ 按已准入的 packageName + windowId 精确取得 application window root
================ snapshot frozen ================
→ recursively visit relevant children
→ prune / dedupe / cap
→ return semantic snapshot
```

`window_changed` 在 semantic read 中只表示 snapshot freeze 前，native 已无法把当前窗口或精确 root
绑定到已经通过隐私准入的 expected target。root 一旦成功绑定，后续 A → B 或 A → B → A 不再触发
completion-time freshness invalidation；若该 root 在消费期间真实失效，则返回 `semantic_read_failed`，
不自动重新获取最新窗口。

## 7. Result Contract

当前 Accessibility application 契约为 `ScreenSemanticSnapshot` 和 `ScreenSemanticObservationError`，见 `src/features/screenCapture/application/ScreenSemanticObservation.ts` 与 `ScreenSemanticObservationPolicy.ts`；截图错误使用 `ScreenCaptureError`，见 `ScreenCapturePolicy.ts`。成功快照包含目标 identity、采集时间、bounded nodes、plainText 与截断事实；空文字不等于读取失败。

原生异常在对应边界转为 typed failure，窗口变化、不可读 root、隐私拒绝和读取失败各有语义，不把它们压成 `string | null` 或统一“没抓到”。接口以现有类型为准，不另建旧草案的 `DeviceSemanticScreenResult`。

## 8. Semantic Element

`DeviceObserverSemanticNode` 是原生窄 DTO，application 将它规范化为 `ScreenSemanticNode`。只保留当前文本与必要交互/输入结构，不序列化整个 AccessibilityNodeInfo，不提供原始完整 node hierarchy。节点可被模型理解不代表允许点击、滚动或其他动作。

## 9. Pruning

Native reader 应做最低限度的清理：

- 跳过完全空的容器节点；
- 跳过明显不可见或无语义节点；
- 去重父子重复文本；
- 去重相邻重复节点；
- 限制最大节点数；
- 限制最大深度；
- 限制最终字符数；
- 遇到异常节点时允许局部跳过，不让整个 snapshot 崩溃。

当前 application contract 使用 256 节点、32 层、单字段 1000 字符、总字段 32768 字符的确定性上限，并通过 `truncated` 与三项 typed truncation metadata 明示裁剪。Native bridge 另有更宽的硬上限，避免 Android 边界先产生无界 payload；这些数值是当前实现参数，不是永久产品语义。

## 10. Threading

目标 root 获取与 node traversal 在 AccessibilityService 自身明确的主线程路径执行。

不要依赖 Expo AsyncFunction 当前碰巧运行在哪个线程。

调用链由 Screen Capture application 发起，经 Device Observer port 与 Expo bridge 进入 native reader；expected-window fence、目标 root 绑定与遍历在原生主线程完成，再返回不可变 DTO。不能把旧草案的函数名当作现有接口。

## 11. Privacy Policy

Screen Observation 的隐私策略必须覆盖两条通道：

```text
semantic extraction
screenshot capture
```

不能出现：

```text
Screenshot blacklist blocks app A
but Extract still reads app A text
```

因此 package 保护真值由 Phone Tools Protected Apps policy 统一持有，Screen Observation 只组合当前窗口可靠性与 observation admission。

至少考虑：

- RavenCat 自己；
- 系统设置；
- Permission Controller；
- 输入法；
- 用户黑名单；
- 明确禁止观察的 App；
- 当前窗口在采集过程中发生切换。

## 12. Native fact vs business policy

Native Device Observer 可以识别和返回事实：

```text
packageName
windowId
self app
root unavailable
no semantic text
```

业务层决定：

```text
是否允许观察该 package
是否因为 no_text 转 visual route
是否保存结果
是否允许主动伴随使用结果
```

不要把 RavenCat 业务 blacklist 硬编码进通用 node reader，除非它属于绝对系统安全边界。

## 13. Persistence

Semantic snapshot 默认是瞬时上下文，不是长期 Chat 媒体资产。

当前：

```text
Extract
→ snapshot
→ attach to current outgoing AI input / user message context
→ do not persist raw accessibility tree by default
```

如果未来需要在聊天历史中展示“当时提取的页面文字”，应另行定义用户可见的附件/上下文类型，而不是悄悄持久化原始树。

Shot 继续遵守现有截图、Chat attachment 和 MediaAsset 相关生命周期。

## 14. Model Input

模型层应允许 text 与 image 两类 screen context：

```text
Extract
→ text model input

Shot
→ image model input
```

自动观察可以组合：

```text
semantic text
+
visual image when route requires it
```

但用户显式选择时必须保持选择语义。

当前 `read_screen_accessibility` 将当前安全 `ScreenSemanticSnapshot` 原样作为结构化
`data`，同时生成确定性的模型正文：当前 App identity、`plainText`、必要交互/输入结构以及
truncation 状态。普通非交互文字节点不会在结构区再次展开；`plainText` 为空仍是成功观察，
正文明确表达 `no_text`，不会触发 OCR、截图或 Vision fallback。

## 15. Accessibility Event Strategy

当前 semantic extraction 不需要为了“能提取文字”增加持续 `TYPE_WINDOW_CONTENT_CHANGED` 或 `TYPE_VIEW_SCROLLED` 监听。

保持 on-demand：

```text
user/system requests snapshot
→ read current root
```

未来若要做持续环境感知，再单独设计：

- event debounce；
- semantic hash；
- change threshold；
- battery cost；
- privacy lifecycle。

不要把持续监听作为 Extract 的前置条件。

## 16. Diagnostics

AccessibilityService 至少记录低噪声生命周期日志：

```text
onServiceConnected
onUnbind
onDestroy
```

诊断层继续区分：

- enabled；
- connected；
- last connected/disconnected；
- last accessibility event；
- semantic read result。

日志用于 OEM 后台问题定位，不用于自动尝试重开系统授权。

## 17. OEM 掉授权

如果 OEM 在清后台后把 Accessibility 从系统设置中关闭：

- RavenCat 应明确显示 disabled；
- 可以提供设备厂商针对性的后台设置引导；
- 可以记录 service lifecycle 诊断；
- 不应假设普通 App 可以静默重新开启 Accessibility。

“提高可靠性”与“强制恢复系统授权”是两回事。

## 18. 当前代码边界

```text
modules/device-observer
→ Accessibility、窗口与 screenshot native implementation

src/features/deviceControl
→ Device Observer contract / adapter 与设备事实

src/features/phoneTools
→ Protected Apps package 真值、当前有效集合与 capability admission

src/features/screenCapture
→ 当前窗口安全检查、Accessibility semantic normalization、AI Tool、screenshot capture、native cache 生命周期

src/features/companion
→ 截图时机与理由、主动上下文、Chat attachment 编排
```

Screen Observation 不拥有 Companion 的业务策略，也不复制 Device Observer 的 native 状态源。Protected Apps 的旧持久字段由中性 Host composition 接入 Phone Tools runtime，Screen Observation 不依赖 Companion runtime 初始化。`readAccessibilitySemanticsForCurrentWindow()` 与截图复用 `assertScreenObservationWindowAllowed()`，在 native 读取前传入已经准入的 packageName + windowId；Device Observer 先用 expected-window identity fence 确认当前目标，再按 windowId 取得 root 并校验 root package。成功取得匹配 root 即完成 semantic snapshot freeze，后续只消费该 root，不再执行 completion-time identity / revision freshness check。截图的 bitmap 冻结更晚，仍由独立的 `DeviceScreenshotWindowFence` 保留 capture completion identity + revision 检查。密码节点只保留结构事实，不返回 text 或 content description。`read_screen_accessibility` 先在 Host Authority 串行边界内确认当前主理身份，再调用该 application API；typed observation error 原样映射给 Agent。Companion 只消费已建立的能力，不重新实现当前窗口安全检查。

OCR observation foundation（`readOcrForCurrentWindow()`）位于同一 application 层，直接复用 `captureScreenForCurrentWindow()` / `releaseCapturedScreen()`，不复制 current window detection、Protected Apps check、screenshot permission check、expected-window fence 或 screenshot cache；native 侧只通过 `recognizeDeviceObserverScreenshotText(uri)` 消费托管截图，且该入口只接受 `AccessibilityScreenshotWriter` 管理的缓存路径（删除与 OCR 共用 `ManagedScreenshotFile` 校验）。

## 19. Acceptance Examples

```text
普通文章
→ Extract: ok + readable text
```

```text
评论区
→ Extract: visible comments and useful structure
```

```text
纯图片页面
→ Extract: no_text / low semantic information
→ 不自动 Shot
```

```text
用户点击 Shot
→ screenshot always follows Shot semantics
```

```text
Accessibility 未开启
→ accessibility_unavailable
```

```text
RavenCat 自己
→ self_app
```

```text
受策略保护 App
→ protected_app / business policy block
```

```text
OCR no_text
→ SUCCESS
→ 不重截、不 fallback
```

```text
OCR 期间用户切窗
→ 仍返回 frozen screenshot 当时的文字
→ 临时 screenshot 已释放
```

## 20. Review Gate

任何 Screen Observation 改动必须回答：

- 这是语义感知还是视觉感知？
- 是用户明确操作还是自动业务策略？
- 是否改变了 Shot/Extract 的显式语义？
- 是否统一应用隐私策略？
- 是否把 raw Accessibility hierarchy 泄露给了业务层？
- 是否引入了不必要的持续监听？
- 是否因为“semantic 成功”错误删掉了视觉能力？
- 是否在默认情况下持久化了本应瞬时的页面内容？
- OCR 是否复用同一份截图准入与 fence，而不是第二套保护逻辑？
- OCR primitive 是否仍然只接受 RavenCat 自己管理的截图，而不是任意文件？
