# 参考实现来源

本表记录未作为 npm 依赖引入、但在本地实现过程中参考过的外部项目。项目源码公开时保留对应上游署名与许可原文；参考协议不代表获得第三方服务或内容的授权。

## 网易云公开数据模块

- 本地实现：`modules/netease-public-data`。
- 参考项目：[NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)。
- 当时审阅的固定 commit：[f5ce55bcb46e29c8e5350ca796fb1cc9d9914acd](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/tree/f5ce55bcb46e29c8e5350ca796fb1cc9d9914acd)，项目包版本为 `4.40.0`。
- 参考范围：当前 Kotlin 模块对应上游 EAPI 和公开只读接口子集，固定来源与被审阅文件如下。
- 上游署名：`Copyright (c) 2013-2022 Binaryify`。
- 许可：[MIT 原文快照](upstream/netease-api-enhanced-f5ce55bcb46e-LICENSE.txt)，原始地址记录于 [sources.json](upstream/sources.json)。

审阅范围包含 `util/crypto.js`、`util/request.js`、`util/option.js` 与歌曲搜索、歌单详情、歌曲详情、歌词和评论接口定义。当前模块使用 Kotlin/JCA 实现 MD5、AES-128-ECB envelope、HTTPS 请求与响应映射，未引入上游 Node/Express 服务，也未将上游完整请求层作为依赖打包。

这里保留已确定的参考来源与许可，不把改写或仅使用子集当作取消上游署名的理由，也不将整个模块宣称为没有参考实现的独立原创。网易云接口、音乐、歌词、评论与品牌的服务或内容权利不由上述 MIT 许可授予。
