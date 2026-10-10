/** MCP Server 配置实体与数据库行映射。 */

export type McpServerConnectionStatus =
  | 'unverified'
  | 'available'
  | 'unavailable'
  | 'authentication_required';

export type McpServerAuthMode = 'none' | 'bearer_token';

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  description: string;
  assistantIds: string[];
  transport: 'streamable_http';
  authMode: McpServerAuthMode;
  credentialRef: string | null;
  enabled: boolean;
  connectionStatus: McpServerConnectionStatus;
  lastConnectedAt: string | null;
  lastErrorCode: string | null;
  /** 最近一次成功测试连接保存的脱敏工具发现快照。 */
  toolSnapshotJson: string;
  /** 最近一次成功协商确定的 MCP 协议版本。 */
  lastNegotiatedProtocolVersion: string | null;
  /** 最近一次成功协商确定的协议代际。 */
  lastProtocolEra: string | null;
  /** 统一 endpoint validator 算出的端点分类。 */
  endpointClass: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerConfigRow {
  id: string;
  name: string;
  url: string;
  description: string;
  /** Repository 查询通过关联表聚合，SQLite 保证是字符串 ID 数组。 */
  assistant_ids_json: string;
  transport: string;
  auth_mode: string;
  credential_ref: string | null;
  enabled: number;
  connection_status: string;
  last_connected_at: string | null;
  last_error_code: string | null;
  tool_snapshot_json: string;
  last_negotiated_protocol_version: string | null;
  last_protocol_family: string | null;
  endpoint_class: string | null;
  created_at: string;
  updated_at: string;
}

export function createMcpServerConfigFromRow(
  row: McpServerConfigRow | null | undefined
): McpServerConfig | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description,
    assistantIds: JSON.parse(row.assistant_ids_json),
    transport: 'streamable_http',
    authMode: row.auth_mode === 'bearer_token' ? 'bearer_token' : 'none',
    credentialRef: row.credential_ref,
    enabled: row.enabled === 1,
    connectionStatus: parseConnectionStatus(row.connection_status),
    lastConnectedAt: row.last_connected_at,
    lastErrorCode: row.last_error_code,
    toolSnapshotJson: row.tool_snapshot_json,
    lastNegotiatedProtocolVersion: row.last_negotiated_protocol_version ?? null,
    lastProtocolEra: row.last_protocol_family ?? null,
    endpointClass: row.endpoint_class ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseConnectionStatus(value: string): McpServerConnectionStatus {
  if (
    value === 'available'
    || value === 'unavailable'
    || value === 'authentication_required'
  ) {
    return value;
  }
  return 'unverified';
}
