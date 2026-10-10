import type { TranslationProviderMeta } from '../domain/TranslationModel';

export const TENCENT_TRANSLATION_PROVIDER = {
  provider: 'tencentCloudTmt',
  label: '腾讯云机器翻译',
  description: '腾讯云 TMT 文本翻译服务',
  credentialFields: [
    {
      key: 'secretId',
      label: 'SecretId',
      placeholder: 'AKID...',
    },
    {
      key: 'secretKey',
      label: 'SecretKey',
      placeholder: 'SecretKey',
    },
  ],
  optionFields: [
    {
      key: 'region',
      label: '地域',
      placeholder: 'ap-guangzhou',
      advanced: true,
    },
    {
      key: 'source',
      label: '源语言',
      placeholder: 'auto',
      hint: 'auto 表示自动识别原文语言',
    },
    {
      key: 'target',
      label: '目标语言',
      placeholder: 'zh',
      hint: '默认 zh（中文），使用腾讯云支持的语言代码',
    },
    {
      key: 'projectId',
      label: '项目 ID',
      placeholder: '0',
      advanced: true,
    },
  ],
} satisfies TranslationProviderMeta;

export const AI_TRANSLATION_PROVIDER = {
  provider: 'aiModel',
  label: 'AI 模型',
  description: '接入支持 OpenAI 兼容接口的文本模型，保留原文语气、格式和含义，只输出译文。',
  credentialFields: [
    { key: 'apiKey', label: 'API Key', placeholder: '填写服务商提供的 API Key' },
  ],
  optionFields: [
    { key: 'baseURL', label: 'API 地址', placeholder: 'https://你的服务地址/v1', required: true, hint: '填写服务商提供的 OpenAI 兼容接口地址' },
    { key: 'model', label: '模型名称', placeholder: '填写模型 ID，或从模型列表选择', required: true },
    { key: 'source', label: '源语言', placeholder: 'auto', hint: 'auto 表示自动识别原文语言' },
    { key: 'target', label: '目标语言', placeholder: 'zh', hint: '默认 zh（中文），支持语言代码或名称' },
  ],
} satisfies TranslationProviderMeta;

export const TRANSLATION_PROVIDERS: TranslationProviderMeta[] = [
  AI_TRANSLATION_PROVIDER,
  TENCENT_TRANSLATION_PROVIDER,
];
