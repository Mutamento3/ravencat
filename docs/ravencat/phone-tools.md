# 手机工具当前契约

Phone Tools 是主理 AI 的手机能力产品面。产品目录、工具执行、系统权限与底层观察/动作各有 owner，不把它们合并成第二套 Runtime。当前只支持网易云 App-specific 工具包，不提前建设多音乐 Provider 或 AI 委派平台。

## 1. 当前能力与所有权

| 能力 | 工具/入口 | 所有者 |
| --- | --- | --- |
| 环境感知 | search_installed_apps、get_foreground_app、get_app_usage | Device Observer / Phone Tools 的窄契约 |
| 屏幕读取 | read_screen_accessibility、read_screen_ocr | Screen Observation（screenCapture） |
| 应用动作 | open_app、soft_lock_app、release_soft_lock | Device Control |
| App-specific 数据与媒体 | 网易云八工具 | neteaseMusic 工具包及各底层 owner |
| 系统状态与授权 | 权限与后台运行 | System Access |

普通 AI 默认没有主理手机权限。执行时通过当前 Host Authority 确认身份，再由具体工具执行本地 policy；Prompt、目录、工具包展开和任务来源都不授予权限。不伪装 `isHostAI=true` 借出整套身份，不保留尚未实现的 scoped lease/协作会话作为当前接口。

AI 日程只提供自主执行机会，复用正常 Registry 与工具授权，没有 wake-specific 手机工具 adapter。增加工具不要求 Companion 再建立独立执行路径。

## 2. 产品目录不是执行权威

`PHONE_TOOL_CATALOG` 提供直接工具的分类、标题、说明和实现状态；`PHONE_TOOL_PACKAGE_CATALOG` 提供 App-specific 分组。它们不复制 Registry 的 schema、owner、risk、hostOnly、幂等或执行实现。

工具包是 discovery/grouping/presentation，不是代理执行工具。目录 available/planned 表示能力状态，不自动决定授权或详情是否能打开。页面只展示真实配置入口，App/Host 持有具体路由，Feature 表达导航意图。

## 3. 受保护应用

用户和固定系统保护集合由 Phone Tools policy 合并、规范化与去重，观察和增加设备影响的动作共用该策略。当前用户集合仍有既有旧字段存储，由中性 Host composition 读取，不依赖 Companion 的初始化副作用。

| 行为 | Protected App |
| --- | --- |
| 获取前台/搜索安装应用 | 可知道身份和 protected 状态 |
| Accessibility、OCR、截图/视觉读取 | 拒绝内容访问 |
| 打开、软锁、App-specific 深度动作 | 拒绝新增影响 |
| release_soft_lock | 可撤销自己已创建的有效影响 |

策略在本地执行边界强制；模型是否遵守 Prompt 不能成为隐私边界。拒绝返回明确 `protected_app`，不伪装无文字、OCR 失败或未知窗口。保护 App 不等于隐藏它是否存在。

## 4. 应用身份与前台事实

search_installed_apps 从本机真实可启动列表解析 exact package，避免模型猜包名；搜索不是最终安全校验，动作 owner 仍拒绝不合法或不允许目标。

get_foreground_app 只消费 Device Observer 的 canonical 窗口事实；detectionReliable 且 package 存在才返回 identity/protected，否则 `foreground_app_unavailable`。它不读取标题、节点或页面内容，也不进入 Screen Observation 内容准入。

get_app_usage 按需读取今天、昨天或含今天的最近7天前台使用时长，可按 exact package 过滤，时长降序，默认最多20项、上限100项。未授权明确失败，不返回假零值；Android bucket 的真实起止时间随结果返回，不承诺精确切片，也不把后台音乐算作前台使用。没有持续监控或第二套唤醒。

## 5. 安全屏幕快照

每次 Tool Call 在 freeze 前完成可靠窗口、Protected Apps 与 native fence；freeze 后只消费这一份绑定事实，不自动刷新、重试或切到新窗口。需要新状态时由模型发起新 Tool Call。

- read_screen_accessibility：有界语义 snapshot/plainText，密码值抑制；结构只补 clickable/editable/password 等必要元素，不暴露完整 node tree。结构区最多64行、单 label 最多160字。
- read_screen_ocr：复用截图准入与 fence，对冻结 bitmap 执行 bundled ML Kit 中文识别，返回有界正文，在返回前释放临时截图，不暴露 URI。
- 无文字是明确的成功 no_text，不偷偷换感知方式。Accessibility、OCR 与真正视觉理解不是互相隐藏 fallback。

具体结果、native cache 与隐私见[屏幕观察契约](screen-observation.md)。工具只投影可信 snapshot，不重复底层已保证的窗口或参数校验。

## 6. open_app

open_app 只接受 exact Android package，经过当前 Host Authority、输入与 Protected Apps 准入，调用 Device Control 的 API 33 front-door launch。单次调用最多一次 launch request，不内部搜索、重试或读取前台确认。

`launch_dispatched` 只代表请求交给 Android，不证明目标已经成为前台。需要解析和确认时，由模型独立组合 search_installed_apps、open_app、get_foreground_app，不把 URL、songId 等深度参数塞进万能 open_app。

## 7. 按需拆包与三轮状态

Host 在一次 run 开始冻结授权，通过固定目录提供包 ID、用途与本次可用工具名；具体 description/参数只在当前请求的 function schema 提供。目录与历史之后的 open/closed 状态分离，展开不改稳定前缀，详见[默认 Prompt 组装](../prompt/default-prompt-assembly.md)。

```text
未展开目录 + open_tool_package
→ 展开包
→ 下一次模型请求提供原始 child function schema
→ 模型直接调用原始工具
→ 唯一 Runtime 校验并执行
```

拆包当轮可继续使用多个包，但同一批不能先拆包再猜参数调用 child，必须等下一请求的 schema。重复展开不续期；旧 phone_package_list_tools/call_tool 已退出生产。MCP 的两个 meta-tool 仍属于自身远端受控调用契约。

普通单聊的 `chat_tool_package_exposure` 属于 Chat，以会话/AI/包为键；新展开状态与正式 T3 回复同事务提交，保留后续三轮“用户输入+正式回复”，第三轮提交后收起。工具、推理和分段不额外计轮，失败/取消/supersede/fence/回滚不消耗有效期。通话、旁路和自主任务只在当前 run 展开，不推进普通对话轮数。

展开与本轮已授权工具相交，不能复活关闭工具。用户特批星标是按 AI 固定的直接暴露偏好：只有本轮已授权工具才直接带 schema，不受三轮拆包期影响，星标不授予调用权限。

## 8. 展示、网易云与验证

Chat 保存原始 runtime tool identity，只在 presentation 映射 `cloudmusic.*` 等名称；可见别名不参与授权。旧历史调用仍可显示，但不重新注册退休 meta-tool。

网易云当前八工具、公开数据、官方 App 点歌和 exact-package MediaSession 见[工具包契约](netease-music-tool-package.md)。一起听是[独立 Activity](together-listening.md)，不属于该包或播放检测的自动副作用。

相关验证保护 Host 身份、Protected Apps、冻结快照、launch 一次、schema、展开期与 Chat 原子提交。真实 Accessibility/OCR、OEM 窗口、音乐网络/MediaSession/权限撤销需设备验收。未实现的 AI 委派、协作会话与其他 App 集成不进入当前产品承诺。
