/**
 * 群聊统一 conversation identity 静态契约验证。
 *
 * 验证范围（纯静态，不依赖 node:sqlite）：
 * 1. Schema 契约：chat_conversations 身份表、messages 外键与 ON DELETE CASCADE、
 *    集中 INDEXES 保留；
 * 2. 迁移 54 契约：冲突/无详情检查、孤立消息审计后删除、PRAGMA foreign_key_list 判断、
 *    显式列清单复制、数量与 max id 校验、外键恢复状态验证、foreign_key_check、
 *    失败 rollback、cause 保留、幂等约束、不伪造 session、孤儿之外的删除边界；
 * 3. Repository 生命周期契约：direct/group 创建与删除、AI 删除 identity 清理、
 *    clearDB 清理顺序。
 *
 * node:sqlite 迁移契约由 verify:chat 必跑，也可独立执行：
 *   npm run verify:group-conversation-identity:sqlite
 *
 * 真实 expo-sqlite 外键迁移仍需 Android 真机 fresh database 验收。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const schemaSource = read('src/platform/persistence/sqlite/schema.ts');
const migrationsSource = read('src/platform/persistence/sqlite/migrations.ts');
const sessionRepoSource = read('src/features/chat/conversation/infrastructure/SQLiteSessionRepository.ts');
const groupRepoSource = read('src/features/chat/group/infrastructure/SQLiteGroupChatRepository.ts');
const assistantRepoSource = read('src/features/assistants/infrastructure/SQLiteAssistantRepository.ts');
const helpersSource = read('src/platform/persistence/helpers.ts');

// ============================================================================
// Schema 静态契约
// ============================================================================
const chatConversationsKeyIndex = schemaSource.indexOf('chatConversations:');
const sessionsKeyIndex = schemaSource.indexOf('\n  sessions:');
const messagesKeyIndex = schemaSource.indexOf('\n  messages:');
const callSessionsKeyIndex = schemaSource.indexOf('\n  callSessions:');
assert.ok(chatConversationsKeyIndex > 0, 'schema 必须定义 chatConversations');
assert.ok(
  chatConversationsKeyIndex < messagesKeyIndex,
  'chat_conversations 必须定义在 messages 建表之前',
);

const chatConversationsBlock = schemaSource.slice(chatConversationsKeyIndex, sessionsKeyIndex);
assert.match(chatConversationsBlock, /id TEXT PRIMARY KEY/, '身份表必须有 id 主键');
assert.match(
  chatConversationsBlock,
  /kind TEXT NOT NULL CHECK \(kind IN \('direct', 'group'\)\)/,
  '身份表 kind 只允许 direct/group',
);
assert.doesNotMatch(
  chatConversationsBlock,
  /created_at|updated_at/,
  '身份表不得保存时间戳副本',
);

const messagesBlock = schemaSource.slice(messagesKeyIndex, callSessionsKeyIndex);
assert.match(
  messagesBlock,
  /FOREIGN KEY \(session_id\) REFERENCES chat_conversations\(id\) ON DELETE CASCADE/,
  'messages.session_id 必须引用 chat_conversations(id) 且保留 ON DELETE CASCADE',
);
assert.doesNotMatch(
  messagesBlock,
  /REFERENCES sessions\(id\)/,
  'messages schema 不得再引用 sessions(id)',
);
// 重建 messages 后索引由 initDatabase 集中执行 INDEXES 恢复，schema 必须保留完整清单。
assert.match(schemaSource, /idx_messages_session_id ON messages\(session_id\)/);
assert.match(schemaSource, /idx_messages_session_id_id ON messages\(session_id, id DESC\)/);

// ============================================================================
// 迁移 54 静态契约
// ============================================================================
const migration54Marker = '// 迁移54';
const markerIndex = migrationsSource.indexOf(migration54Marker);
assert.ok(markerIndex > 0, 'migrations.ts 必须存在迁移54 注释');
assert.equal(
  migrationsSource.lastIndexOf(migration54Marker),
  markerIndex,
  '迁移54 注释只能出现一次',
);
assert.doesNotMatch(
  migrationsSource.slice(0, markerIndex),
  /chat_conversations/,
  '迁移 1～53 不得引用 chat_conversations',
);
const finalBraceIndex = migrationsSource.trimEnd().length - 1;
assert.equal(migrationsSource[finalBraceIndex], '}', 'runMigrations 必须以右大括号结尾');
// 迁移 54 不再是最后一个迁移：静态契约只作用于迁移 54 自身，切片到下一个迁移注释为止。
const nextMigrationIndex = migrationsSource.indexOf('// 迁移55');
const migration54End = nextMigrationIndex > markerIndex ? nextMigrationIndex : finalBraceIndex;
const migration54Body = migrationsSource.slice(markerIndex, migration54End);

assert.match(
  migration54Body,
  /CREATE TABLE IF NOT EXISTS chat_conversations[\s\S]*id TEXT PRIMARY KEY[\s\S]*kind TEXT NOT NULL CHECK \(kind IN \('direct', 'group'\)\)/,
  '迁移54 必须创建身份表',
);
assert.match(
  migration54Body,
  /INNER JOIN group_chats g ON g\.id = s\.id/,
  '迁移54 必须检查 session/group ID 冲突',
);
assert.match(migration54Body, /WHERE c\.kind != 'direct'/, '必须检查 direct identity 类型冲突');
assert.match(migration54Body, /WHERE c\.kind != 'group'/, '必须检查 group identity 类型冲突');
assert.match(
  migration54Body,
  /INSERT OR IGNORE INTO chat_conversations \(id, kind\)\s*SELECT id, 'direct' FROM sessions/,
  '必须回填 direct identity',
);
assert.match(
  migration54Body,
  /INSERT OR IGNORE INTO chat_conversations \(id, kind\)\s*SELECT id, 'group' FROM group_chats/,
  '必须回填 group identity',
);
assert.match(
  migration54Body,
  /LEFT JOIN sessions s ON s\.id = m\.session_id[\s\S]*LEFT JOIN group_chats g ON g\.id = m\.session_id[\s\S]*WHERE s\.id IS NULL\s+AND g\.id IS NULL/,
  '必须识别孤立消息',
);
// 孤立消息策略：老版本删除会话残留的消息 UI 永不可达，审计落库后删除，不再拒绝迁移。
assert.match(
  migration54Body,
  /console\.warn\([\s\S]*孤立消息/,
  '删除孤立消息前必须输出 console 诊断',
);
assert.match(
  migration54Body,
  /CREATE TABLE IF NOT EXISTS chat_orphan_message_audit/,
  '必须创建孤立消息审计表',
);
assert.match(
  migration54Body,
  /INSERT OR REPLACE INTO chat_orphan_message_audit \(session_id, message_count, deleted_at\)/,
  '删除前必须把孤立消息来源与数量持久化到审计表',
);
assert.match(
  migration54Body,
  /DELETE FROM messages\s+WHERE session_id NOT IN \(SELECT id FROM sessions\)\s+AND session_id NOT IN \(SELECT id FROM group_chats\)/,
  '删除必须严格限定为不归属任何 sessions / group_chats 的孤立消息',
);
assert.doesNotMatch(
  migration54Body,
  /孤立消息，拒绝迁移/,
  '孤立消息不得再导致拒绝迁移',
);
assert.match(
  migration54Body,
  /FROM chat_conversations c[\s\S]*LEFT JOIN sessions s ON s\.id = c\.id[\s\S]*WHERE s\.id IS NULL\s+AND g\.id IS NULL/,
  '必须检查无详情 identity',
);
assert.match(
  migration54Body,
  /PRAGMA foreign_key_list\('messages'\)/,
  '必须使用 PRAGMA foreign_key_list 判断是否重建',
);
assert.match(
  migration54Body,
  /fk\.on_delete === 'CASCADE'/,
  '重建判断必须校验 ON DELETE CASCADE',
);
assert.match(
  migration54Body,
  /INSERT INTO messages_new \(\s*id, session_id/,
  '复制必须使用显式列清单',
);
assert.doesNotMatch(migration54Body, /INSERT INTO messages_new SELECT \*/);
assert.match(
  migration54Body,
  /COUNT\(\*\) AS c FROM messages_new/,
  '必须对比复制前后数量',
);
assert.match(migration54Body, /MAX\(id\) AS m/, '必须对比复制前后 max id');
assert.match(
  migration54Body,
  /PRAGMA foreign_keys = ON;[\s\S]*PRAGMA foreign_keys;[\s\S]*state\?\.foreign_keys !== 1/,
  '恢复外键后必须读取 PRAGMA 状态验证，不能只依赖 execAsync 不抛错',
);
assert.match(
  migration54Body,
  /PRAGMA foreign_key_check\('messages'\)/,
  '迁移完成后必须执行外键校验',
);
assert.match(migration54Body, /PRAGMA foreign_keys = OFF/, '重建前必须关闭外键约束');
assert.match(migration54Body, /ROLLBACK/, '失败时必须有回滚路径');
assert.doesNotMatch(migration54Body, /CREATE INDEX/, '不得在迁移内复制集中索引清单');
assert.doesNotMatch(migration54Body, /INSERT INTO sessions/, '迁移不得伪造 session');
assert.match(migration54Body, /cause: mErr/, '外层错误必须携带 cause');

// ============================================================================
// Repository 生命周期静态契约
// ============================================================================
const sessionIdentityInsertIndex = sessionRepoSource.indexOf('INSERT INTO chat_conversations (id, kind)');
const sessionRowInsertIndex = sessionRepoSource.indexOf('INSERT INTO sessions');
assert.ok(sessionIdentityInsertIndex > 0, 'createSession 必须写入 direct identity');
assert.ok(
  sessionIdentityInsertIndex < sessionRowInsertIndex,
  'direct identity 必须先于 sessions 详情行写入',
);
assert.match(sessionRepoSource, /withExclusiveTransactionAsync/, 'createSession 必须使用事务');
assert.doesNotMatch(sessionRepoSource, /INSERT OR IGNORE/, '新建业务数据不得使用 OR IGNORE');
// 单聊收敛为每个 AI 唯一 canonical conversation 后，不再存在「删除某个 direct session」的产品动作：
// direct identity 只能随 AI 一起消失（清理契约见下方 assistantRepoSource 断言）。
assert.doesNotMatch(
  sessionRepoSource,
  /DELETE FROM sessions WHERE id = \?/,
  '单聊仓储不得再保留独立删除 direct session 的路径',
);

const groupIdentityInsertIndex = groupRepoSource.indexOf('INSERT INTO chat_conversations (id, kind)');
const groupRowInsertIndex = groupRepoSource.indexOf('INSERT INTO group_chats');
assert.ok(groupIdentityInsertIndex > 0, '群聊创建必须写入 group identity');
assert.ok(
  groupIdentityInsertIndex < groupRowInsertIndex,
  'group identity 必须先于 group_chats 详情行写入',
);
assert.doesNotMatch(groupRepoSource, /INSERT OR IGNORE/, '新建业务数据不得使用 OR IGNORE');
assert.doesNotMatch(
  groupRepoSource,
  /DELETE FROM sessions WHERE id = \?/,
  '群聊删除不得再执行 DELETE FROM sessions 补丁',
);
assert.doesNotMatch(
  groupRepoSource,
  /DELETE FROM messages WHERE session_id = \?/,
  '群聊删除不得再手工删除 messages',
);
assert.match(
  groupRepoSource,
  /if \(deletedGroupCount > 0\)[\s\S]*DELETE FROM chat_conversations WHERE id = \? AND kind = 'group'/,
  '群聊删除必须只在确实删除 group_chats 后清理 group identity',
);

const assistantSessionSelectIndex = assistantRepoSource.indexOf('SELECT id FROM sessions WHERE ai_assistant_id = ?');
const assistantRowDeleteIndex = assistantRepoSource.indexOf('DELETE FROM ai_assistants WHERE id = ?');
const assistantIdentityDeleteIndex = assistantRepoSource.indexOf("DELETE FROM chat_conversations WHERE kind = 'direct' AND id IN");
assert.ok(assistantSessionSelectIndex > 0, 'AI 删除必须先捕获其 direct sessions');
assert.ok(
  assistantSessionSelectIndex < assistantRowDeleteIndex,
  '捕获 sessions 必须发生在删除 AI 之前',
);
assert.ok(
  assistantIdentityDeleteIndex > assistantRowDeleteIndex,
  'direct identity 清理必须发生在 AI 删除之后',
);
assert.match(assistantRepoSource, /withExclusiveTransactionAsync/, 'AI 删除必须保持单一事务');
assert.match(assistantRepoSource, /createHostAIAppointmentCooldown/, 'host AI 冷却逻辑不得遗漏');
assert.match(assistantRepoSource, /HOST_AI_RELATIONSHIP_STATE_ID/, 'host AI 状态写入不得遗漏');

// clearDB 已改为从 sqlite_master 动态发现全部应用表并清空，
// 不再维护手写 DELETE 清单，因此此处改验动态契约。
assert.match(
  helpersSource,
  /SELECT name FROM sqlite_master[\s\S]*WHERE type = 'table'/,
  'clearDB 必须从 sqlite_master 动态读取全部应用表',
);
assert.match(
  helpersSource,
  /DELETE FROM \$\{quoted\};/,
  'clearDB 必须对动态发现的每张表执行 DELETE',
);
assert.match(
  helpersSource,
  /PRAGMA foreign_keys = OFF/,
  'clearDB 必须先关闭外键',
);
assert.match(
  helpersSource,
  /BEGIN IMMEDIATE/,
  'clearDB 必须使用手动事务',
);
assert.match(
  helpersSource,
  /PRAGMA foreign_key_check/,
  'clearDB 必须执行 foreign_key_check',
);
assert.match(
  helpersSource,
  /foreign_keys !== 1/,
  'clearDB 必须确认 foreign_keys 恢复为 1',
);
assert.match(
  helpersSource,
  /quoteSqlIdentifier/,
  'clearDB 必须使用 SQL identifier 转义',
);

console.log('群聊统一 conversation identity 静态契约验证通过。');
console.log('node:sqlite 迁移契约由 verify:chat 必跑，也可独立执行：npm run verify:group-conversation-identity:sqlite。');
console.log('真实 expo-sqlite 外键迁移仍需 Android 真机 fresh database 验收。');
