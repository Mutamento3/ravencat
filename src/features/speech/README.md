# Speech 功能

Speech 拥有语音能力调用和 Provider client，不拥有 Chat 消息、媒体资产或播放状态。

Chat 语音消息通过 `startVoiceMessageTranscription` 建立单段转写会话。Chat 与 Calls 都使用 `startRealtimeSpeechToText`，支持腾讯实时 ASR、阿里百炼 Fun-ASR / Paraformer：采集期间接收 16 kHz 单声道 PCM，finish 后等待提供方最终完成事件。没有文件转写或自动换提供方的路径。调用方消费中间结果、最终结果或稳定失败码。

AI 语音继续复用 `synthesizeTextToSpeech`，consumer 为 `chatVoiceMessage`。生成的临时文件由调用方在 Media backing prepare 完成后清理，Speech 不提交 MediaAsset 或 Chat 事实。

## 提供方与参数

`SpeechProviderCatalog` 持有提供方、官方地址、模型参数和表单校验契约。Assistants 持有模型资产及编辑草稿，负责按提供方渲染下拉选择和参数。新建官方服务不要求填写 URL；自定义 OpenAI 兼容服务保留地址输入。旧配置中的自定义地址保持不变，用户可明确改用官方地址。

TTS 支持 OpenAI、MiniMax、ElevenLabs、OpenRouter 与自定义 OpenAI 兼容服务。正式调用与设置测试共用 `synthesizeConfiguredSpeech` 和 `SpeechSynthesisGateway`。OpenRouter 的风格指令使用当前官方顶层 `instructions`，只为已声明支持该能力的模型开放。OpenRouter 模型目录与 ElevenLabs 模型/音色目录可从官方接口加载。

表达能力随模型变化：MiniMax 使用 emotion，OpenAI 的 GPT-4o Mini TTS 使用 instructions，Eleven v3/v4 使用音频表达标签。Eleven v4 不发送 style、speed 或 speaker boost；其他已接入 Eleven 模型的 speed 范围为 0.7～1.2。Chat 的 `createConfiguredVoiceMessageTool` 在每次 run 准备时固定角色 TTS 模型、工具 schema 和文本说明，只向 AI 暴露实际支持的表达参数；执行继续使用同一快照。

### 语气词、声音与停顿（2026-10-10 核对）

自然语气词“嗯、啊、唔”和标点属于正文。`SpeechText` 拥有已核对模型的句内标记契约，并在模型输出边界生成合成输入与 canonical 转写；不支持、非法或不完整的标记直接报错，不静默删除或当作正文朗读。Chat 与 Calls 复用同一契约，不在 Provider adapter 重复校验内部数据。

| 提供方 / 模型 | 当前开放的表达 |
| --- | --- |
| OpenAI GPT-4o Mini TTS，以及 OpenRouter 的对应 OpenAI 模型 | 正文使用自然语言和标点；Chat 可用独立 instructions 指导情绪、轻声和节奏，不承诺精确停顿或指定非语言声音。Calls 使用配置默认风格。 |
| OpenAI tts-1 / tts-1-hd | 正文与 speed，无 instructions 或句内控制标记。 |
| MiniMax speech-2.8-hd / turbo | emotion、speed；句内 `<#0.5#>` 停顿与官方 `(laughs)`、`(breath)`、`(sighs)` 等声音标记。 |
| MiniMax speech-2.6、speech-02 的 hd / turbo | emotion、speed 与 `<#0.5#>` 停顿，不开放 2.8 的声音标记；仅 2.6 支持 fluent / whisper 情绪值。 |
| Eleven v3 / v4 / v4 turbo | 受控的方括号声音、表达与停顿标签，如 `[whispers]`、`[laughs]`、`[short pause]`、`[long pause]`；不使用 SSML break。标签与音色匹配会影响实际效果，不是精确计时。 |
| Eleven multilingual v2 / flash v2.5 / turbo v2.5 | 自然正文、speed 与 `<break time="0.5s" />`，停顿大于 0 且不超过 3 秒；不开放 v3/v4 的方括号标签。 |
| OpenRouter Voxtral、自定义 OpenAI 兼容服务、动态目录中的未知模型 | 不因兼容接口或厂商名称推断句内控制能力；AI 只获得自然正文和标点规则。自定义服务的用户连接参数仍由其配置决定。 |

MiniMax 停顿范围为 0.01～99.99 秒，最多两位小数，必须位于可朗读正文之间且不能连续使用。音标、发音字典、多说话人和背景音不在当前文本契约中。

实时通话每轮固定角色 TTS 模型，提示词、流式分句、验证与播放共用该快照。分句器等待句末的文本后继或流结束确认边界，完整保留跨 delta 的标记；句间显式停顿把两侧正文合并为一个合成单元。`aiSpeechText`、TTS 播放事件和字幕只使用转写，控制标记只进入 TTS 输入；播放队列信任已经验证的句子。来电邀请的持久开场白和去电接听决策仍是纯正文，可使用自然语气词和标点；接通后的实时回复才声明厂商句内能力。

## 设置测试

`SpeechConfigurationTest` 使用经过同一表单边界校验的连接快照，不保存测试文本，不改变系统或角色的模型选择，不创建消息或媒体资产。TTS 支持修改测试文本、生成、播放、暂停；STT 支持填写预期文本、麦克风实时识别与等待最终结果。切换配置或离开页面时取消连接，释放麦克风、播放器并删除临时音频；迟到的结果也必须清理。

新增提供方只需添加参数定义与真实协议适配，然后注册到现有入口；Chat、Calls 和测试页不判断具体协议。不支持的官方参数不包装成万能 JSON 输入，实时 STT 也不接受文件转写服务来凑提供方数量。

官方协议参考：[OpenAI TTS](https://developers.openai.com/api/docs/guides/text-to-speech)、[OpenRouter TTS](https://openrouter.ai/docs/guides/overview/multimodal/tts)、[MiniMax T2A](https://platform.minimax.io/docs/api-reference/speech-t2a-http)、[ElevenLabs TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)、[ElevenLabs 表达与停顿](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)、[Mistral Voxtral TTS](https://docs.mistral.ai/studio/audio/text_to_speech/speech)、[阿里实时 ASR](https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api)。

`npm run verify:speech` 验证请求、参数、配置提交、实时完成屏障与测试生命周期；真实鉴权、发音质量与 Android 采集/播放仍需要对应密钥和设备验收。

## 模型选择

STT 选择由 Speech 保存于 `speech_recognition_settings`，所有角色的聊天录音与通话共用。「辅助模型中心 → STT 模型」列表顶部直接嵌入 `SpeechRecognitionModelPicker`，选后立即保存，不增加设置页跳转。角色模型设置不再提供语音识别模型选择。原「我 → 语音识别设置」入口与独立页面已移除，已有选择不变；consumer 只表达场景，不参与模型选择。
TTS 由 Assistants 保存角色明确选择，语音消息和通话共用该角色模型；未选择或失效不会继承全局默认。
首次 STT 配置可用后初始化全局选择；首次 TTS 配置可用后初始化已有角色的空白设置，新角色创建时也固化该首次模型的可用引用。更换或取消后不自动覆盖。Host 通过 composition 出口装配各 owner 的初始化、选择和资产解析。当前契约见 [模型选择架构](../../../docs/architecture/auxiliary-model-selection.md)。
