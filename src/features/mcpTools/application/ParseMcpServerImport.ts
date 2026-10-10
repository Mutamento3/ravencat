import type { McpServerAuthMode } from '../domain/McpServerConfig';
import { McpConfigError } from './McpConfigError';

export interface McpServerImportDraft {
  name: string;
  url: string;
  authMode: McpServerAuthMode;
  bearerToken?: string;
}

/** 导入只生成待编辑草稿；选择、保存和测试沿用原有配置流程，不偷偷创建服务。 */
export function parseMcpServerImport(text: string): McpServerImportDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid('配置不是有效 JSON');
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw invalid('配置需要包含 mcpServers 对象');
  }
  const entries = Object.entries(parsed.mcpServers);
  if (entries.length === 0) throw invalid('配置中没有 MCP 服务');
  return entries.map(([name, config]) => {
    if (!isRecord(config) || typeof config.url !== 'string') {
      throw invalid(`「${name}」需要远程服务 URL；手机端不支持 command / stdio 配置`);
    }
    if ('command' in config || 'args' in config || 'env' in config) {
      throw invalid(`「${name}」包含本地进程配置，请使用官方 Streamable HTTP 配置`);
    }
    if (config.type !== undefined && !['http', 'streamablehttp', 'streamable_http', 'streamable-http'].includes(String(config.type))) {
      throw invalid(`「${name}」的传输方式不受支持，请使用 Streamable HTTP`);
    }
    let bearerToken: string | undefined;
    if (config.headers !== undefined) {
      if (!isRecord(config.headers)) throw invalid(`「${name}」的 headers 必须是对象`);
      for (const [header, value] of Object.entries(config.headers)) {
        if (header.toLowerCase() !== 'authorization' || bearerToken !== undefined) {
          throw invalid(`「${name}」仅支持一个 Authorization: Bearer 请求头`);
        }
        if (typeof value !== 'string' || !/^Bearer\s+\S+$/i.test(value.trim())) {
          throw invalid(`「${name}」的 Authorization 需要采用 Bearer Token 格式`);
        }
        bearerToken = value.trim().replace(/^Bearer\s+/i, '');
      }
    }
    return { name, url: config.url, authMode: bearerToken === undefined ? 'none' : 'bearer_token', bearerToken };
  });
}

function invalid(message: string): McpConfigError {
  return new McpConfigError('CONFIG_IMPORT_INVALID', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
