const {
  AndroidConfig,
  withAndroidManifest,
  withMainActivity,
  withMainApplication,
} = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// RN 从 Application 读取字体度量，页面从 Activity 读取资源；两个上下文共同遵守固定字号策略。
// 只覆盖 fontScale，其他系统配置仍由 Android 更新，避免冻结密度、语言或主题。
const fixedFontScaleContext = `  override fun attachBaseContext(newBase: android.content.Context) {
    val fontConfiguration = android.content.res.Configuration().apply {
      fontScale = 1f
    }
    super.attachBaseContext(newBase.createConfigurationContext(fontConfiguration))
  }`;

module.exports = function withFixedFontScale(config) {
  config = withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    const configChanges = new Set(activity.$['android:configChanges'].split('|'));
    // 字体缩放由固定字号上下文接管，不能因此重建 Router 根视图。
    configChanges.add('fontScale');
    activity.$['android:configChanges'] = [...configChanges].join('|');
    return mod;
  });

  for (const [withEntry, anchor] of [
    [withMainApplication, /^class MainApplication : Application\(\), ReactApplication \{/m],
    [withMainActivity, /^class MainActivity : ReactActivity\(\) \{/m],
  ]) {
    config = withEntry(config, (mod) => {
      mod.modResults.contents = mergeContents({
        src: mod.modResults.contents,
        newSrc: fixedFontScaleContext,
        tag: 'ravencat-fixed-font-scale',
        anchor,
        offset: 1,
        comment: '//',
      }).contents;
      return mod;
    });
  }
  return config;
};
