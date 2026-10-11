/** 提供 MCP 配置与工具授权迁移复用的 SQLite 建表语句。 */

import type { DatabaseWriteExecutor } from '../runtime';

export const MCP_SERVERS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    transport TEXT NOT NULL DEFAULT 'streamable_http'
      CHECK (transport IN ('streamable_http')),
    auth_mode TEXT NOT NULL DEFAULT 'none'
      CHECK (auth_mode IN ('none', 'bearer_token')),
    credential_ref TEXT,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    connection_status TEXT NOT NULL DEFAULT 'unverified'
      CHECK (connection_status IN (
        'unverified', 'available', 'unavailable', 'authentication_required'
      )),
    last_connected_at TEXT,
    last_error_code TEXT,
    tool_snapshot_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_negotiated_protocol_version TEXT,
    last_protocol_family TEXT,
    endpoint_class TEXT
  );
`;

export const MCP_TOOL_GRANTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mcp_tool_grants (
    server_id TEXT NOT NULL,
    remote_tool_name TEXT NOT NULL,
    local_tool_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    schema_fingerprint TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (server_id, remote_tool_name),
    FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
  );
`;

export const MCP_TOOL_GRANTS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_mcp_tool_grants_server
     ON mcp_tool_grants(server_id, enabled);`,
];

/** 生效对象必须由用户明确选择；删除服务或 AI 时由外键清理对应授权。 */
export const MCP_SERVER_ASSISTANTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mcp_server_assistants (
    server_id TEXT NOT NULL,
    assistant_id TEXT NOT NULL,
    PRIMARY KEY (server_id, assistant_id),
    FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE,
    FOREIGN KEY (assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
  );
`;

/** 历史事务连接未开启外键时，删除服务或角色留下的授权已无有效主体。 */
export async function repairMcpAuthorizationForeignKeys(db: DatabaseWriteExecutor): Promise<void> {
  await db.execAsync('BEGIN IMMEDIATE;');
  try {
    await db.execAsync(`
      DELETE FROM mcp_server_assistants
      WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE id = server_id)
         OR NOT EXISTS (SELECT 1 FROM ai_assistants WHERE id = assistant_id);
      DELETE FROM mcp_tool_grants
      WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE id = server_id);
    `);
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}
