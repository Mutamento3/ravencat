import { createTencentCloudTc3Headers } from './tencentCloudSignatureV3';
import type {
  TencentCloudTmtCredentials,
  TencentCloudTmtOptions,
  TranslateTextInput,
  TranslateTextResult,
} from './types';

const TMT_HOST = 'tmt.tencentcloudapi.com';
const TMT_SERVICE = 'tmt';
const TMT_ACTION_TEXT_TRANSLATE = 'TextTranslate';
const TMT_VERSION = '2018-03-21';
const DEFAULT_REGION = 'ap-guangzhou';
const DEFAULT_SOURCE = 'auto';
const DEFAULT_TARGET = 'zh';

interface TencentCloudTmtErrorPayload {
  Code?: string;
  Message?: string;
}

interface TencentCloudTmtResponsePayload {
  Response?: {
    Error?: TencentCloudTmtErrorPayload;
    TargetText?: string;
    Source?: string;
    Target?: string;
    UsedAmount?: number;
    RequestId?: string;
  };
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string {
  return String(value || '').trim();
}

export class TencentCloudTmtClient {
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly region: string;
  private readonly endpoint: string;
  private readonly source: string;
  private readonly target: string;
  private readonly projectId: number;

  constructor(credentials: TencentCloudTmtCredentials, options: TencentCloudTmtOptions = {}) {
    this.secretId = normalizeRequiredText(credentials.secretId, 'Tencent SecretId');
    this.secretKey = normalizeRequiredText(credentials.secretKey, 'Tencent SecretKey');
    this.region = normalizeOptionalText(options.region) || DEFAULT_REGION;
    this.endpoint = normalizeOptionalText(options.endpoint) || TMT_HOST;
    this.source = normalizeOptionalText(options.source) || DEFAULT_SOURCE;
    this.target = normalizeOptionalText(options.target) || DEFAULT_TARGET;
    this.projectId = Number.isFinite(options.projectId) ? Number(options.projectId) : 0;
  }

  async translateText(input: TranslateTextInput): Promise<TranslateTextResult> {
    const text = normalizeRequiredText(input.text, 'Source text');
    const source = normalizeOptionalText(input.source) || this.source;
    const target = normalizeOptionalText(input.target) || this.target;
    const payload = JSON.stringify({
      SourceText: text,
      Source: source,
      Target: target,
      ProjectId: this.projectId,
    });
    const headers = createTencentCloudTc3Headers({
      secretId: this.secretId,
      secretKey: this.secretKey,
      service: TMT_SERVICE,
      host: this.endpoint,
      action: TMT_ACTION_TEXT_TRANSLATE,
      version: TMT_VERSION,
      region: this.region,
      payload,
    });

    const response = await fetch(`https://${this.endpoint}`, {
      method: 'POST',
      headers,
      body: payload,
    });
    const responseText = await response.text();
    const data = responseText
      ? JSON.parse(responseText) as TencentCloudTmtResponsePayload
      : {};
    const responsePayload = data.Response;

    if (responsePayload?.Error) {
      const code = responsePayload.Error.Code || 'TencentCloudError';
      const message = responsePayload.Error.Message || '腾讯云翻译请求失败';
      throw new Error(`${code}: ${message}`);
    }

    if (!response.ok) {
      throw new Error(`腾讯云翻译请求失败：HTTP ${response.status}`);
    }

    const translatedText = normalizeOptionalText(responsePayload?.TargetText);
    if (!translatedText) {
      throw new Error('腾讯云翻译返回为空');
    }

    return {
      translatedText,
      source: responsePayload?.Source || source,
      target: responsePayload?.Target || target,
      usedAmount: typeof responsePayload?.UsedAmount === 'number'
        ? responsePayload.UsedAmount
        : null,
      requestId: responsePayload?.RequestId || null,
    };
  }
}
