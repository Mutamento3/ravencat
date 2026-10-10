/** MCP 传输与协议错误：稳定错误码，由 Feature 层映射为连接诊断。 */

export type McpClientErrorCode =
  | 'TRANSPORT_FAILED'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'AUTH_REQUIRED'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'PROTOCOL_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'REDIRECT_NOT_ALLOWED'
  | 'CANCELLED'
  | 'MRTR_INPUT_REQUIRED';

/** 请求超时与取消共用标记：用于区分 timeout 与外部取消。 */
export const MCP_TIMEOUT_ABORT_REASON = 'TIMEOUT';

export class McpClientError extends Error {
  readonly code: McpClientErrorCode;

  constructor(code: McpClientErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'McpClientError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** 稳定的 MCP 错误识别出口；与具体传输实现解耦。 */
export function isMcpClientError(error: unknown): error is McpClientError {
  return error instanceof McpClientError;
}
