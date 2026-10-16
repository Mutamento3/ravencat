/** 小型 SQLite 用例也装配真实的 canonical anchor schema 与查询依赖。 */
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import ts from 'typescript';

const sourceCache = new Map();
function loadSource(url) {
  if (sourceCache.has(url.href)) return sourceCache.get(url.href).exports;
  const module = { exports: {} };
  sourceCache.set(url.href, module);
  new Function('require', 'module', 'exports', compile(url))((id) => {
    return loadSource(new URL(`${id}.ts`, url));
  }, module, module.exports);
  return module.exports;
}

const compile = (url) => ts.transpileModule(fs.readFileSync(url, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const schema = { exports: {} };
new Function('module', 'exports', compile(new URL('../src/platform/persistence/sqlite/chatSummarySchema.ts', import.meta.url)))(schema, schema.exports);
const statements = [];
await schema.exports.migrateChatSummary({ execAsync: async (sql) => { statements.push(sql); } });
export function installChatTimelineSchema(database) {
  for (const sql of statements) database.exec(sql);
  const { SCHEMAS } = loadSource(new URL('../src/platform/persistence/sqlite/schema.ts', import.meta.url));
  database.exec(SCHEMAS.conversationTurnRuns);
  database.exec(SCHEMAS.conversationTurnState);
  const columns = database.prepare("PRAGMA table_info('conversation_turn_runs')").all();
  if (!columns.some((column) => column.name === 'regeneration_source_run_id')) {
    database.exec('ALTER TABLE conversation_turn_runs ADD COLUMN regeneration_source_run_id TEXT');
  }
  if (!columns.some((column) => column.name === 'input_cursor_at_claim')) {
    database.exec('ALTER TABLE conversation_turn_runs ADD COLUMN input_cursor_at_claim INTEGER');
  }
  database.exec(SCHEMAS.chatRegenerationRequests);
  database.exec(SCHEMAS.chatTurnPresentations);
}
const timelineModule = ts.transpileModule(fs.readFileSync(new URL('../src/features/chat/messages/infrastructure/ChatTimelineSql.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
export const chatTimelineModuleUrl = 'data:text/javascript;base64,' + Buffer.from(timelineModule).toString('base64');
const mutationSourceUrl = new URL('../src/features/chat/messages/infrastructure/ChatMessageMutationSql.ts', import.meta.url);
export const chatMessageMutations = loadSource(mutationSourceUrl);
const presentationSql = ts.transpileModule(fs.readFileSync(new URL('../src/features/chat/reply/infrastructure/ChatTurnPresentationSql.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const presentationSqlUrl = 'data:text/javascript;base64,' + Buffer.from(presentationSql).toString('base64');
const mutationModule = ts.transpileModule(fs.readFileSync(mutationSourceUrl, 'utf8').replace("from '../../reply/infrastructure/ChatTurnPresentationSql'", `from '${presentationSqlUrl}'`), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
export const chatMutationModuleUrl = 'data:text/javascript;base64,' + Buffer.from(mutationModule).toString('base64');
