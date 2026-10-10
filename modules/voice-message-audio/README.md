# Voice Message Audio 原生模块

Android 13+ 的普通语音片段设备能力：

- 使用 `AudioRecord` 录制 16 kHz、单声道、PCM16，并在停止时生成 WAV；
- 录制事件携带稳定 session ID 与 PCM chunk，供实时 STT 使用；
- 使用 `MediaPlayer` 的普通媒体/语音属性播放，提供 started、进度、暂停、继续、结束和错误事件；
- 使用 `MediaMetadataRetriever` 读取音频时长。

本模块不设置通信模式、不控制听筒/扬声器路由、不启用 Calls AEC，也不拥有 Chat 或 MediaAsset 生命周期。
