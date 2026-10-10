# Android 设备能力

本目录提供跨 Feature 的 Android 通知、媒体选择、本地文件、持久化媒体、实时语音采集，以及普通语音片段录制/播放能力。

## 公共入口

- 业务代码从 `@platform/device` 导入通用设备能力；
- 界面需要图片或附件操作时，可从 `@platform/device/DeviceMediaService` 导入媒体门面；
- Feature 专属的原生适配仍放在对应 Feature 的 `infrastructure/`。

本目录只承载技术能力，不包含聊天、通话、朋友圈或主动联系策略。

`DeviceStatus` 提供按需电池快照与应用使用统计，对应 Device Observer 原生模块，但不依赖无障碍服务连接。电量无需权限；应用使用统计需系统“使用情况访问”授权，查询前在原生边界检查当前授权及用户解锁状态。统计为 Android `UsageStatsManager` 聚合的前台时长，保留真实统计区间，不包含后台音乐播放，也不持续监听、保存使用历史或启动服务。

`DeviceStatus.getInstalledApplicationInfo` 同步读取自身安装包的名称、版本名称和构建编号，
无需权限或服务连接。界面展示安装版本时使用这些原生事实，不从 Metro 的 Expo 配置猜测安装包版本。

`DeviceMediaService.pickCroppedImage` 复用 Expo 的 Android 原生选图与裁剪，返回裁剪后的临时图片或取消结果。调用方申请权限并指定比例：头像 1:1、时刻封面 16:9、背景使用当前屏幕比例；业务 owner 继续负责持久化与绑定。`plugins/withImageCropColors.js` 为生成的 Android 工程配置深浅色实色顶栏与高对比度图标，修改这些原生资源需要重新编译应用。

Chat 语音消息使用 `VoiceRecording`、`LocalAudioPlayback` 与 `LocalAudioMetadata` 三个窄端口，对应 `modules/voice-message-audio`。录音输出 16 kHz、单声道、PCM16 WAV；播放使用 Android 普通 `USAGE_MEDIA + CONTENT_TYPE_SPEECH`，提供 started、暂停/继续、进度、结束和错误事件。Calls 的通信路由、AEC 与半双工语义仍由 Calls 私有模块持有，不能经这些端口隐式复用。
