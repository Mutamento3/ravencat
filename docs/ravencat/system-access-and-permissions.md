# RavenCat 系统访问与权限

本文描述当前“权限与后台运行”入口及系统能力的所有权。页面在 `src/features/companion/presentation/CompanionSystemAccessScreen.tsx`，由 `src/app/raven-cat/system-access.tsx` 做路由适配；当前没有独立 SystemAccess Feature 或统一 `SystemAccess` facade。

## 1. 能力与业务开关

页面汇总 Android 系统事实，不反向决定主动伴随、悬浮交互或设备控制的业务开关。各 Feature 根据自己的真实需求消费能力；不存在“全部权限开启才可使用”的总门禁。

不同机制不能都理解为同一种 runtime permission：

| 能力 | 当前读取与设置入口 | 事实含义 |
| --- | --- | --- |
| 通知提醒 | Companion 通知诊断与申请 | 同时读取 POST_NOTIFICATIONS、应用总开关和 Companion channel importance |
| 悬浮显示 | Floating Layer 的 Overlay 查询/设置 | Special App Access；不代表某个窗口已经附着 |
| 屏幕内容读取 | Device Observer 连接状态/设置 | Accessibility 连接与内容读取 capability；授权存在不等于服务已连接 |
| 使用情况访问 | `platform/device` 的 Usage Access 查询/设置 | AppOps 对应状态；未授权不关闭无需它的电量读取或独立前台窗口观察 |
| 电池优化 | Floating Layer 的电池优化状态/设置/申请 | 后台可靠性条件，不保证免于强制停止或厂商清理 |
| 全屏来电 | Calls 诊断/设置 | Android 14+ 单独读取和设置；Android 13 无此单独授权 |
| 来电通知 | Calls channel 状态/设置 | 与普通消息通知分开，页面保留授权入口，不展示来电诊断区 |
| 定位权限 | `platform/device` 的定位状态/申请与应用设置 | 明确显示未授权、大致位置或精确位置；仅用户点击时申请使用期间权限 |
| 系统定位 | `platform/device` 的系统定位状态/设置 | 独立于应用授权的系统总开关，不代表本应用已获得位置 |
| 厂商后台弹出、锁屏显示 | 当前应用系统设置 | 由用户人工确认，不能可靠检测，不能因 Settings 打开成功说已授权 |

当前页面没有 Camera、Microphone 或自动启动的通用 capability 列表。相机和麦克风仍由录音、通话等真实业务入口按需请求，不在首次进入页面时批量索取。

## 2. 刷新与错误

页面初次进入、手动下拉和 App 回到 active 时重新读取真实状态。从系统设置返回后不能复用旧快照，也不能把启动 Settings Activity 当成 grant。

当前页面以 `SystemAccessSnapshot` 聚合各 owner 的窄查询，不提供提议中的 `getStatus / getAllStatuses / request / refresh` 公共 API，也没有 `SystemCapabilityId`、`SystemCapabilityStatus` 领域协议。新增统一抽象必须基于真实 consumer，而不是把文档草案当作既有契约。

状态读取失败保留明确错误。厂商开关只能人工确认；权限存在、原生服务连接、能力可执行和业务授权分别属于不同事实，不能相互替代。

## 3. 原生与导航所有权

Device Observer 拥有 Accessibility 状态与设置能力，Floating Layer 提供 Overlay 和电池访问，Calls 提供来电系统访问，platform 提供 Usage Access 等 Android 底座。统一页面复用已有事实源，不在一个巨大 permissions module 重做它们。

定位状态与单次采样由 Device Observer 原生模块的独立 `DeviceLocationQuery` 提供，不依赖无障碍连接。`platform/device` 持有用户触发的定位权限申请入口；Phone Tools 持有主理 AI 工具授权与输出。权限页面只读取状态，不采样位置，也不在进入页面时弹授权。

具体页面地址与路由栈操作属于 App/Host。Feature 表达导航意图，页面的返回使用注入回调。当前没有自动聚焦 `focus=capability`、高亮、`returnIntent` 或权限补全后自动返回原 Feature 的通用协议，不把这些旧提议写成已实现行为。

## 4. 隐私与恢复出厂

用户文案解释能力用于什么。Accessibility 由用户启用，不因为授权存在就持续读取所有页面；屏幕读取仍受按需请求和 Protected Apps policy 约束，见[屏幕观察](screen-observation.md)。

恢复出厂只清 RavenCat 自己的业务数据与原生 diagnostics，不关闭 Accessibility、不撤销 runtime permission、不修改 Special App Access 或 OEM 设置；这些授权归 Android 与用户所有。

## 5. 验收范围

检查系统设置返回后的刷新、拒绝/撤销权限、通知总开关与不同 channel、Accessibility 已授权但断连、Android 13 与 14+ 的全屏来电差异。OEM 的后台弹出和锁屏行为仍需设备验收，不能由静态状态或自动化测试推断通过。
