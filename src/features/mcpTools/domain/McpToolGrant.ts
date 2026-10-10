/** MCP 逐工具授权实体与数据库行映射。 */

export interface McpToolGrant {
  serverId: string;
  remoteToolName: string;
  localToolName: string;
  enabled: boolean;
  schemaFingerprint: string;
  updatedAt: string;
}

export interface McpToolGrantRow {
  server_id: string;
  remote_tool_name: string;
  local_tool_name: string;
  enabled: number;
  schema_fingerprint: string;
  updated_at: string;
}

export function createMcpToolGrantFromRow(
  row: McpToolGrantRow | null | undefined
): McpToolGrant | null {
  if (!row) {
    return null;
  }
  return {
    serverId: row.server_id,
    remoteToolName: row.remote_tool_name,
    localToolName: row.local_tool_name,
    enabled: row.enabled === 1,
    schemaFingerprint: row.schema_fingerprint,
    updatedAt: row.updated_at,
  };
}
