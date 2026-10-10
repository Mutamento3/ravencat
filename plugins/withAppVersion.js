const { withAppBuildGradle } = require('expo/config-plugins');

// android 目录不入库，必须同时覆盖 prebuild 和已有原生工程的直接 Gradle 构建。
const versionDeclaration = `def appVersion = new groovy.json.JsonSlurper().parseText(["node", "-p", "JSON.stringify(require('./scripts/app-version.cjs'))"].execute(null, rootDir.parentFile).text)`;

module.exports = function withAppVersion(config) {
  return withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;
    if (/^def appVersion = .*$/m.test(contents)) {
      contents = contents.replace(/^def appVersion = .*$/m, versionDeclaration);
    } else {
      contents = contents.replace(/^android \{/m, `${versionDeclaration}\n\nandroid {`);
    }
    mod.modResults.contents = contents
      .replace(/^(\s*)versionCode .+$/m, '$1versionCode appVersion.versionCode')
      .replace(/^(\s*)versionName .+$/m, '$1versionName appVersion.version');
    return mod;
  });
};
