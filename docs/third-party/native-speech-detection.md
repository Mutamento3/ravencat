# 原生人声检测依赖

`modules/realtime-speech-audio-source` 通过 Gradle 引入 `com.github.gkonovalov.android-vad:webrtc:2.0.10`，用于通话采集的本地人声检测。只使用 WebRTC VAD，不引入 Silero、Yamnet 或完整 WebRTC 通信栈。

- 上游版本：[android-vad 2.0.10](https://github.com/gkonovalov/android-vad/tree/2.0.10)。
- Android 封装署名：`Copyright 2023 Georgiy Konovalov`；[MIT 许可原文](upstream/android-vad-webrtc-2.0.10-LICENSE.txt)。
- WebRTC VAD 署名：`Copyright (c) 2011, The WebRTC project authors. All rights reserved.`；[BSD 许可原文](upstream/webrtc-vad-2.0.10-LICENSE.txt)。
- 原文下载地址记录于 [sources.json](upstream/sources.json)。发布第三方许可附件时随其他 upstream 原文一起保留。

分帧与持续人声确认由本项目的 `SpeechActivityDetector` 持有；分类器使用上游 WebRTC VAD。自动化测试验证本项目的音频时序与事件契约，实际环境的误打断率仍需真机测试。
