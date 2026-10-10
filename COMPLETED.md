# 已完成功能摘要

> 根目录速查。已完成的实施文档按各项目关闭方式归档或移除。

## Together Listening V1

- **状态**：已完成；NetEase-only
- **核心体验**：用户与 Host AI 双向邀请，统一 Activity lifecycle 与三只 Host AI tools
- **产品投影**：Chat timeline、App 内 indicator、standard ongoing notification、Floating Together capsule、CHAT / TOGETHER pager 与自定义头像 projection
- **交付边界**：foreground suppression 与 native fail-safe；所有 projection 不拥有 Activity truth
- **验收**：邀请、Activity、Chat 与 App 内主链路已验收；仍需连接设备复核的外部 presentation 细项不在此扩大为已验收

## 液态玻璃（Android 13+ 原生玻璃渲染）

- **状态**：已完成并归档
- **核心变更**：
  - 最低系统版本提升到 Android 13（API 33）
  - 新增原生 Expo 模块 `modules/liquid-glass`
  - 删除旧 `expo-blur` 依赖与 `BlurView` 实现
  - `GlassSurface` / `ThemedSurface` 改为原生效果层 + React Native children 结构
  - 背景源与玻璃表面分离，支持 `app` / `chat:<key>` 场景级共享捕获
- **验收**：Android 14 真机通过；Android 13 完整冒烟已通过
- **历史文档**：实施文档已从仓库移除并在本地归档

## RavenCat Feature Boundary Migration

- **状态**：MIG-0 ～ MIG-7 已完成
- **结果摘要**：
  - 原 `src/features/ravenCat` 综合 Feature 已退役；RavenCat 继续作为产品名，不再作为代码 Feature 名
  - 最终形成 `src/features/companion`、`src/features/deviceControl`、`src/features/floatingLayer`、`src/features/screenCapture` 四个独立 Feature
  - Device Control 只执行受控设备动作，不做 Companion 业务决策
  - Floating Layer 与 Companion 通过 Host composition 连接
  - Screen Capture 拥有截图安全检查、截图执行与 native cache 生命周期；Companion 拥有何时、为何截图以及如何进入主动上下文或 Chat attachment 的业务编排
  - Notification 中的来电能力归 Calls；Companion 只保留主动消息所需的窄通知接口
  - Runtime dependencies 已按 Feature 拆分，旧 `RavenCatRuntimeDependencies`、`@features/ravenCat` 公共入口与兼容 shim 已删除
