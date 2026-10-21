/** 验证真实诊断存储 API 的留存、恢复、失败、凭据清洗和清空竞态。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/platform/ai/HttpExchangeDiagnostics.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function storage() {
  const files = new Map();
  const faults = new Map();
  const holds = new Map();
  const writes = [];
  async function gate(action) {
    const hold = holds.get(action);
    if (hold) {
      holds.delete(action);
      hold.entered.resolve();
      await hold.release.promise;
    }
    if (faults.has(action)) {
      const error = faults.get(action);
      faults.delete(action);
      throw error;
    }
  }
  const api = {
    cacheDirectory: 'file:///private/cache/',
    async getInfoAsync(uri) { await gate('info'); return { exists: files.has(uri) }; },
    async readAsStringAsync(uri) {
      await gate('read');
      assert.ok(files.has(uri), '只读取存在的文件');
      return files.get(uri);
    },
    async makeDirectoryAsync() { await gate('mkdir'); },
    async writeAsStringAsync(uri, content) {
      await gate('write');
      files.set(uri, content);
      writes.push(content);
    },
    async moveAsync({ from, to }) {
      await gate('move');
      assert.ok(files.has(from));
      files.set(to, files.get(from));
      files.delete(from);
    },
    async deleteAsync(uri) {
      await gate('delete');
      for (const name of files.keys()) {
        if (name === uri || (uri.endsWith('/') && name.startsWith(uri))) files.delete(name);
      }
    },
  };
  return {
    api, files, writes,
    fail(action, message) { faults.set(action, new Error(message)); },
    hold(action) {
      const hold = { entered: deferred(), release: deferred() };
      holds.set(action, hold);
      return { entered: hold.entered.promise, release: hold.release.resolve };
    },
  };
}

function open(disk) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    assert.equal(name, 'expo-file-system/legacy');
    return disk.api;
  }, module, module.exports);
  return module.exports.aiHttpDiagnostics;
}

function exchange(id, patch = {}) {
  return {
    id: String(id), startedAt: '2026-10-21T01:00:00.000Z', completedAt: '2026-10-21T01:00:01.000Z',
    url: 'https://provider.example/v1/chat/completions', method: 'POST', model: 'test-model',
    transport: 'complete', status: 200, requestBody: '{"messages":[]}', responseBody: '{"choices":[]}',
    error: null, ...patch,
  };
}

// 默认关闭且不因一次网络调用创建正文；首次捕获会恢复用户之前的启用选择。
{
  const disk = storage();
  const store = open(disk);
  assert.deepEqual(await store.getSnapshot(), { enabled: false, records: [], error: null });
  assert.equal(await store.beginCapture(), null);
  await store.record(exchange(0));
  assert.equal(disk.files.size, 0);
  await store.setEnabled(true);
  const reopened = open(disk);
  assert.equal(typeof await reopened.beginCapture(), 'number');
  assert.equal((await reopened.getSnapshot()).enabled, true);
}

// 正文不截断；并发完成串行提交，保留最近十份完整往返，重启后保持顺序和全文。
{
  const disk = storage();
  const store = open(disk);
  await store.setEnabled(true);
  const token = await store.beginCapture();
  const fullBody = '完整正文📦'.repeat(400_000);
  await Promise.all(Array.from({ length: 13 }, (_, id) => store.record(exchange(id, {
    transport: id % 2 ? 'stream' : 'complete', responseBody: id === 12 ? fullBody : `body-${id}`,
  }), '', token)));
  const snapshot = await store.getSnapshot();
  assert.deepEqual(snapshot.records.map((record) => record.id), ['12', '11', '10', '9', '8', '7', '6', '5', '4', '3']);
  assert.equal(snapshot.records[0].responseBody, fullBody);
  assert.deepEqual(await open(disk).getSnapshot(), snapshot);
  snapshot.records[0].responseBody = '消费者修改';
  snapshot.records.pop();
  assert.equal((await store.getSnapshot()).records[0].responseBody, fullBody);
  assert.equal((await store.getSnapshot()).records.length, 10);
}

// URL 用户信息、编码后的凭据查询名、API key 原文和额外 headers 均不会落盘。
{
  const disk = storage();
  const store = open(disk);
  await store.setEnabled(true);
  const key = 'sk-secret-123';
  await store.record(exchange(1, {
    url: 'https://alice:password@provider.example/v1/chat?api%5Fkey=query-secret&access_token=other-secret&access_token=third-secret&region=cn%2F1#token=fragment-secret',
    model: `model-${key}`, requestBody: `{"secret":"${key}","text":"完整正文"}`,
    responseBody: `data: ${key}\n\ndata: [DONE]\n`, error: `HTTP failed: ${key}`,
    headers: { Authorization: 'Bearer extra-header-secret' },
  }), key);
  const snapshot = await store.getSnapshot();
  const saved = snapshot.records[0];
  assert.equal(saved.url, 'https://provider.example/v1/chat?api%5Fkey=%5BREDACTED%5D&access_token=%5BREDACTED%5D&access_token=%5BREDACTED%5D&region=cn%2F1');
  assert.equal(saved.requestBody, '{"secret":"[REDACTED]","text":"完整正文"}');
  assert.equal(saved.responseBody, 'data: [REDACTED]\n\ndata: [DONE]\n');
  assert.equal(saved.error, 'HTTP failed: [REDACTED]');
  for (const persisted of disk.writes) {
    for (const secret of [key, 'alice', 'password@', 'query-secret', 'other-secret', 'third-secret', 'fragment-secret', 'extra-header-secret']) {
      assert.ok(!persisted.includes(secret), `磁盘写入不得包含 ${secret}`);
    }
  }
  await store.record(exchange(2, { url: 'not a URL', requestBody: '无 key 正文' }), '');
  assert.equal((await store.getSnapshot()).records[0].requestBody, '无 key 正文');
  assert.equal((await store.getSnapshot()).records[0].url, '[无效 URL]');
  assert.deepEqual(await open(disk).getSnapshot(), await store.getSnapshot());
}

// 写入和原子替换失败不伪装保存成功；旧文件可恢复，临时正文清理，后续操作继续工作。
for (const action of ['write', 'move']) {
  const disk = storage();
  const store = open(disk);
  await store.setEnabled(true);
  await store.record(exchange('old'));
  disk.fail(action, '磁盘写入失败');
  await store.record(exchange('new'));
  const snapshot = await store.getSnapshot();
  assert.match(snapshot.error, /保存失败.*磁盘写入失败/);
  assert.deepEqual(snapshot.records.map((record) => record.id), ['old']);
  assert.equal(disk.files.size, 1);
  assert.deepEqual((await open(disk).getSnapshot()).records.map((record) => record.id), ['old']);
  await store.record(exchange('next'));
  assert.equal((await store.getSnapshot()).error, null);
}

// 清空失败应向用户报错并保留可查看的旧记录；关闭失败也不会继续接受捕获。
{
  const disk = storage();
  const store = open(disk);
  await store.setEnabled(true);
  await store.record(exchange('old'));
  disk.fail('write', '清空写入失败');
  await assert.rejects(store.clear(), /清空写入失败/);
  assert.match((await store.getSnapshot()).error, /清空失败/);
  assert.equal((await store.getSnapshot()).records.length, 1);
  disk.fail('delete', '删除被拒绝');
  await assert.rejects(store.setEnabled(false), /删除被拒绝/);
  assert.equal(await store.beginCapture(), null);
  assert.match((await store.getSnapshot()).error, /关闭失败.*删除被拒绝/);
  await store.setEnabled(false);
  assert.equal(disk.files.size, 0);
  assert.deepEqual(await open(disk).getSnapshot(), { enabled: false, records: [], error: null });
}

// 清空和关闭会立刻废弃网络 token；正在写入的旧捕获也会在操作完成前被清理。
for (const mutation of ['clear', 'disable']) {
  const disk = storage();
  const store = open(disk);
  await store.setEnabled(true);
  const token = await store.beginCapture();
  const hold = disk.hold('write');
  const recording = store.record(exchange('writing'), undefined, token);
  await hold.entered;
  const pending = mutation === 'clear' ? store.clear() : store.setEnabled(false);
  const late = store.record(exchange('late'), undefined, token);
  hold.release();
  await Promise.all([recording, pending, late]);
  assert.deepEqual((await store.getSnapshot()).records, []);
  assert.deepEqual((await open(disk).getSnapshot()).records, []);
  if (mutation === 'disable') await store.setEnabled(true);
  await store.record(exchange('after-reenable'), undefined, token);
  assert.deepEqual((await store.getSnapshot()).records, []);
  const freshToken = await store.beginCapture();
  assert.notEqual(freshToken, token);
  await store.record(exchange('fresh'), undefined, freshToken);
  assert.deepEqual((await store.getSnapshot()).records.map((record) => record.id), ['fresh']);
}

// 开始恢复时发生清空，不得给已经越过用户清空边界的请求发放旧 token。
{
  const disk = storage();
  const first = open(disk);
  await first.setEnabled(true);
  await first.record(exchange('old'));
  const store = open(disk);
  const hold = disk.hold('read');
  const capture = store.beginCapture();
  await hold.entered;
  const clearing = store.clear();
  hold.release();
  assert.equal(await capture, null);
  await clearing;
  assert.deepEqual((await open(disk).getSnapshot()).records, []);
}

// 文件是信任边界；损坏/读取失败/目录不可用时默认停止捕获，明确暴露错误并允许用户清理。
for (const mode of ['corrupt', 'shape', 'read', 'unavailable']) {
  const disk = storage();
  const first = open(disk);
  await first.setEnabled(true);
  await first.record(exchange('old'));
  const file = [...disk.files.keys()][0];
  if (mode === 'corrupt') disk.files.set(file, '{broken');
  if (mode === 'shape') disk.files.set(file, JSON.stringify({ version: 1, enabled: true, records: [{}] }));
  if (mode === 'read') disk.fail('read', '读取被拒绝');
  if (mode === 'unavailable') disk.api.cacheDirectory = null;
  const store = open(disk);
  assert.equal(await store.beginCapture(), null);
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.enabled, false);
  assert.deepEqual(snapshot.records, []);
  assert.match(snapshot.error, /读取失败/);
  if (mode === 'unavailable') {
    await assert.rejects(store.setEnabled(true), /缓存目录不可用/);
    assert.match((await store.getSnapshot()).error, /开启失败/);
  } else {
    await store.clear();
    assert.equal(disk.files.size, 0);
    assert.equal((await store.getSnapshot()).error, null);
  }
}

// 页面订阅读取已提交的状态；存储错误也通知，取消订阅后不再回调。
{
  const disk = storage();
  const store = open(disk);
  const observations = [];
  const reads = [];
  const unsubscribe = store.subscribe(() => {
    reads.push(store.getSnapshot().then((snapshot) => { observations.push(snapshot); }));
  });
  const flush = async () => { await Promise.all(reads.splice(0)); };
  await store.setEnabled(true);
  await flush();
  assert.equal(observations.at(-1).enabled, true);
  await store.record(exchange('first'));
  await flush();
  assert.equal(observations.at(-1).records[0].id, 'first');
  disk.fail('write', '空间不足');
  await store.record(exchange('lost'));
  await flush();
  assert.match(observations.at(-1).error, /保存失败.*空间不足/);
  await store.clear();
  await flush();
  assert.deepEqual(observations.at(-1).records, []);
  assert.equal(observations.at(-1).error, null);
  const count = observations.length;
  unsubscribe();
  await store.setEnabled(false);
  assert.equal(observations.length, count);
}

console.log('HTTP exchange diagnostics: 留存、全文、重启恢复、凭据清洗、存储失败与清空/关闭竞态全部通过。');
