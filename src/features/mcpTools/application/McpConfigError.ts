/** MCP Server 配置错误：稳定错误码，供 UI 与验证使用。 */

export type McpConfigErrorCode =
  | 'NAME_REQUIRED'
  | 'NAME_INVALID'
  | 'NAME_TOO_LONG'
  | 'NAME_CONFLICT'
  | 'DESCRIPTION_TOO_LONG'
  | 'ASSISTANT_REQUIRED'
  | 'URL_INVALID'
  | 'URL_PROTOCOL'
  | 'URL_USERINFO'
  | 'URL_FRAGMENT'
  | 'AUTH_MODE_NOT_SUPPORTED'
  | 'TOKEN_REQUIRED'
  | 'TOKEN_INVALID'
  | 'CONFIG_IMPORT_INVALID'
  | 'CONFIG_CHANGED'
  | 'SERVER_NOT_FOUND'
  | 'CONNECTION_NOT_VERIFIED'
  | 'CONNECTION_FAILED'
  | 'TOOL_NAMESPACE_CONFLICT'
  | 'TOOL_DISCOVERY_FAILED'
  | 'DISCOVERY_SNAPSHOT_INVALID'
  | 'TOOL_NOT_DISCOVERED'
  | 'PROTOCOL_VERSION_UNSUPPORTED';

export class McpConfigError extends Error {
  readonly code: McpConfigErrorCode;

  constructor(code: McpConfigErrorCode, message: string) {
    super(message);
    this.name = 'McpConfigError';
    this.code = code;
  }
}
