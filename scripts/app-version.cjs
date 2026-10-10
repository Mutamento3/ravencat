// 主版本只在 package.json 维护；构建编号使用从 2020 年开始的 UTC 秒数。
// 本地和云端共用时间序列，不依赖某一台机器的计数文件或 EAS 远端计数器。
module.exports = {
  version: require('../package.json').version,
  versionCode: Math.floor(Date.now() / 1000) - 1577836800,
};
