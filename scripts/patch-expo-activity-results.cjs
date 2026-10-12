/**
 * Expo SDK 54 必须按实际 Activity 身份重建相册、相机与裁剪入口。
 * React Native 新架构可能跳过旧 Activity 的 onHostDestroy 通知，而 JS runtime 继续存活；
 * 只依赖销毁标记会遗留已被 Android Lifecycle 注销的 launcher。
 * 同类上游问题：https://github.com/expo/expo/issues/41252
 * 上游具备相同生命周期契约后应审查并删除此补丁。
 */
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', 'node_modules', 'expo-modules-core',
  'android', 'src', 'main', 'java', 'expo', 'modules', 'kotlin', 'AppContext.kt');

const replacements = [
  ['  private var hostWasDestroyed = false',
    '  private var hostActivity: WeakReference<AppCompatActivity>? = null'],
  [`    // We need to re-register activity contracts when reusing AppContext with new Activity after host destruction.
    if (hostWasDestroyed) {
      hostWasDestroyed = false
      hostingRuntimeContext.registry.registerActivityContracts()
    }

    activityResultsManager.onHostResume(activity)`,
  `    val previousHostActivity = hostActivity
    hostActivity = WeakReference(activity)
    // 先交接实际页面，再注册入口；旧页面销毁不保证触发 React 的 onHostDestroy。
    activityResultsManager.onHostResume(activity)
    if (previousHostActivity != null && previousHostActivity.get() !== activity) {
      hostingRuntimeContext.registry.registerActivityContracts()
    }`],
  [`    // The host (Activity) was destroyed, but it doesn't mean that modules will be destroyed too.
    // So we save that information, and we will re-register activity contracts when the host will be resumed with new Activity.
    hostWasDestroyed = true`,
  '    // Activity 身份由恢复时交接，销毁事件只负责持久化结果与通知模块。'],
];

let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
for (const [original, patched] of replacements) {
  if (source.includes(patched)) continue;
  if (!source.includes(original)) {
    throw new Error('Expo Activity 生命周期实现已变化，请审查并移除此补丁，禁止猜测性替换。');
  }
  source = source.replace(original, patched);
}
fs.writeFileSync(target, source, 'utf8');
console.log('[postinstall] 已修正 Expo Activity 重建时的系统选择器注册');
