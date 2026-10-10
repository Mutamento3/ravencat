/** 群聊自动召唤行为：进程存活期间按最新消息防抖，并与手动/活动计划共享 claim。 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(
  path.join(ROOT, 'src/features/chat/group/application/GroupAutoInvocationScheduler.ts'),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalDateNow = Date.now;
let now = 1_000;
let nextHandle = 0;
const timers = new Map();

globalThis.setTimeout = (callback, delay = 0) => {
  const handle = nextHandle;
  nextHandle += 1;
  timers.set(handle, { callback, dueAt: now + Number(delay) });
  return handle;
};
globalThis.clearTimeout = (handle) => {
  timers.delete(handle);
};
Date.now = () => now;

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function advanceBy(milliseconds) {
  now += milliseconds;
  while (true) {
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.dueAt <= now)
      .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0]);
    if (due.length === 0) {
      break;
    }
    for (const [handle, timer] of due) {
      if (!timers.delete(handle)) {
        continue;
      }
      timer.callback();
      await flushPromises();
    }
  }
}

try {
  const scheduler = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
  );
  const completed = {
    success: true,
    error: null,
    planId: 'plan-1',
    outcome: 'completed',
  };

  const debouncedCalls = [];
  scheduler.scheduleGroupAutoInvocation({
    groupId: 'g-debounce',
    latestUserMessageId: 1,
    invoke: async () => {
      debouncedCalls.push(1);
      return completed;
    },
  });
  await advanceBy(10_000);
  scheduler.scheduleGroupAutoInvocation({
    groupId: 'g-debounce',
    latestUserMessageId: 2,
    invoke: async () => {
      debouncedCalls.push(2);
      return completed;
    },
  });
  await advanceBy(29_999);
  assert.deepEqual(debouncedCalls, [], '最新消息发送后未满 30 秒不得自动召唤');
  await advanceBy(1);
  assert.deepEqual(debouncedCalls, [2], '连续消息必须只按最后一条消息自动召唤一次');

  let acknowledgedCalls = 0;
  scheduler.scheduleGroupAutoInvocation({
    groupId: 'g-manual',
    latestUserMessageId: 8,
    invoke: async () => {
      acknowledgedCalls += 1;
      return completed;
    },
  });
  scheduler.acknowledgeGroupInvocationInput('g-manual', 8);
  await advanceBy(30_000);
  assert.equal(acknowledgedCalls, 0, '手动召唤已固定该消息后必须取消自动召唤');

  const activeRaceOutcomes = ['already_running', 'completed'];
  let activeRaceCalls = 0;
  scheduler.scheduleGroupAutoInvocation({
    groupId: 'g-active',
    latestUserMessageId: 12,
    invoke: async () => {
      const outcome = activeRaceOutcomes[activeRaceCalls];
      activeRaceCalls += 1;
      return {
        success: outcome === 'completed',
        error: outcome === 'already_running' ? '当前已经有一轮召唤正在运行' : null,
        planId: 'plan-active',
        outcome,
      };
    },
  });
  await advanceBy(30_000);
  assert.equal(activeRaceCalls, 1, '活动计划竞争时自动入口只尝试一次 claim');
  scheduler.notifyGroupInvocationSettled('g-active');
  await advanceBy(0);
  assert.equal(activeRaceCalls, 2, '活动计划结束后应立即处理执行期间已到期的新消息');

  let deletedGroupCalls = 0;
  scheduler.scheduleGroupAutoInvocation({
    groupId: 'g-deleted',
    latestUserMessageId: 20,
    invoke: async () => {
      deletedGroupCalls += 1;
      return completed;
    },
  });
  scheduler.cancelGroupAutoInvocation('g-deleted');
  await advanceBy(30_000);
  assert.equal(deletedGroupCalls, 0, '删除群聊时必须取消遗留的自动召唤');
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  Date.now = originalDateNow;
}

console.log('群聊 30 秒自动召唤行为验证通过。');
