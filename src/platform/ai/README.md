# AI Platform

这里提供跨业务的文本模型技术能力，只负责调用 OpenAI 兼容 Provider，不承载助手、聊天或语音业务规则。

## 职责

- `BaseAIClient.ts`：普通、流式、工具调用与向量请求的公共实现；
- `OpenAIClient.ts` / `KimiClient.ts`：Provider 客户端与创建工厂；
- `modelDiscovery.ts`：发现模型列表；
- `connectionTest.ts`：连接测试与工具支持探测；
- `errorMapping.ts`：把外部错误转换为稳定的展示信息；
- `types.ts`：请求、响应、流式增量和错误契约。

业务代码统一从 `@platform/ai` 导入。TTS、STT 客户端属于 `@features/speech`，不与文本模型客户端混放。

Temperature / Top P 未配置或为 null 时，普通、流式、工具请求与连接测试均不发送对应字段，由服务商决定默认值；显式数值（包括 0）原样发送。客户端不补充本地采样默认值，也不根据模型名自动覆盖参数。

`disableThinking` 对已支持的可切换模型明确表达两端：`false` 开启思考，`true` 关闭思考。Qwen／百炼使用 `enable_thinking`，OpenRouter 使用 `reasoning.enabled`，其他兼容接口使用 `thinking.type: enabled / disabled`。已识别的可切换模型包括 Qwen3（排除固定思考、Instruct 与 Preview）、Qwen Plus/Flash/Turbo、DeepSeek V3.1/V3.2/V4、Kimi K2.5/K2.6 和 GLM 4.6/4.7/5/5.1/5.2；不能因百炼 Kimi 默认不思考而把开关关闭误解为省略参数。未提供开关的调用、未识别模型与非思考模型在未选择关闭时仍沿用服务商默认。连接测试、流式与非流式共用请求构造；不通过隐藏返回内容伪装关闭思考，不为关闭参数错误自动降级重试。固定思考模型或不同参数契约的自部署接口不保证支持该选择。

## 依赖方向

- Feature 和 app 组合代码可以依赖 `@platform/ai`；
- `platform/ai` 不依赖任何业务 feature；
- 只有本目录内部可以直接导入具体 Provider 文件。
