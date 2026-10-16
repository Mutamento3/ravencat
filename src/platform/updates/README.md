# 应用更新发布来源

`GitHubReleases.fetchApplicationReleases` 匿名读取 `skylucky163/ravencat` 最近 100 条 GitHub Release。网络请求有 15 秒超时，不重试；在这一边界验证响应结构，仅交付已发布且具有上传完成的 APK 的版本。包含 Pre-release，不使用会排除预览版的 `/releases/latest`。

发布标签使用 `v主版本.次版本.补丁版本`，也支持语义版本的预发布后缀与构建元数据。Host 按安装包的原生版本名比较，选择更高的可下载版本；同版本、较旧版本、无 APK 的版本和草稿不提示。发布新版 APK 时需同时提高安装包版本名与 Release 标签；仅提高构建编号不会产生升级提醒。

开发环境（React Native `__DEV__`）由 Metro 交付代码，不参与公开 APK 更新检查；手动点击时说明开发版的更新方式，不查询 GitHub。开发包与公开预览包的包名和签名独立，原生改动需重新安装开发包。预览／发布环境继续按已安装 APK 的版本检查更新。

Host 在每次冷启动进入前台后检查，不阻塞启动与数据恢复。网络失败不会宣称“已是最新版本”，用户可在设置中手动重试。选择“跳过此版本”将版本号保存到 AsyncStorage，同版本下次不自动弹窗；可用更新仍留在设置入口并显示红点，手动检查仍可打开该版本，新版本再次自动提醒。清空数据会同时清空跳过记录。更新状态不参与 Tab 栏未读数，不调用 Android 通知。

点击“下载更新”在应用专用 cache 的 `app-updates/` 目录下载 APK，设置入口显示进度。网络下载由已有 Expo 文件模块完成；`modules/app-updates` 在原生文件边界流式核对 GitHub asset 的 SHA-256、文件大小、包名和版本，失败则删除文件，不交付可安装状态。下载完成后提示用户点击“安装更新”，通过已有 Expo FileProvider 授予安装器单文件读取权限，打开 Android 系统安装确认页。覆盖签名与安装许可由 Android 安装器负责。

首次安装更新需要系统“允许安装未知应用”授权；返回后点击检查更新即可继续安装，不重复下载。尚未安装的包在本次进程内保留可安装状态；进程重启后重新检查、重新下载，不提供跨进程续传或后台服务。新的 APK 必须包含 `app-updates` 原生模块，已经发布的旧 APK 无法仅通过服务端配置补上这个功能。

“发现 → 权限与后台运行 → 应用更新”显示“安装未知应用”的实际系统授权状态，点击可打开本应用的授权页；返回应用后沿用权限页面的 AppState 刷新。通知使用权复用 Device Control 已有的 NotificationListener 授权状态与系统设置入口，权限页面明确展示它，不与通知发送开关混用。

验证：`node --no-warnings scripts/verify-application-updates.mjs`；原生 APK 文件校验执行 `android/gradlew.bat :app-updates:testDebugUnitTest`。权限返回刷新与系统安装确认需用新原生包真机验收。
