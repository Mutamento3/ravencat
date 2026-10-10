const { withAppBuildGradle } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// 签名由 Gradle 在构建时读取，prebuild 不复制密钥或密码到生成的源码中。
// 本地与 EAS 共用 credentials.json；缺失凭据时禁止 release 回退到 debug 签名。
const releaseSigning = `def releaseCredentialsFile = rootProject.file("../credentials.json")
def hasReleaseCredentials = releaseCredentialsFile.exists()

android {
    signingConfigs {
        release {
            if (hasReleaseCredentials) {
                def credentials = new groovy.json.JsonSlurper().parse(releaseCredentialsFile)
                def keystore = credentials.android.keystore
                storeFile rootDir.parentFile.toPath().resolve(keystore.keystorePath).toFile()
                storePassword keystore.keystorePassword
                keyAlias keystore.keyAlias
                keyPassword(keystore.containsKey("keyPassword") ? keystore.keyPassword : keystore.keystorePassword)
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}

// 开发版不依赖发布凭据；release 必须在执行任务前明确失败，不能产出另一身份的 APK。
gradle.taskGraph.whenReady { graph ->
    if (!hasReleaseCredentials && graph.allTasks.any { it.project == project && it.name.contains("Release") }) {
        throw new GradleException("Release 缺少 credentials.json：请运行 eas credentials --platform android，下载 preview 的现有签名；不要创建新密钥。")
    }
}`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = mergeContents({
      src: mod.modResults.contents,
      newSrc: releaseSigning,
      tag: 'ravencat-release-signing',
      anchor: /^dependencies \{/m,
      offset: 0,
      comment: '//',
    }).contents;
    return mod;
  });
};
