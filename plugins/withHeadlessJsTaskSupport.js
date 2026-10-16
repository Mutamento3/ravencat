const { withMainApplication } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// 新架构缺失完成通知会让已结束的 Headless 任务、唤醒锁和启动 Intent 持续滞留。
module.exports = function withHeadlessJsTaskSupport(config) {
  return withMainApplication(config, (mod) => {
    mod.modResults.contents = mergeContents({
      src: mod.modResults.contents,
      newSrc: '            .apply { add(expo.modules.conversationturnruntime.HeadlessJsTaskSupportPackage()) }',
      tag: 'ravencat-headless-task-support',
      anchor: /^\s*PackageList\(this\)\.packages\s*$/m,
      offset: 1,
      comment: '//',
    }).contents;
    return mod;
  });
};
