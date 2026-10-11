/** 新建库、当前公开版升级、数据保留、失败回滚与恢复出厂后的基线验证。 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { bootstrapSqlite, createSqliteExecutor, DATABASE_SCHEMA_VERSION } from './helpers/sqlite-bootstrap-fixture.mjs';
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const data = db => tables(db).map(name=>({name, rows:db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()}));
const structure = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
function check(db){
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
}
const create = () => {const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');return db;};
function seed(db){
 const t='2026-10-10T12:00:00.000Z';
 db.prepare("INSERT INTO ai_assistants(id,agent_id,name,model,created_at,updated_at) VALUES ('ai-proof','agent-proof','测试角色','test-model',?,?)").run(t,t);
 db.prepare("INSERT INTO sessions(id,ai_assistant_id,name,created_at,updated_at) VALUES ('direct-proof','ai-proof','测试单聊',?,?)").run(t,t);
 db.exec("INSERT INTO chat_conversations VALUES ('direct-proof','direct'); INSERT INTO chat_conversations VALUES ('group-proof','group');");
 db.prepare("INSERT INTO group_chats(id,name,created_at,updated_at) VALUES ('group-proof','测试群聊',?,?)").run(t,t);
 const insert=db.prepare('INSERT INTO messages(id,session_id,text,is_me,sender_type,created_at) VALUES (?,?,?,?,?,?)');
 insert.run(41,'direct-proof','单聊保留正文',1,'user',t);insert.run(42,'group-proof','群聊保留正文',0,'assistant',t);
 db.prepare("INSERT INTO protocols(id,ai_assistant_id,content,created_at,updated_at) VALUES ('protocol-proof','ai-proof','保留协议正文',?,?)").run(t,t);
 const profile=db.prepare('SELECT id FROM user_profile LIMIT 1').get().id;
 db.prepare("INSERT INTO memory_pools(id,user_profile_id,ai_assistant_id,created_at,updated_at) VALUES ('pool-proof',?,'ai-proof',?,?)").run(profile,t,t);
 db.prepare("INSERT INTO memory_items(id,pool_id,content,normalized_content,remembered_at,created_at,updated_at) VALUES ('memory-proof','pool-proof','保留记忆正文','保留记忆正文',?,?,?)").run(t,t,t);
 db.exec("INSERT INTO memory_item_embeddings(memory_id,content_revision,status,model_fingerprint,model_name,vector_json,dimension) VALUES ('memory-proof',1,'ready','test-fingerprint','test-embedding','[0.25,0.75]',2)");
 db.prepare("INSERT INTO chat_summary_segments(id,conversation_id,sequence,content,time_zone,created_at,updated_at) VALUES ('summary-proof','direct-proof',1,'保留摘要正文','Asia/Shanghai',?,?)").run(t,t);
 db.prepare("INSERT INTO moments(id,author_type,author_id,author_name_snapshot,content,created_at) VALUES ('moment-proof','user',?,'测试用户','保留朋友圈正文',?)").run(profile,t);
 db.prepare("INSERT INTO mcp_servers(id,name,url,created_at,updated_at) VALUES ('mcp-proof','测试服务','https://example.invalid/mcp',?,?)").run(t,t);
 db.exec("INSERT INTO mcp_server_assistants VALUES ('mcp-proof','ai-proof')");
 db.prepare("INSERT INTO mcp_tool_grants(server_id,remote_tool_name,local_tool_name,schema_fingerprint,updated_at) VALUES ('mcp-proof','remote','local','test',?)").run(t);
 db.prepare("INSERT INTO raven_cat_ai_schedules(schedule_id,owner_ai_id,remind_at,summary,details,status,created_at,updated_at) VALUES ('schedule-proof','ai-proof',?,'保留日程','保留日程正文','scheduled',?,?)").run(t,t,t);
}

const db=create();
await bootstrapSqlite(createSqliteExecutor(db));
assert.equal(db.prepare('PRAGMA user_version').get().user_version,DATABASE_SCHEMA_VERSION);
for(const retired of ['memories','memory_entries','capability_bindings','raven_cat_self_wakes','raven_cat_contact_traces']) assert.ok(!tables(db).includes(retired));
assert.ok(!tables(db).includes('call_background_legacy_migration'),'新库不创建旧文件迁移标记');
seed(db);check(db);
const before=data(db), schema=structure(db);
const statements=[];
await bootstrapSqlite(createSqliteExecutor(db,statements));
assert.deepEqual(data(db),before);
assert.deepEqual(structure(db),schema);
assert.ok(statements.every(sql=>!/(?:ALTER|DROP|CREATE)\s/i.test(sql)),'普通启动不重放 DDL');
assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='messages'").get().seq,42);
// 公开版最终结构以108保存；正常记录全部保留，115的孤立MCP授权仍被清理。
db.exec('PRAGMA user_version=108; PRAGMA foreign_keys=OFF;');
db.exec("INSERT INTO mcp_server_assistants VALUES ('deleted-service','ai-proof')");
db.exec('PRAGMA foreign_keys=ON;');
await bootstrapSqlite(createSqliteExecutor(db));
assert.deepEqual(data(db),before);
assert.deepEqual(structure(db),schema);
assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='messages'").get().seq,42);check(db);
// 建库失败不留下表或版本；重试能够正常建立。
const failed=create();const raw=createSqliteExecutor(failed);
await assert.rejects(bootstrapSqlite({...raw,execAsync:async sql=>{
 if(sql.includes('CREATE UNIQUE INDEX'))throw new Error('注入索引失败');
 return raw.execAsync(sql);
}}),/注入索引失败/);
assert.equal(tables(failed).length,0);assert.equal(failed.prepare('PRAGMA user_version').get().user_version,0);
await bootstrapSqlite(raw);check(failed);
// 升级事务失败保留原库、版本、孤立授权；恢复启动门可按原错误回滚文件。
db.exec('PRAGMA user_version=108; PRAGMA foreign_keys=OFF;');
db.exec("INSERT INTO mcp_server_assistants VALUES ('deleted-service','ai-proof')");db.exec('PRAGMA foreign_keys=ON;');
const beforeFailed=data(db), upgradeRaw=createSqliteExecutor(db);
await assert.rejects(bootstrapSqlite({...upgradeRaw,execAsync:async sql=>{
 if(sql.includes('PRAGMA user_version ='))throw new Error('注入版本提交失败');
 return upgradeRaw.execAsync(sql);
}}),/注入版本提交失败/);
assert.deepEqual(data(db),beforeFailed);assert.equal(db.prepare('PRAGMA user_version').get().user_version,108);
await bootstrapSqlite(upgradeRaw);check(db);
// 不支持的旧开发结构和未来版本在任何写入前失败。
const unsupported=create();unsupported.exec('CREATE TABLE development_only (id TEXT); PRAGMA user_version=108;');
const original=structure(unsupported);
await assert.rejects(bootstrapSqlite(createSqliteExecutor(unsupported)),/开发版本/);assert.deepEqual(structure(unsupported),original);
unsupported.exec('PRAGMA user_version=117');await assert.rejects(bootstrapSqlite(createSqliteExecutor(unsupported)),/不受当前版本支持/);
// 恢复出厂保留schema/version并清空所有应用表，随后正常启动补回默认记录。
failed.exec('PRAGMA foreign_keys=OFF;');for(const table of tables(failed))failed.exec(`DELETE FROM "${table}"`);failed.exec('PRAGMA foreign_keys=ON;');
await bootstrapSqlite(createSqliteExecutor(failed));
for(const name of ['user_profile','host_ai_relationship_state','memory_model_settings','memory_v3_state','speech_recognition_settings','translation_settings'])assert.equal(failed.prepare(`SELECT COUNT(*) c FROM ${name}`).get().c,1);
check(failed);
for(const database of [db,failed,unsupported])database.close();
console.log('数据库基线验证通过：新建库、当前公开版升级、正文/向量/摘要/授权保留、版本原子性、幂等、恢复出厂和外键完整性');
