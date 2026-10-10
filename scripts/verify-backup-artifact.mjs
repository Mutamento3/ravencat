/** Backup SQLite 完整性与快照引用修复验证；格式往返由原生单测覆盖。 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { importTypeScriptModule } from './lib/import-typescript-module.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findSqlite3() {
  const located = spawnSync('where.exe', ['sqlite3.exe'], { encoding: 'utf8' });
  if (located.status === 0) return located.stdout.trim().split(/\r?\n/u)[0];
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdkRoot) return path.join(sdkRoot, 'platform-tools', 'sqlite3.exe');
  throw new Error('找不到 sqlite3.exe，无法验证恢复数据库 PRAGMA');
}

const sqlite3 = findSqlite3();
const { repairMcpAuthorizationForeignKeys } = await importTypeScriptModule(
  path.join(ROOT, 'src/platform/persistence/sqlite/mcpSchema.ts'),
);

// 旧事务连接遗漏的授权级联：只清理无父服务/角色的授权，保留全部有效配置与授权。
{
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=OFF;
    CREATE TABLE mcp_servers(id TEXT PRIMARY KEY);
    CREATE TABLE ai_assistants(id TEXT PRIMARY KEY);
    CREATE TABLE mcp_server_assistants(
      server_id TEXT REFERENCES mcp_servers(id) ON DELETE CASCADE,
      assistant_id TEXT REFERENCES ai_assistants(id) ON DELETE CASCADE,
      PRIMARY KEY(server_id, assistant_id)
    );
    CREATE TABLE mcp_tool_grants(
      server_id TEXT REFERENCES mcp_servers(id) ON DELETE CASCADE,
      remote_tool_name TEXT, PRIMARY KEY(server_id, remote_tool_name)
    );
    INSERT INTO mcp_servers VALUES('live');
    INSERT INTO ai_assistants VALUES('live');
    INSERT INTO mcp_server_assistants VALUES('live', 'live'), ('deleted', 'live'), ('live', 'deleted');
    INSERT INTO mcp_tool_grants VALUES('live', 'tool'), ('deleted', 'tool');
    PRAGMA foreign_keys=ON;`);
  const executor = { execAsync: async (sql) => db.exec(sql) };
  try {
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 3);
    await repairMcpAuthorizationForeignKeys(executor);
    await repairMcpAuthorizationForeignKeys(executor);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    for (const table of ['mcp_servers', 'ai_assistants', 'mcp_server_assistants', 'mcp_tool_grants']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1, '有效主体与授权必须保留');
    }
    db.exec('PRAGMA foreign_keys=OFF; INSERT INTO mcp_server_assistants VALUES (\'deleted\', \'live\'); PRAGMA foreign_keys=ON;');
    await assert.rejects(() => repairMcpAuthorizationForeignKeys({ execAsync: async (sql) => {
      if (sql === 'COMMIT;') throw new Error('提交失败');
      db.exec(sql);
    } }), /提交失败/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_server_assistants').get().n, 2, '修复提交失败必须整体回滚');
  } finally {
    db.close();
  }
}
const { repairConversationTurnForeignKeys } = await importTypeScriptModule(
  path.join(
    ROOT,
    'src/platform/persistence/sqlite/conversationTurnIntegrityRepair.ts',
  ),
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ravencat-backup-artifact-'));
try {
  const validDb = path.join(tempRoot, 'valid.db');
  execFileSync(sqlite3, [validDb], {
    input: 'PRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid INTEGER REFERENCES p(id)); INSERT INTO p VALUES(1); INSERT INTO c VALUES(1);',
  });
  assert.equal(execFileSync(sqlite3, [validDb, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).trim(), 'ok');
  assert.equal(execFileSync(sqlite3, [validDb, 'PRAGMA foreign_key_check;'], { encoding: 'utf8' }).trim(), '');

  const foreignKeyDb = path.join(tempRoot, 'foreign-key.db');
  execFileSync(sqlite3, [foreignKeyDb], {
    input: 'PRAGMA foreign_keys=OFF; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid INTEGER REFERENCES p(id)); INSERT INTO c VALUES(99);',
  });
  assert.notEqual(
    execFileSync(sqlite3, [foreignKeyDb, 'PRAGMA foreign_key_check;'], { encoding: 'utf8' }).trim(),
    '',
  );

  // 历史会话删除残留：修复只删除失去 conversation identity 的运行时事实。
  const conversationDb = path.join(tempRoot, 'conversation-turn.db');
  execFileSync(sqlite3, [conversationDb], {
    input: `
      PRAGMA foreign_keys=OFF;
      CREATE TABLE chat_conversations(id TEXT PRIMARY KEY);
      CREATE TABLE conversation_turn_runs(
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE
      );
      CREATE TABLE conversation_turn_state(
        session_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
        active_run_id TEXT REFERENCES conversation_turn_runs(run_id)
      );
      INSERT INTO chat_conversations VALUES('live-session');
      INSERT INTO conversation_turn_runs VALUES('live-run', 'live-session');
      INSERT INTO conversation_turn_state VALUES('live-session', 'live-run');
      INSERT INTO conversation_turn_runs VALUES('orphan-run', 'deleted-session');
      INSERT INTO conversation_turn_state VALUES('deleted-session', 'orphan-run');
    `,
  });
  const sqliteAdapter = {
    execAsync: async (sql) => {
      execFileSync(sqlite3, [conversationDb, sql]);
    },
    getAllAsync: async (sql) => {
      const output = execFileSync(sqlite3, ['-json', conversationDb, sql], {
        encoding: 'utf8',
      }).trim();
      return output ? JSON.parse(output) : [];
    },
  };
  assert.notEqual(
    execFileSync(sqlite3, [conversationDb, 'PRAGMA foreign_key_check;'], {
      encoding: 'utf8',
    }).trim(),
    '',
  );
  await repairConversationTurnForeignKeys(sqliteAdapter);
  await repairConversationTurnForeignKeys(sqliteAdapter);
  assert.equal(
    execFileSync(sqlite3, [conversationDb, 'PRAGMA foreign_key_check;'], {
      encoding: 'utf8',
    }).trim(),
    '',
  );
  assert.equal(
    execFileSync(sqlite3, [conversationDb, 'SELECT run_id FROM conversation_turn_runs;'], {
      encoding: 'utf8',
    }).trim(),
    'live-run',
  );
  assert.equal(
    execFileSync(sqlite3, [conversationDb, 'SELECT session_id FROM conversation_turn_state;'], {
      encoding: 'utf8',
    }).trim(),
    'live-session',
  );

  const corruptDb = path.join(tempRoot, 'corrupt.db');
  fs.writeFileSync(corruptDb, crypto.randomBytes(2048));
  const corruptResult = spawnSync(sqlite3, [corruptDb, 'PRAGMA integrity_check;'], { encoding: 'utf8' });
  assert.ok(corruptResult.status !== 0 || corruptResult.stdout.trim() !== 'ok');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Backup SQLite 完整性验证通过；原生格式测试：:backup-storage:testDebugUnitTest');
