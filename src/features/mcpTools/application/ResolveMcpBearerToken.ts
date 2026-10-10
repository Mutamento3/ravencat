import { McpClientError } from '@platform/mcp';
import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';

/** 只有建立连接时读取凭据；恢复备份后缺失的设备密钥必须显式要求重新认证。 */
export async function resolveMcpBearerToken(reference: string | null): Promise<string | undefined> {
  if (reference === null) return undefined;
  const token = await getMcpToolsRuntimeDependencies().credentialStore.read(reference);
  if (token === null) {
    throw new McpClientError('AUTH_REQUIRED', 'MCP Token 不可用，请在服务配置页重新填写');
  }
  return token;
}
