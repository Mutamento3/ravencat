/** 验证账单工具、真实 SQLite 写入和用户编辑行为，不读取用户数据库。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { agentToolSchemaDependencies } from './helpers/agent-tool-schema-dependencies.mjs';

const require = createRequire(import.meta.url);
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE ledger_records (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL, detail TEXT,
  amount REAL NOT NULL, record_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
const executor = {
  runAsync: async (sql, params = []) => db.prepare(sql).run(...params),
  getFirstAsync: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
};
const dialogs = [];
const theme = { spacing: { lg: 16 }, colors: { text: { tertiary: '#888' }, brand: { primary: '#333' } } };
const mocks = {
  '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => executor } },
  '@shared/ui': { ModalSheet: 'ModalSheet', showAppDialog: (options) => dialogs.push(options) },
  '@shared/theme': { useTheme: () => theme, useThemedStyles: () => ({}) },
  'react-native': Object.fromEntries(['View', 'Text', 'TextInput', 'TouchableOpacity', 'ScrollView'].map((name) => [name, name])),
};
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: relative,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (Object.hasOwn(agentToolSchemaDependencies, id)) return agentToolSchemaDependencies[id];
    if (id === '@shared/runtime/abortSignal') return load('src/shared/runtime/abortSignal.ts');
    if (id === '@shared/theme/constants') return load('src/shared/theme/constants.ts');
    if (id.startsWith('.')) {
      const base = path.posix.join(path.posix.dirname(relative), id);
      const extension = fs.existsSync(new URL(`../${base}.tsx`, import.meta.url)) ? '.tsx' : '.ts';
      return load(base + extension);
    }
    return require(id);
  }, module, module.exports);
  cache.set(relative, module.exports);
  return module.exports;
}
const wallet = 'src/features/wallet/';
const { SQLiteLedgerRepository } = load(`${wallet}infrastructure/SQLiteLedgerRepository.ts`);
const repository = new SQLiteLedgerRepository();
const { AddLedgerRecordTool: add, UpdateLedgerRecordTool: update, DeleteLedgerRecordTool: remove } = load(`${wallet}aiTools/LedgerRecordTools.ts`);
const { GetLedgerContextTool: query } = load(`${wallet}aiTools/GetLedgerContextTool.ts`);
const { SearchLedgerTool: search } = load(`${wallet}aiTools/SearchLedgerTool.ts`);
const { LegacyAgentToolAdapter } = load('src/host/composition/agent/LegacyAgentToolAdapter.ts');
const { matchesAgentToolInputSchema } = load('src/shared/aiTools/AgentToolInputSchema.ts');
const { getWalletRecordDate, createWalletRecord } = load(`${wallet}domain/WalletRecord.ts`);
const context = { repositories: { ledger: repository } };
function adapter(tool) {
  return new LegacyAgentToolAdapter(tool, { owner: 'wallet', risk: 'reversible_write', idempotency: 'not_idempotent' }, () => context);
}
async function invoke(tool, input) {
  const adapted = adapter(tool);
  assert.equal(matchesAgentToolInputSchema(input, adapted.descriptor.inputSchema), true);
  return adapted.execute(input, {});
}
// 新工具沿用现有工具包的授权与按需展开能力。
const { AgentToolRegistry } = load('src/platform/agentRuntime/AgentToolRegistry.ts');
const { registerToolPackagesForHostRun } = load('src/host/composition/agent/ToolPackageExposure.ts');
const registry = new AgentToolRegistry();
const bindings = [add, update, remove, query, search].map((tool) => {
  const adapted = adapter(tool);
  registry.register(adapted);
  return { packageId: 'wallet', tool: adapted };
});
const exposure = registerToolPackagesForHostRun({
  registry, bindings, allowedToolNames: bindings.map(({ tool }) => tool.descriptor.name), openPackageIds: [],
});
assert.deepEqual(exposure.visibleToolNames(), []);
await registry.get('open_tool_package').execute({ package_id: 'wallet' }, {});
assert.deepEqual(new Set(exposure.visibleToolNames()), new Set([add.name, update.name, remove.name, query.name, search.name]));
const lunch = { type: 'expense', category: '餐饮', amount: 25, detail: '午餐牛肉面', recordDate: '2026-10-09' };
const added = await invoke(add, lunch);
assert.equal(added.status, 'success');
const record = added.data.record;
assert.ok(added.modelContent.includes(record.id), '模型必须能拿到新增账单 ID');
assert.equal((await repository.getRecords()).length, 1);

for (const [tool, input] of [[query, { mode: 'recent' }], [query, { mode: 'keyword', keyword: '牛肉面' }], [search, { keyword: '牛肉面' }]]) {
  const result = await invoke(tool, input);
  assert.ok(result.modelContent.includes(record.id), '适配后的模型 observation 必须包含真实 ID');
}
const edited = await invoke(update, { recordId: record.id, amount: 28, detail: '' });
assert.equal(edited.status, 'success');
const afterEdit = (await repository.getRecords())[0];
assert.equal(afterEdit.amount, 28);
assert.equal(afterEdit.detail, '');
assert.equal(afterEdit.id, record.id);
assert.equal(afterEdit.createdAt, record.createdAt);
assert.equal(afterEdit.recordDate, record.recordDate);
assert.equal(afterEdit.category, record.category);
assert.equal((await repository.getMonthlyStats(2026, 10)).totalExpense, 28);
assert.equal((await invoke(update, { recordId: record.id, type: 'income', category: '退款', recordDate: '2026-09-30' })).status, 'success');
assert.equal((await repository.getMonthlyStats(2026, 10)).count, 0);
assert.equal((await repository.getMonthlyStats(2026, 9)).totalIncome, 28);
assert.equal((await invoke(remove, { recordId: record.id })).status, 'success');
assert.equal((await repository.getRecords()).length, 0);
assert.equal((await invoke(remove, { recordId: record.id })).status, 'error');
assert.equal((await invoke(update, { recordId: record.id, amount: 50 })).status, 'error');
assert.equal(await repository.deleteRecord('missing'), false);
assert.equal(await repository.updateRecord('missing', { amount: 1 }), false);

// 模型边界拒绝非法金额、日期、空分类、空修改和未声明字段。
for (const invalid of [
  { ...lunch, amount: 0 }, { ...lunch, amount: -1 }, { ...lunch, amount: '25' },
  { ...lunch, amount: Infinity }, { ...lunch, category: '  ' },
  { ...lunch, recordDate: '2026-02-30' }, { ...lunch, id: 'invented' },
]) assert.equal(matchesAgentToolInputSchema(invalid, adapter(add).descriptor.inputSchema), false);
assert.equal(matchesAgentToolInputSchema({ recordId: 'id' }, adapter(update).descriptor.inputSchema), false);
assert.equal(matchesAgentToolInputSchema({ recordId: ' ' }, adapter(remove).descriptor.inputSchema), false);
const controller = new AbortController();
controller.abort();
await assert.rejects(() => add.execute(lunch, { ...context, abortSignal: controller.signal }));
assert.equal((await repository.getRecords()).length, 0);
const today = (await invoke(add, { type: 'expense', category: '交通', amount: 2 })).data.record;
assert.equal(today.recordDate, getWalletRecordDate());
const oldTimezone = process.env.TZ;
process.env.TZ = 'Asia/Shanghai';
assert.equal(getWalletRecordDate(new Date('2026-10-08T16:15:00Z')), '2026-10-09');
if (oldTimezone === undefined) delete process.env.TZ;
else process.env.TZ = oldTimezone;

// 手动新增仍可安排自动回复；AI 新增没有这一副作用。
const { addWalletRecord } = load(`${wallet}application/AddRecord.ts`);
let queued = 0;
const manual = await addWalletRecord(lunch, {}, { repository, queueAIReply: async () => { queued += 1; return { queued: true }; } });
assert.equal(manual.queuedAIReply, true);
assert.equal(queued, 1);

// 用户编辑保留原数据，支持自定义分类和日期，保存失败时保留表单。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act, create } = require('react-test-renderer');
mocks['react-native'].StyleSheet = { create: (styles) => styles };
const Modal = load(`${wallet}presentation/AddRecordModal.tsx`).default;
const initialRecord = createWalletRecord({ ...lunch, category: '小吃', recordDate: '2026-09-28' });
let saved;
let closed = 0;
let succeeds = false;
let renderer;
await act(async () => { renderer = create(React.createElement(Modal, {
  visible: true, initialRecord, onSave: async (draft) => { saved = draft; return succeeds; }, onClose: () => { closed += 1; },
})); });
function saveButton() {
  return renderer.root.findAllByType('TouchableOpacity').find((node) => node.findAllByType('Text').some((text) => text.props.children === '保存'));
}
assert.equal(saveButton().props.disabled, false);
await act(async () => { await saveButton().props.onPress(); });
assert.equal(saved.category, '小吃');
assert.equal(saved.recordDate, '2026-09-28');
assert.equal(saved.amount, 25);
assert.equal('id' in saved, false);
assert.equal('createdAt' in saved, false);
assert.equal(closed, 0);
const dateInput = renderer.root.findAllByType('TextInput').find((node) => node.props.placeholder === 'YYYY-MM-DD');
await act(async () => { dateInput.props.onChangeText('2026-02-30'); });
assert.equal(saveButton().props.disabled, true);
await act(async () => { dateInput.props.onChangeText('2026-09-29'); });
succeeds = true;
await act(async () => { await saveButton().props.onPress(); });
assert.equal(saved.recordDate, '2026-09-29');
assert.equal(closed, 1);
await act(async () => { renderer.unmount(); });

// 长按只展示菜单，选择编辑或确认删除后才写入；取消不会删除。
mocks['../composition'] = {
  updateWalletRecord: (id, updates) => repository.updateRecord(id, updates),
  deleteWalletRecord: (id) => repository.deleteRecord(id),
};
const { useWalletRecordActions } = load(`${wallet}presentation/useWalletRecordActions.ts`);
let actions;
let reloaded = 0;
function Harness() { actions = useWalletRecordActions(async () => { reloaded += 1; }); return null; }
await act(async () => { renderer = create(React.createElement(Harness)); });
await act(async () => { actions.showRecordActions(today); });
const menu = dialogs.at(-1);
assert.deepEqual(menu.buttons.map((button) => button.text), ['取消', '编辑', '删除']);
await act(async () => { menu.buttons.find((button) => button.text === '编辑').onPress(); });
assert.equal(actions.editingRecord.id, today.id);
await act(async () => { assert.equal(await actions.saveRecord({ amount: 3 }), true); });
assert.equal((await repository.getRecords()).find((item) => item.id === today.id).amount, 3);
assert.equal(reloaded, 1);
await act(async () => { menu.buttons.find((button) => button.text === '删除').onPress(); });
const confirm = dialogs.at(-1);
assert.equal(confirm.buttons.find((button) => button.text === '取消').onPress, undefined);
assert.equal((await repository.getRecords()).some((item) => item.id === today.id), true);
await act(async () => { await confirm.buttons.find((button) => button.text === '删除').onPress(); });
assert.equal((await repository.getRecords()).some((item) => item.id === today.id), false);
assert.equal(reloaded, 2);
await act(async () => { renderer.unmount(); });

// 超过五条的历史记录可以展开，并对末尾记录发出长按操作。
const { CategoryGroup } = load(`${wallet}presentation/HistoryDetailScreen/components/CategoryGroup.tsx`);
const groupedRecords = Array.from({ length: 6 }, (_, index) => createWalletRecord({ ...lunch, id: `history-${index}` }));
let selected;
await act(async () => { renderer = create(React.createElement(CategoryGroup, {
  category: '餐饮', type: 'expense', total: 150, percentage: 100, count: 6,
  color: '#333', records: groupedRecords, mutatingRecordId: null, onRecordLongPress: (item) => { selected = item; },
})); });
assert.equal(renderer.root.findAllByType('TouchableOpacity').filter((node) => node.props.onLongPress).length, 5);
const expand = renderer.root.findAllByType('TouchableOpacity').find((node) => !node.props.onLongPress);
await act(async () => { expand.props.onPress(); });
const rows = renderer.root.findAllByType('TouchableOpacity').filter((node) => node.props.onLongPress);
assert.equal(rows.length, 6);
await act(async () => { rows.at(-1).props.onLongPress(); });
assert.equal(selected.id, 'history-5');
await act(async () => { renderer.unmount(); });

// 初始详情快照不能阻止修改后重新读取真实统计。
mocks['@react-navigation/native'] = { useFocusEffect: (callback) => React.useEffect(callback, [callback]) };
mocks['../../composition'] = { getLedgerRangeSummary: (start, end) => repository.getRangeSummary(start, end) };
const { useHistoryDetail } = load(`${wallet}presentation/HistoryDetailScreen/useHistoryDetail.ts`);
const historic = await repository.insertRecord({ ...lunch, recordDate: '2026-09-28' });
const timeRange = { startDate: '2026-09-28', endDate: '2026-09-28', label: '历史账单' };
const initialData = { timeRange, ...await repository.getRangeSummary(timeRange.startDate, timeRange.endDate) };
let history;
function HistoryHarness() { history = useHistoryDetail({ timeRange, initialData }); return null; }
await act(async () => { renderer = create(React.createElement(HistoryHarness)); });
assert.equal(history.summary.totalExpense, 25);
await repository.updateRecord(historic.id, { amount: 30 });
await act(async () => { await history.reload(); });
assert.equal(history.summary.totalExpense, 30);
assert.equal(history.summary.records[0].amount, 30);
await repository.deleteRecord(historic.id);
await act(async () => { await history.reload(); });
assert.equal(history.summary.totalExpense, 0);
assert.deepEqual(history.summary.records, []);
await act(async () => { renderer.unmount(); });
db.close();
console.log('Wallet 账单新增、ID observation、编辑、删除、统计与表单行为验证通过');
