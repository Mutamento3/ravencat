const fs = require('node:fs/promises');
const path = require('node:path');
const { AndroidConfig, withDangerousMod, XML } = require('expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');

// preview 工程也能直接构建 debug；开发版必须同时覆盖前景和底色，
// 否则 main 中 icon.png 的不透明黑底会遮住白色背景。
module.exports = function withAndroidDevelopmentIcon(config, { foregroundImage, backgroundColor }) {
  return withDangerousMod(config, ['android', async (mod) => {
    const resourceRoot = path.join(mod.modRequest.platformProjectRoot, 'app/src/debug/res');
    const colorsPath = path.join(resourceRoot, 'values/colors.xml');
    const colors = await AndroidConfig.Resources.readResourcesXMLAsync({ path: colorsPath });
    AndroidConfig.Colors.assignColorValue(colors, { name: 'iconBackground', value: backgroundColor });
    await fs.mkdir(path.dirname(colorsPath), { recursive: true });
    await XML.writeXMLAsync({ path: colorsPath, xml: colors });

    // 自适应图标使用 Android 的 108dp 前景画布，与 Expo 的 main 资源保持一致。
    for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
      const directory = path.join(resourceRoot, `mipmap-${density}`);
      const image = await generateImageAsync({
        projectRoot: mod.modRequest.projectRoot,
        cacheType: 'android-development-adaptive-foreground',
      }, {
        src: path.resolve(mod.modRequest.projectRoot, foregroundImage),
        width: 108 * scale,
        height: 108 * scale,
        resizeMode: 'cover',
        backgroundColor: 'transparent',
      });
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'ic_launcher_foreground.webp'), image.source);
    }
    return mod;
  }]);
};
