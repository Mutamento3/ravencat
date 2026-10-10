export interface TencentCloudTmtCredentials {
  secretId: string;
  secretKey: string;
}

export interface TencentCloudTmtOptions {
  region?: string;
  endpoint?: string;
  source?: string;
  target?: string;
  projectId?: number;
}

export interface TranslateTextInput {
  text: string;
  source?: string;
  target?: string;
}

export interface TranslateTextResult {
  translatedText: string;
  source: string;
  target: string;
  usedAmount: number | null;
  requestId: string | null;
}
