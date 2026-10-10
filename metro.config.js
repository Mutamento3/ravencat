const { getDefaultConfig } = require('expo/metro-config');

// 公共配置不绑定开发者的网卡；连接方式由 Expo 启动参数决定。
module.exports = getDefaultConfig(__dirname);
