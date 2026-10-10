const { AndroidConfig, withAndroidColors, withAndroidColorsNight } = require('expo/config-plugins');

// 原生裁剪页不在 React 主题树内；采用默认主题的实色顶栏，避免透明底色吞掉图标。
const light = {
  expoCropToolbarColor: '#FFFFFF',
  expoCropToolbarIconColor: '#1C1C1E',
  expoCropToolbarActionTextColor: '#1C1C1E',
  expoCropBackButtonIconColor: '#1C1C1E',
  expoCropBackgroundColor: '#F5F5F7',
};
const dark = {
  expoCropToolbarColor: '#2C2C2E',
  expoCropToolbarIconColor: '#FFFFFF',
  expoCropToolbarActionTextColor: '#FFFFFF',
  expoCropBackButtonIconColor: '#FFFFFF',
  expoCropBackgroundColor: '#1C1C1E',
};

module.exports = function withImageCropColors(config) {
  for (const [withColors, palette] of [[withAndroidColors, light], [withAndroidColorsNight, dark]]) {
    config = withColors(config, (mod) => {
      for (const [name, value] of Object.entries(palette)) {
        mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, { name, value });
      }
      return mod;
    });
  }
  return config;
};
