import type { SpeechConnectionConfig } from '../domain/SpeechProvider';
import { readSpeechMetadata } from '../application/SpeechProviderCatalog';

export interface SpeechProviderOption {
  value: string;
  label: string;
}
export interface SpeechProviderOptions {
  models: SpeechProviderOption[];
  voices: SpeechProviderOption[];
}

/** 官方目录只提供选择项，不修改资产或用户当前选择。 */
export async function listSpeechProviderOptions(
  configuration: SpeechConnectionConfig,
  signal?: AbortSignal,
): Promise<SpeechProviderOptions> {
  const provider = readSpeechMetadata(configuration.metadataJson).provider;
  const headers =
    provider === 'elevenlabs'
      ? { 'xi-api-key': configuration.apiKey }
      : { Authorization: `Bearer ${configuration.apiKey}` };
  const get = async (url: string) => {
    const response = await fetch(url, { headers, signal });
    if (!response.ok) throw new Error(`官方目录加载失败：HTTP ${response.status}`);
    return response.json();
  };
  const options = (values: unknown, id: string): SpeechProviderOption[] => {
    if (
      !Array.isArray(values) ||
      values.some((value) => !value || typeof value[id] !== 'string' || typeof value.name !== 'string')
    )
      throw new Error('官方目录响应格式无效');
    return values.map((value) => ({ value: value[id], label: value.name }));
  };
  if (provider === 'openrouter')
    return {
      models: options((await get(`${configuration.baseURL}/models?output_modalities=speech`)).data, 'id'),
      voices: [],
    };
  if (provider === 'elevenlabs') {
    const getVoices = async () => {
      const voices: SpeechProviderOption[] = [];
      let token = '';
      do {
        const page = await get(
          `${configuration.baseURL.replace(/\/v1\/?$/, '')}/v2/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`,
        );
        voices.push(...options(page.voices, 'voice_id'));
        if (typeof page.has_more !== 'boolean' || (page.has_more && typeof page.next_page_token !== 'string'))
          throw new Error('官方音色分页响应格式无效');
        token = page.has_more ? page.next_page_token : '';
      } while (token);
      return voices;
    };
    const [models, voices] = await Promise.all([get(`${configuration.baseURL}/models`), getVoices()]);
    if (!Array.isArray(models)) throw new Error('官方模型目录响应格式无效');
    return {
      models: options(
        models.filter((model) => model.supports_text_to_speech),
        'model_id',
      ),
      voices,
    };
  }
  throw new Error('此提供方不支持加载官方目录');
}
