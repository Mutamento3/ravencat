const { withMainApplication } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// 新架构缺失完成通知会让已结束的 Headless 任务、唤醒锁和启动 Intent 持续滞留。
module.exports = function withHeadlessJsTaskSupport(config) {
  return withMainApplication(config, (mod) => {
    // 保留 Expo 模板已有的包注册块；先将链式 apply 换行，供自己的生成块插入。
    const contents = mod.modResults.contents.replace(
      /(PackageList\(this\)\.packages)(\.apply\s*\{)/,
      '$1\n            $2',
    );
    mod.modResults.contents = mergeContents({
      src: contents,
      newSrc: '            .apply { add(expo.modules.conversationturnruntime.HeadlessJsTaskSupportPackage()) }',
      tag: 'ravencat-headless-task-support',
      anchor: /^\s*PackageList\(this\)\.packages\s*$/m,
      offset: 1,
      comment: '//',
    }).contents;
    return mod;
  });
};
