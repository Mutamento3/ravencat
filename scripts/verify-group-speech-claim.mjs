/**
 * 群聊召唤 claim 的真实行为验证：SQLite 唯一活动计划、并发 winner/loser、
 * 本轮输入快照、claim 后规划顺序、终态释放与历史重复计划迁移。
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function transpileToModuleUrl(sourceText) {
  const output = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}

function createExecutor(db) {
  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, params = []) => {
      const result = db.prepare(sql).run(...params);
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getFirstAsync: async (sql, params = []) => (
      db.prepare(sql).get(...params) ?? null
    ),
    getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
  };
}

function createCoordinator(db) {
  const executor = createExecutor(db);
  let tail = Promise.resolve();

  const schedule = (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };

  const coordinator = {
    transaction(_meta, task) {
      return schedule(async () => {
        db.exec('BEGIN');
        try {
          const value = await task(executor);
          db.exec('COMMIT');
          return value;
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // 保留原始事务错误。
          }
          throw error;
        }
      });
    },
    openTaskExecutor() {
      return {
        getFirstAsync: (sql, params = []) => schedule(() => executor.getFirstAsync(sql, params)),
        getAllAsync: (sql, params = []) => schedule(() => executor.getAllAsync(sql, params)),
        runAsync: (sql, params = []) => schedule(() => executor.runAsync(sql, params)),
        execAsync: (sql) => schedule(() => executor.execAsync(sql)),
        withExclusiveTransactionAsync: (task) => coordinator.transaction({ name: 'test' }, task),
        withExclusiveWriteScopeAsync: (task) => schedule(() => task(executor)),
      };
    },
  };

  return coordinator;
}

function createSpeechPlanDatabase({ activeIndex = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE group_speech_plans (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      status TEXT NOT NULL,
      invoked_user_message_ids_json TEXT,
      last_included_message_id INTEGER,
      supersedes_plan_id TEXT,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE group_speech_tasks (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      ai_assistant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      sequence_order INTEGER NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      visible_reply_committed INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  if (activeIndex) {
    db.exec(`
      CREATE UNIQUE INDEX idx_group_speech_plans_single_active
        ON group_speech_plans(group_id)
        WHERE status IN ('pending', 'preparing', 'running');
    `);
  }
  return db;
}

function insertSpeechPlan(db, input) {
  db.prepare(`
    INSERT INTO group_speech_plans (
      id, group_id, status, invoked_user_message_ids_json, last_included_message_id,
      started_at, completed_at, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.groupId,
    input.status,
    JSON.stringify(input.invokedUserMessageIds || []),
    input.lastIncludedMessageId ?? null,
    input.startedAt || input.createdAt,
    input.completedAt ?? null,
    input.errorMessage ?? null,
    input.createdAt,
    input.updatedAt || input.createdAt,
  );
}

async function loadGroupChatRepository() {
  const mediaUrl = transpileToModuleUrl(`
    export async function resolveMediaAssetReferenceUri(reference) {
      return reference.mediaAssetId
        ? \`asset://\${reference.mediaAssetId}\`
        : reference.legacyUri;
    }
    // 删除事务内的引用候选收集：本 verifier 只覆盖发言 plan，不构造媒体引用事实。
    export async function collectChatSessionMediaAssetCandidatesInTransaction() {
      return [];
    }
  `);
  const persistenceUrl = transpileToModuleUrl(
    `export const databaseCoordinator = {
      transaction(...args) {
        return globalThis.__GROUP_CLAIM_COORDINATOR__.transaction(...args);
      },
      openTaskExecutor(...args) {
        return globalThis.__GROUP_CLAIM_COORDINATOR__.openTaskExecutor(...args);
      },
    };`,
  );
  const domainUrl = transpileToModuleUrl(
    read('src/features/chat/group/domain/GroupChat.ts'),
  );
  const profileUrl = transpileToModuleUrl('export async function removeConversationWallpaperInTransaction() { return []; }');
  const repositorySource = read(
    'src/features/chat/group/infrastructure/SQLiteGroupChatRepository.ts',
  )
    .replace(/from ['"]@features\/profile['"]/g, `from '${profileUrl}'`)
    .replace(/from ['"]@features\/media['"]/g, `from '${mediaUrl}'`)
    .replace(/from ['"]@platform\/persistence['"]/g, `from '${persistenceUrl}'`)
    .replace(/from ['"]\.\.\/domain\/GroupChat['"]/g, `from '${domainUrl}'`)
    .replace(/from ['"]\.\.\/domain\/GroupChatRepository['"]/g, `from '${transpileToModuleUrl(read('src/features/chat/group/domain/GroupChatRepository.ts'))}'`);
  const repositoryUrl = transpileToModuleUrl(repositorySource);
  return import(repositoryUrl);
}

async function loadGroupChatManagement() {
  const runtimeUrl = transpileToModuleUrl(`
    export function getChatGroupRuntimeDependencies() {
      return globalThis.__GROUP_ADMIN_MANAGEMENT_DEPS__;
    }
  `);
  const schedulerUrl = transpileToModuleUrl(`
    export function cancelGroupAutoInvocation() {}
  `);
  const mediaUrl = transpileToModuleUrl(`
    export const MEDIA_ASSET_STORAGE_BACKEND = { persistentImage: 'persistent-image' };
    export async function createMediaAssetWithReference() { throw new Error('本场景没有头像文件准备'); }
    export async function collectChatSessionMediaAssetCandidates() {
      return globalThis.__GROUP_ADMIN_MEDIA_STATE__?.sessionCandidates ?? [];
    }
    export async function releaseMediaAssetCandidates(assetIds) {
      globalThis.__GROUP_ADMIN_MEDIA_STATE__?.releaseCalls?.push([...assetIds]);
    }
  `);
  const source = read('src/features/chat/group/application/GroupChatManagement.ts')
    .replace(/from ['"]\.\/ChatGroupRuntime['"]/g, `from '${runtimeUrl}'`)
    .replace(/from ['"]\.\/GroupAutoInvocationScheduler['"]/g, `from '${schedulerUrl}'`)
    .replace(/from ['"]@features\/media['"]/g, `from '${mediaUrl}'`);
  return import(transpileToModuleUrl(source));
}

async function loadGroupParticipantDirectory() {
  const runtimeUrl = transpileToModuleUrl(`
    export function getChatGroupRuntimeDependencies() {
      return globalThis.__GROUP_PARTICIPANT_DIRECTORY_DEPS__;
    }
  `);
  const source = read('src/features/chat/group/application/GroupParticipantDirectory.ts')
    .replace(/from ['"]\.\/ChatGroupRuntime['"]/g, `from '${runtimeUrl}'`);
  return import(transpileToModuleUrl(source));
}

async function loadGroupSpeakerPlanning() {
  const aiUrl = transpileToModuleUrl(`
    export function getErrorDisplayInfo(error) {
      const message = error instanceof Error ? error.message : String(error);
      return { message: '统一错误：' + message };
    }
    export function createAIClient() {
      return {
        async chat() {
          const state = globalThis.__GROUP_ADMIN_PLANNING_STATE__;
          state.adminCalls = (state.adminCalls || 0) + 1;
          if (state.adminError) {
            throw new Error(state.adminError);
          }
          if (state.adminRequestResult) {
            return state.adminRequestResult;
          }
          return { success: true, text: state.adminResponse ?? '["member_1"]' };
        },
      };
    }
  `);
  const metadataUrl = transpileToModuleUrl(`
    export function getGroupChatMentions(message) {
      if (!message?.metadataJson) return [];
      const parsed = JSON.parse(message.metadataJson);
      return Array.isArray(parsed?.groupChat?.mentions) ? parsed.groupChat.mentions : [];
    }
  `);
  const messageRuntimeUrl = transpileToModuleUrl(`
    export function getChatMessageRuntimeDependencies() {
      return globalThis.__GROUP_ADMIN_PLANNING_MESSAGE_DEPS__;
    }
  `);
  const groupRuntimeUrl = transpileToModuleUrl(`
    export function getChatGroupRuntimeDependencies() {
      return globalThis.__GROUP_ADMIN_PLANNING_GROUP_DEPS__;
    }
  `);
  const replyRuntimeUrl = transpileToModuleUrl(`
    export function getChatReplyRuntimeDependencies() {
      return {
        prompt: {
          async assembleStandalone() {
            return { systemPrompt: '', modelMessages: [] };
          },
        },
      };
    }
  `);
  const promptBlocksUrl = transpileToModuleUrl(`
    export function buildGroupAdminPromptBlocks() { return []; }
  `);
  const parserUrl = transpileToModuleUrl(`
    export function createGroupAdminMemberAliases(members) {
      return members.map((member, index) => ({ alias: 'member_' + (index + 1), member }));
    }
    export function buildGroupAdminInput(params) {
      globalThis.__GROUP_ADMIN_PLANNING_STATE__.adminRecentMessages = params.recentMessages;
      return 'admin input';
    }
    export function normalizeAdminSpeakerIds(_text, candidates) {
      const parsed = JSON.parse(_text.trim());
      if (!Array.isArray(parsed)) throw new Error('管理员返回内容必须是 JSON 字符串数组');
      const byAlias = new Map(candidates.map((entry) => [entry.alias, entry.member]));
      const selected = [];
      const seen = new Set();
      for (const value of parsed) {
        const member = typeof value === 'string' ? byAlias.get(value.trim()) : null;
        if (!member || seen.has(member.aiAssistantId)) continue;
        seen.add(member.aiAssistantId);
        selected.push(member.aiAssistantId);
      }
      if (parsed.length > 0 && selected.length === 0) throw new Error('管理员未返回任何有效候选成员');
      return selected;
    }
  `);
  const source = read('src/features/chat/group/application/GroupSpeakerPlanning.ts')
    .replace(/from ['"]@shared\/runtime\/abortSignal['"]/g,
      `from '${transpileToModuleUrl(read('src/shared/runtime/abortSignal.ts'))}'`)
    .replace(/from ['"]@platform\/ai['"]/g, `from '${aiUrl}'`)
    .replace(
      /from ['"]\.\.\/\.\.\/messages\/application\/ChatMessageRuntime['"]/g,
      `from '${messageRuntimeUrl}'`,
    )
    .replace(
      /from ['"]\.\.\/\.\.\/messages\/domain\/chatMessageMetadata['"]/g,
      `from '${metadataUrl}'`,
    )
    .replace(/from ['"]\.\/ChatGroupRuntime['"]/g, `from '${groupRuntimeUrl}'`)
    .replace(
      /from ['"]\.\.\/\.\.\/reply\/application\/ChatReplyRuntimeDependencies['"]/g,
      `from '${replyRuntimeUrl}'`,
    )
    .replace(/from ['"]\.\/GroupTaskPromptBlocks['"]/g, `from '${promptBlocksUrl}'`)
    .replace(/from ['"]\.\/GroupAdminReplyParser['"]/g, `from '${parserUrl}'`);
  return import(transpileToModuleUrl(source));
}

function createAdminConfigDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE group_chat_admin_configs (
      group_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT,
      api_base_url TEXT,
      system_prompt TEXT,
      temperature REAL DEFAULT 0.7,
      top_p REAL DEFAULT 1.0,
      max_tokens INTEGER,
      context_message_count INTEGER NOT NULL DEFAULT 20
        CHECK (context_message_count BETWEEN 0 AND 100),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO group_chat_admin_configs (
      group_id, name, model, api_key, api_base_url, system_prompt,
      temperature, top_p, max_tokens, context_message_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'g1', '管理员', 'admin-model', null, null, null,
    0.7, 1, 2000, 20, '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z',
  );
  return db;
}

function createGroupProfileDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE group_chats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      avatar_media_asset_id TEXT,
      last_message TEXT,
      last_time TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO group_chats (
      id, name, avatar, last_message, last_time, is_pinned, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'g-profile',
    '旧群名',
    'file:///persistent-media/avatars/group/old.jpg',
    '最后一条消息',
    '2026-08-12T10:00:00.000Z',
    0,
    '2026-08-12T09:00:00.000Z',
    '2026-08-12T10:00:00.000Z',
  );
  return db;
}

async function verifyGroupProfilePersistence(GroupChatRepository) {
  const db = createGroupProfileDatabase();
  globalThis.__GROUP_CLAIM_COORDINATOR__ = createCoordinator(db);
  const repository = new GroupChatRepository();

  const renamed = await repository.updateProfile('g-profile', { name: '新群名' });
  assert.equal(renamed.name, '新群名');
  assert.equal(
    renamed.avatar,
    'file:///persistent-media/avatars/group/old.jpg',
    '只改名称时必须保留已提交头像',
  );

  const resetAvatar = await repository.updateProfile('g-profile', { avatar: null });
  assert.equal(resetAvatar.name, '新群名', '只改头像时必须保留群名称');
  assert.equal(resetAvatar.avatar, null);
  assert.equal(
    await repository.updateProfile('missing-group', { name: '不存在' }),
    null,
    '不存在的群不能伪装为资料更新成功',
  );

  const persisted = db.prepare('SELECT name, avatar FROM group_chats WHERE id = ?')
    .get('g-profile');
  assert.equal(persisted.name, '新群名');
  assert.equal(persisted.avatar, null);
  db.close();
}

async function verifyGroupProfileValidation(updateGroupChatProfile) {
  const savedInputs = [];
  globalThis.__GROUP_ADMIN_MEDIA_STATE__ = {
    sessionCandidates: ['cascaded-session-asset'],
    releaseCalls: [],
  };
  globalThis.__GROUP_ADMIN_MANAGEMENT_DEPS__ = {
    groups: {
      getById: async (groupId) => ({
        group: {
          id: groupId,
          name: '现有群名',
          avatar: 'file:///persistent-media/avatars/group/old.jpg',
          avatarMediaAssetId: 'group-avatar-old',
        },
        members: [],
        adminConfig: null,
      }),
      updateProfile: async (groupId, input) => {
        savedInputs.push({ groupId, input });
        return {
          id: groupId,
          name: input.name ?? '现有群名',
          avatar: input.avatar ?? null,
          lastMessage: null,
          lastTime: null,
          isPinned: false,
          createdAt: '2026-08-12T09:00:00.000Z',
          updatedAt: '2026-08-13T09:00:00.000Z',
        };
      },
    },
  };

  const updated = await updateGroupChatProfile(' g-profile ', {
    name: ' 新群名 ',
    avatar: ' file:///persistent-media/avatars/group/new.jpg ',
  });
  assert.equal(updated.name, '新群名');
  assert.deepEqual(savedInputs, [{
    groupId: 'g-profile',
    input: {
      name: '新群名',
      avatar: 'file:///persistent-media/avatars/group/new.jpg',
    },
  }]);
  // 头像替换：旧群头像进入 targeted release，不做全库媒体扫描。
  assert.deepEqual(
    globalThis.__GROUP_ADMIN_MEDIA_STATE__.releaseCalls,
    [['group-avatar-old']],
    '群头像替换必须只释放旧头像，不得触发全局 media GC',
  );

  // 只改名字时不得触发任何媒体裁决。
  await updateGroupChatProfile('g-profile', { name: '再改名' });
  assert.equal(
    globalThis.__GROUP_ADMIN_MEDIA_STATE__.releaseCalls.length,
    1,
    '没有头像变更时不得调用媒体释放',
  );

  await assert.rejects(() => updateGroupChatProfile('', { name: '群名' }), /群聊不存在/);
  await assert.rejects(() => updateGroupChatProfile('g-profile', {}), /没有需要更新/);
  await assert.rejects(() => updateGroupChatProfile('g-profile', { name: '   ' }), /请输入群聊名称/);
  await assert.rejects(
    () => updateGroupChatProfile('g-profile', { name: '群'.repeat(31) }),
    /不能超过 30 个字符/,
  );

  globalThis.__GROUP_ADMIN_MANAGEMENT_DEPS__ = {
    groups: { updateProfile: async () => null },
  };
  await assert.rejects(
    () => updateGroupChatProfile('missing-group', { name: '群名' }),
    /群聊不存在/,
  );
}

async function verifyAdminConfigPersistence(GroupChatRepository) {
  const db = createAdminConfigDatabase();
  globalThis.__GROUP_CLAIM_COORDINATOR__ = createCoordinator(db);
  const repository = new GroupChatRepository();

  assert.equal((await repository.getAdminConfig('g1')).contextMessageCount, 20);
  await repository.updateAdminConfig('g1', {
    model: 'admin-model',
    contextMessageCount: 100,
  });
  assert.equal(
    (await new GroupChatRepository().getAdminConfig('g1')).contextMessageCount,
    100,
    '管理员上下文数量保存后必须能从 SQLite 重新读取',
  );
  await repository.updateAdminConfig('g1', {
    model: 'admin-model',
    contextMessageCount: 0,
  });
  assert.equal((await repository.getAdminConfig('g1')).contextMessageCount, 0);
  await Promise.all([
    repository.updateAdminConfig('g1', { temperature: 1.2 }),
    repository.updateAdminConfig('g1', { apiKey: 'new-key' }),
  ]);
  const confirmed = await repository.getAdminConfig('g1');
  assert.equal(confirmed.temperature, 1.2);
  assert.equal(confirmed.apiKey, 'new-key');
  assert.equal(confirmed.contextMessageCount, 0);
  assert.equal(confirmed.model, 'admin-model');
  await repository.updateAdminConfig('g1', { apiKey: null });
  const cleared = await repository.getAdminConfig('g1');
  assert.equal(cleared.apiKey, null);
  assert.equal(cleared.temperature, 1.2);
  await repository.updateAdminConfig('g1', { temperature: 0, topP: 0 });
  const explicitZero = await repository.getAdminConfig('g1');
  assert.equal(explicitZero.temperature, 0);
  assert.equal(explicitZero.topP, 0);
  await repository.updateAdminConfig('g1', { temperature: null, topP: null });
  const defaultSampling = await new GroupChatRepository().getAdminConfig('g1');
  assert.equal(defaultSampling.temperature, null, '管理员温度留空不能在重读时补成本地默认值');
  assert.equal(defaultSampling.topP, null, '管理员 Top P 留空不能在重读时补成本地默认值');
  assert.equal(await repository.updateAdminConfig('missing-group', { temperature: 1 }), null);
  db.close();
}

async function verifyAdminConfigCommand(updateGroupChatAdminConfig) {
  const writes = [];
  globalThis.__GROUP_ADMIN_MANAGEMENT_DEPS__ = {
    groups: {
      updateAdminConfig: async (_groupId, input) => { writes.push(input); return input; },
    },
  };
  await updateGroupChatAdminConfig('g1', { contextMessageCount: 0 });
  await updateGroupChatAdminConfig('g1', { contextMessageCount: 100 });
  await updateGroupChatAdminConfig('g1', { apiKey: null });
  assert.deepEqual(writes, [{ contextMessageCount: 0 }, { contextMessageCount: 100 }, { apiKey: null }],
    '应用层信任页面输入契约，只转交本次修改；不得要求重发模型或清空未修改凭据');
}

async function verifyAdminRecentContext(prepareGroupSpeechPlan) {
  const allMessages = Array.from({ length: 105 }, (_, index) => ({
    id: index + 1,
    text: `消息${index + 1}`,
    isMe: index % 2 === 0,
    senderType: index % 2 === 0 ? 'user' : 'assistant',
    agentId: index % 2 === 0 ? null : 'agent-1',
  }));
  const state = { adminRecentMessages: null, historyReads: 0 };
  globalThis.__GROUP_ADMIN_PLANNING_STATE__ = state;
  globalThis.__GROUP_ADMIN_PLANNING_MESSAGE_DEPS__ = {
    messages: {
      async getMessages(_groupId, params) {
        state.historyReads += 1;
        const selected = params.order === 'DESC'
          ? allMessages.slice(-params.limit)
          : allMessages.slice(0, params.limit);
        return { messages: selected, hasMore: allMessages.length > params.limit, nextCursor: null };
      },
    },
  };
  globalThis.__GROUP_ADMIN_PLANNING_GROUP_DEPS__ = {
    assistantDirectory: {
      getById: async () => ({ id: 'ai-1', agentId: 'agent-1', isBlocked: false }),
    },
  };
  const member = {
    id: 'member-1',
    groupId: 'g1',
    aiAssistantId: 'ai-1',
    agentId: 'agent-1',
    displayOrder: 0,
    enabled: true,
    name: '成员一',
    createdAt: '2026-08-12T10:00:00.000Z',
    updatedAt: '2026-08-12T10:00:00.000Z',
  };
  const details = {
    group: { id: 'g1', name: '测试群' },
    members: [member],
    adminConfig: {
      groupId: 'g1',
      name: '管理员',
      model: 'admin-model',
      apiKey: null,
      apiBaseUrl: null,
      systemPrompt: null,
      temperature: 0.7,
      topP: 1,
      maxTokens: 2000,
      contextMessageCount: 3,
      createdAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-12T10:00:00.000Z',
    },
  };
  const pending = [{ id: 105, text: '消息105', isMe: true, senderType: 'user' }];

  await prepareGroupSpeechPlan(details, pending);
  assert.deepEqual(
    state.adminRecentMessages.map((message) => message.id),
    [103, 104, 105],
    '管理员必须读取最新 N 条消息，并保持时间正序交给 Prompt',
  );

  details.adminConfig.contextMessageCount = 100;
  state.adminRecentMessages = null;
  await prepareGroupSpeechPlan(details, pending);
  assert.equal(state.adminRecentMessages.length, 100);
  assert.equal(state.adminRecentMessages[0].id, 6);
  assert.equal(state.adminRecentMessages.at(-1).id, 105);

  details.adminConfig.contextMessageCount = 0;
  state.adminRecentMessages = null;
  await prepareGroupSpeechPlan(details, pending);
  assert.deepEqual(state.adminRecentMessages, [], '配置为 0 时管理员不得读取历史消息');
  assert.equal(state.historyReads, 2, '配置为 0 时不应发起历史查询');
}

async function verifyAdminSelectionSemantics(prepareGroupSpeechPlan) {
  const members = ['A', 'B', 'C'].map((name, index) => ({
    id: `member-${index + 1}`,
    groupId: 'g1',
    aiAssistantId: `ai-${name}`,
    agentId: `agent-${name}`,
    displayOrder: index,
    enabled: true,
    name,
  }));
  const details = {
    group: { id: 'g1', name: '测试群' },
    members,
    adminConfig: {
      groupId: 'g1', name: '管理员', model: 'cheap-model', apiKey: null,
      apiBaseUrl: null, systemPrompt: null, temperature: 0.7, topP: 1,
      maxTokens: 100, contextMessageCount: 3,
    },
  };
  const state = {
    adminCalls: 0,
    adminResponse: '["member_1"]',
    historyReads: 0,
    blockedAssistantIds: new Set(),
  };
  globalThis.__GROUP_ADMIN_PLANNING_MESSAGE_DEPS__ = {
    messages: {
      async getMessages() {
        state.historyReads += 1;
        return { messages: [], hasMore: false, nextCursor: null };
      },
    },
  };
  globalThis.__GROUP_ADMIN_PLANNING_GROUP_DEPS__ = {
    assistantDirectory: {
      getById: async (id) => ({
        id,
        agentId: `agent-${id.slice(3)}`,
        isBlocked: state.blockedAssistantIds.has(id),
      }),
    },
  };

  globalThis.__GROUP_ADMIN_PLANNING_STATE__ = state;
  const mentioned = await prepareGroupSpeechPlan(details, [{
    id: 1,
    text: '@B @A 请回答',
    isMe: true,
    senderType: 'user',
    metadataJson: JSON.stringify({
      groupChat: {
        mentions: [
          { actorType: 'user', target: { targetType: 'assistant', assistantId: 'ai-B', displayNameAtSend: 'B' } },
          { actorType: 'user', target: { targetType: 'assistant', assistantId: 'ai-A', displayNameAtSend: 'A' } },
          { actorType: 'user', target: { targetType: 'assistant', assistantId: 'ai-B', displayNameAtSend: 'B' } },
        ],
      },
    }),
  }]);
  assert.equal(state.adminCalls, 0, '存在结构化 @ 时不得请求管理员');
  assert.equal(state.historyReads, 0, '存在结构化 @ 时不得读取管理员专用上下文');
  assert.deepEqual(
    mentioned.sequenceMembers.map((member) => member.aiAssistantId),
    ['ai-B', 'ai-A'],
    '@ 成员必须按用户选择顺序去重进入队列',
  );
  assert.deepEqual([...mentioned.mentionedAssistantIds], ['ai-B', 'ai-A']);

  state.blockedAssistantIds = new Set(['ai-B']);
  const blockedOnlyMention = await prepareGroupSpeechPlan(details, [{
    id: 6,
    text: '@B 请回答',
    isMe: true,
    senderType: 'user',
    metadataJson: JSON.stringify({
      groupChat: {
        mentions: [{ actorType: 'user', target: { targetType: 'assistant', assistantId: 'ai-B', displayNameAtSend: 'B' } }],
      },
    }),
  }]);
  assert.deepEqual(
    blockedOnlyMention.sequenceMembers,
    [],
    'blocked 群成员仍是有效用户 @，但不得获得发言任务',
  );
  assert.equal(state.adminCalls, 0, '只 @ blocked 群成员时不得回退管理员');
  assert.equal(state.historyReads, 0, '只 @ blocked 群成员时不得读取管理员上下文');

  const mixedBlockedMention = await prepareGroupSpeechPlan(details, [{
    id: 7,
    text: '@B @C 请回答',
    isMe: true,
    senderType: 'user',
    metadataJson: JSON.stringify({
      groupChat: {
        mentions: [
          { actorType: 'user', target: { targetType: 'assistant', assistantId: 'ai-B', displayNameAtSend: 'B' } },
          { actorType: 'user', target: { targetType: 'assistant', assistantId: 'ai-C', displayNameAtSend: 'C' } },
        ],
      },
    }),
  }]);
  assert.deepEqual(
    mixedBlockedMention.sequenceMembers.map((member) => member.aiAssistantId),
    ['ai-C'],
    'blocked 与可发言成员同时被 @ 时只为可发言成员创建任务',
  );
  assert.equal(state.adminCalls, 0, '混合 @ 仍必须完全绕过管理员');
  state.blockedAssistantIds = new Set();

  state.adminResponse = '[]';
  const emptySelection = await prepareGroupSpeechPlan(details, [{
    id: 2, text: '大家怎么看', isMe: true, senderType: 'user', metadataJson: null,
  }]);
  assert.deepEqual(
    emptySelection.sequenceMembers.map((member) => member.aiAssistantId),
    ['ai-A', 'ai-B', 'ai-C'],
    '无 @ 且管理员返回空数组时必须按成员顺序召唤全部可用成员',
  );

  state.adminResponse = 'not-json';
  const invalidSelection = await prepareGroupSpeechPlan(details, [{
    id: 3, text: '继续', isMe: true, senderType: 'user', metadataJson: null,
  }]);
  assert.deepEqual(
    invalidSelection.sequenceMembers.map((member) => member.aiAssistantId),
    ['ai-A', 'ai-B', 'ai-C'],
    '管理员输出无效时不得重试模型，必须直接召唤全部可用成员',
  );
  assert.equal(invalidSelection.adminRequestFailureNotice, null,
    '管理员输出无效的兜底不得生成用户可见失败消息');
  assert.equal(state.adminCalls, 2, '两次无 @ 规划各只允许一次管理员请求');

  state.adminResponse = undefined;
  state.adminError = 'network down';
  const failedSelection = await prepareGroupSpeechPlan(details, [{
    id: 4, text: '再继续', isMe: true, senderType: 'user', metadataJson: null,
  }]);
  assert.deepEqual(
    failedSelection.sequenceMembers.map((member) => member.aiAssistantId),
    ['ai-A', 'ai-B', 'ai-C'],
    '管理员请求失败时不得发起第二次请求，必须直接召唤全部可用成员',
  );
  assert.equal(
    failedSelection.adminRequestFailureNotice.text,
    '管理员调度失败，本次已切换为全量召唤：统一错误：network down',
    '管理员请求失败必须使用统一错误映射并明确告知已切换全量召唤',
  );
  assert.equal(state.adminCalls, 3);

  state.adminError = null;
  state.adminRequestResult = { success: false, text: '', error: '401 invalid api key' };
  const rejectedRequest = await prepareGroupSpeechPlan(details, [{
    id: 5, text: '再试一次', isMe: true, senderType: 'user', metadataJson: null,
  }]);
  assert.deepEqual(
    rejectedRequest.sequenceMembers.map((member) => member.aiAssistantId),
    ['ai-A', 'ai-B', 'ai-C'],
  );
  assert.equal(
    rejectedRequest.adminRequestFailureNotice.text,
    '管理员调度失败，本次已切换为全量召唤：统一错误：401 invalid api key',
    '模型客户端返回失败结果时也必须提示统一错误并全量召唤',
  );
}

async function verifyGroupParticipantDirectory(getGroupParticipantDirectory) {
  const assistantProfiles = new Map([
    ['ai-live', {
      id: 'ai-live',
      agentId: 'agent-live',
      name: '同名助手',
      avatar: 'file:///avatars/live.jpg',
      avatarMediaAssetId: null,
      isBlocked: false,
    }],
    ['ai-blocked', {
      id: 'ai-blocked',
      agentId: 'agent-blocked',
      name: '同名助手',
      avatar: 'file:///avatars/blocked.jpg',
      avatarMediaAssetId: null,
      isBlocked: true,
    }],
    ['ai-disabled', {
      id: 'ai-disabled',
      agentId: 'agent-disabled',
      name: '已停用助手',
      avatar: null,
      avatarMediaAssetId: null,
      isBlocked: false,
    }],
  ]);
  const members = [
    ['ai-live', 'agent-stale-live', true],
    ['ai-blocked', 'agent-stale-blocked', true],
    ['ai-disabled', 'agent-disabled', false],
    ['ai-deleted', 'agent-deleted', true],
  ].map(([assistantId, agentId, enabled], index) => ({
    id: `member-${index + 1}`,
    groupId: 'g-directory',
    aiAssistantId: assistantId,
    agentId,
    displayOrder: index,
    enabled,
  }));
  globalThis.__GROUP_PARTICIPANT_DIRECTORY_DEPS__ = {
    groups: {
      getById: async (groupId) => groupId === 'g-directory'
        ? { group: { id: groupId }, members, adminConfig: {} }
        : null,
    },
    currentUserDirectory: {
      getCurrent: async () => ({
        id: 'user-self',
        name: '当前用户',
        avatar: 'file:///avatars/user.jpg',
        avatarMediaAssetId: null,
      }),
    },
    assistantDirectory: {
      getById: async (assistantId) => assistantProfiles.get(assistantId) ?? null,
    },
  };

  const directory = await getGroupParticipantDirectory('g-directory');
  assert.deepEqual(directory.currentUser, {
    targetType: 'user',
    userProfileId: 'user-self',
    displayName: '当前用户',
    avatar: 'file:///avatars/user.jpg',
    avatarMediaAssetId: null,
  });
  assert.deepEqual(
    directory.assistants,
    [
      {
        targetType: 'assistant',
        assistantId: 'ai-live',
        displayName: '同名助手',
        avatar: 'file:///avatars/live.jpg',
        avatarMediaAssetId: null,
      },
      {
        targetType: 'assistant',
        assistantId: 'ai-blocked',
        displayName: '同名助手',
        avatar: 'file:///avatars/blocked.jpg',
        avatarMediaAssetId: null,
      },
    ],
    '目录应保留 blocked 成员和重名成员，并排除 disabled 与已删除成员',
  );
  assert.ok(
    directory.assistants.every((participant) => !Object.hasOwn(participant, 'agentId')),
    '展示目录不得暴露内部 agentId',
  );
  assert.equal(await getGroupParticipantDirectory('missing-group'), null);
}

async function loadMigration57() {
  const source = read('src/platform/persistence/sqlite/migrations.ts');
  const marker = '// 迁移57';
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, 'migrations.ts 必须包含迁移57');
  const nextMigrationIndex = source.indexOf('// 迁移58', markerIndex);
  assert.ok(nextMigrationIndex > markerIndex, '迁移57 必须位于迁移58之前');
  const body = source.slice(markerIndex, nextMigrationIndex);
  const migrationUrl = transpileToModuleUrl(
    `export async function runMigration57(db) {\n${body}\n}`,
  );
  return import(migrationUrl);
}

async function loadMigration58() {
  const source = read('src/platform/persistence/sqlite/migrations.ts');
  const marker = '// 迁移58';
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, 'migrations.ts 必须包含迁移58');
  const nextMigrationIndex = source.indexOf('// 迁移59', markerIndex);
  assert.ok(nextMigrationIndex > markerIndex, '迁移58 必须位于迁移59之前');
  const body = source.slice(markerIndex, nextMigrationIndex);
  return import(transpileToModuleUrl(
    `export async function runMigration58(db) {\n${body}\n}`,
  ));
}

async function verifyMigration58(runMigration58) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE group_chat_admin_configs (
      group_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT,
      api_base_url TEXT,
      system_prompt TEXT,
      temperature REAL DEFAULT 0.7,
      top_p REAL DEFAULT 1.0,
      max_tokens INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO group_chat_admin_configs (
      group_id, name, model, created_at, updated_at
    ) VALUES (
      'g1', '管理员', 'admin-model',
      '2026-08-12T10:00:00.000Z', '2026-08-12T10:00:00.000Z'
    );
  `);

  await runMigration58(createExecutor(db));
  assert.equal(
    db.prepare(`SELECT context_message_count FROM group_chat_admin_configs WHERE group_id = 'g1'`)
      .get().context_message_count,
    20,
    '旧群管理员配置升级后应使用既有界面默认值 20',
  );
  db.prepare(`UPDATE group_chat_admin_configs SET context_message_count = 0 WHERE group_id = 'g1'`).run();
  db.prepare(`UPDATE group_chat_admin_configs SET context_message_count = 100 WHERE group_id = 'g1'`).run();
  assert.throws(
    () => db.prepare(`UPDATE group_chat_admin_configs SET context_message_count = 101 WHERE group_id = 'g1'`).run(),
    /constraint/i,
  );
  await runMigration58(createExecutor(db));
  assert.equal(
    db.prepare(`PRAGMA table_info('group_chat_admin_configs')`).all()
      .filter((column) => column.name === 'context_message_count').length,
    1,
    '迁移58重复执行不得重复建列',
  );
  db.close();
}

async function verifyMigration57(runMigration57) {
  const db = createSpeechPlanDatabase({ activeIndex: false });
  insertSpeechPlan(db, {
    id: 'old-g1',
    groupId: 'g1',
    status: 'running',
    invokedUserMessageIds: [1],
    lastIncludedMessageId: 1,
    createdAt: '2026-08-12T10:00:00.000Z',
  });
  insertSpeechPlan(db, {
    id: 'new-g1',
    groupId: 'g1',
    status: 'pending',
    invokedUserMessageIds: [2],
    lastIncludedMessageId: 2,
    createdAt: '2026-08-12T11:00:00.000Z',
  });
  insertSpeechPlan(db, {
    id: 'only-g2',
    groupId: 'g2',
    status: 'running',
    invokedUserMessageIds: [3],
    lastIncludedMessageId: 3,
    createdAt: '2026-08-12T10:00:00.000Z',
  });

  await runMigration57(createExecutor(db));

  const rows = db.prepare(
    `SELECT id, group_id, status, error_message
     FROM group_speech_plans
     ORDER BY id ASC`,
  ).all();
  assert.deepEqual(
    rows.map((row) => [row.id, row.status]),
    [
      ['new-g1', 'pending'],
      ['old-g1', 'failed'],
      ['only-g2', 'running'],
    ],
    '迁移57 应保留每群最新活动计划并终止旧重复行',
  );
  assert.match(
    rows.find((row) => row.id === 'old-g1').error_message,
    /重复群聊召唤/,
  );
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'index' AND name = 'idx_group_speech_plans_single_active'`,
    ).get().count,
    1,
  );

  assert.throws(
    () => insertSpeechPlan(db, {
      id: 'duplicate-g1',
      groupId: 'g1',
      status: 'running',
      invokedUserMessageIds: [4],
      lastIncludedMessageId: 4,
      createdAt: '2026-08-12T12:00:00.000Z',
    }),
    /constraint/i,
    '迁移后同群第二条 active plan 必须被数据库约束拒绝',
  );

  await runMigration57(createExecutor(db));
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM group_speech_plans
       WHERE group_id = 'g1' AND status IN ('pending', 'running')`,
    ).get().count,
    1,
    '迁移57 重复执行必须保持幂等',
  );
  db.close();
}

async function verifyRepositoryClaim(GroupChatRepository) {
  const db = createSpeechPlanDatabase();
  globalThis.__GROUP_CLAIM_COORDINATOR__ = createCoordinator(db);
  const repository = new GroupChatRepository();
  insertSpeechPlan(db, {
    id: 'previous-g1',
    groupId: 'g1',
    status: 'completed',
    invokedUserMessageIds: [20],
    lastIncludedMessageId: 20,
    createdAt: '2026-08-12T11:00:00.000Z',
  });
  db.exec(`
    CREATE TABLE group_messages (
      id INTEGER PRIMARY KEY,
      group_id TEXT NOT NULL,
      is_me INTEGER NOT NULL,
      sender_type TEXT NOT NULL
    );
    INSERT INTO group_messages (id, group_id, is_me, sender_type)
    VALUES (19, 'g1', 1, 'user'), (20, 'g1', 1, 'user'), (21, 'g1', 1, 'user');
  `);
  const [first, second] = await Promise.all([
    repository.tryClaimGroupSpeechPlan('g1'),
    repository.tryClaimGroupSpeechPlan('g1'),
  ]);
  assert.equal(
    [first, second].filter((result) => result.claimed).length,
    1,
    '并发 claim 只能有一个 winner',
  );
  const winner = first.claimed ? first : second;
  const loser = first.claimed ? second : first;
  assert.equal(winner.plan.status, 'pending');
  assert.equal(
    winner.plan.inputUpperBoundMessageId,
    null,
    '新占位计划尚未捕获输入时不得伪装成上一轮快照',
  );
  assert.equal(
    winner.previousInputUpperBoundMessageId,
    20,
    'winner 应单独取得上一轮输入上界，用于捕获本轮新用户消息',
  );
  assert.equal(loser.claimed, false);
  assert.equal(loser.plan?.id, winner.plan.id, 'loser 必须返回现存 active plan');
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM group_speech_plans
       WHERE group_id = 'g1' AND status IN ('pending', 'running')`,
    ).get().count,
    1,
  );

  const emptyInputLoser = await repository.tryClaimGroupSpeechPlan('g1');
  assert.equal(emptyInputLoser.claimed, false);
  assert.equal(emptyInputLoser.plan?.id, winner.plan.id);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM group_speech_plans WHERE group_id = 'g1'`).get().count,
    2,
    'active claim 失败时不得创建第二条占位计划',
  );

  // 与真实召唤流程一致：先 pending → preparing 接管，再捕获输入。
  assert.equal(await repository.beginSpeechPlanPreparation(winner.plan.id), true);
  assert.equal(await repository.updateSpeechPlanInput(winner.plan.id, [21], 21), true);
  db.prepare(
    `UPDATE group_speech_plans
     SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run('2026-08-12T12:01:00.000Z', '2026-08-12T12:01:00.000Z', winner.plan.id);
  const next = await repository.tryClaimGroupSpeechPlan('g1');
  assert.equal(next.claimed, true, '终态计划完成后下一轮可以 claim');
  assert.notEqual(next.plan.id, winner.plan.id);
  assert.equal(next.plan.inputUpperBoundMessageId, null);
  assert.equal(next.previousInputUpperBoundMessageId, 21);
  await repository.beginSpeechPlanPreparation(next.plan.id);
  await repository.updateSpeechPlanInput(next.plan.id, [22], 22);
  db.prepare(
    `UPDATE group_speech_plans
     SET status = 'failed', completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run('2026-08-12T12:02:00.000Z', '2026-08-12T12:02:00.000Z', next.plan.id);
  const retry = await repository.tryClaimGroupSpeechPlan('g1');
  assert.equal(retry.claimed, true, '调度失败后必须允许重试');
  assert.equal(
    retry.previousInputUpperBoundMessageId,
    21,
    '失败计划不得推进已完成输入边界或吞掉本轮消息',
  );
  db.close();
}

async function verifyInvocationContextCapture(captureGroupInvocationContext) {
  const currentMessages = Array.from({ length: 125 }, (_, index) => ({
    id: index + 21,
    text: `本轮消息${index + 1}`,
    isMe: true,
    senderType: 'user',
  }));
  globalThis.__GROUP_ADMIN_PLANNING_MESSAGE_DEPS__ = {
    messages: {
      async getLatestMessage() {
        return { id: 145 };
      },
      async listUserMessagesInRange() {
        return currentMessages;
      },
    },
  };

  const captured = await captureGroupInvocationContext('g1', 20);
  assert.deepEqual(captured.currentUserMessages.map((message) => message.id),
    currentMessages.map((message) => message.id),
    '本轮输入必须按固定区间读取，超过旧的 120 条扫描上限也不能丢消息',
  );
  assert.equal(captured.inputUpperBoundMessageId, 145);
}

async function loadGroupChatMessaging() {
  const eventUrl = transpileToModuleUrl(`
    export function emitChatTypingStatusChanged(groupId, isTyping) {
      globalThis.__GROUP_MESSAGING_STATE__.typing.push({ groupId, isTyping });
    }
    export function emitChatGroupSpeechPlanChanged(groupId) {
      globalThis.__GROUP_MESSAGING_STATE__.planChanges.push(groupId);
    }
  `);
  const runtimeUrl = transpileToModuleUrl(`
    export function getChatGroupRuntimeDependencies() {
      return globalThis.__GROUP_MESSAGING_DEPS__;
    }
  `);
  const commitUrl = transpileToModuleUrl(`
    export async function insertSystemTip(groupId, text, metadata) {
      globalThis.__GROUP_MESSAGING_STATE__.systemTips.push({ groupId, text, metadata });
    }
    export async function insertSystemTipIfSpeechPlanActive(groupId, planId, text, metadata) {
      globalThis.__GROUP_MESSAGING_STATE__.systemTips.push({
        groupId,
        planId,
        text,
        metadata,
      });
      return true;
    }
  `);
  const planningUrl = transpileToModuleUrl(`
    export async function captureGroupInvocationContext(_groupId, previousInputUpperBoundMessageId) {
      const state = globalThis.__GROUP_MESSAGING_STATE__;
      state.events.push('input-capture');
      state.captureLowerBounds.push(previousInputUpperBoundMessageId);
      return {
        currentUserMessages: state.currentUserMessages,
        inputUpperBoundMessageId: state.inputUpperBoundMessageId,
      };
    }
    export async function prepareGroupSpeechPlan(_details, currentUserMessages) {
      const state = globalThis.__GROUP_MESSAGING_STATE__;
      state.events.push('planning');
      state.plannerCalls += 1;
      if (state.throwPlanning) {
        throw new Error('规划失败测试');
      }
      return {
        memberProfiles: new Map(),
        sequenceMembers: state.sequenceMembers,
        mentionedAssistantIds: new Set(),
        adminRequestFailureNotice: state.adminRequestFailureNotice,
      };
    }
  `);
  const executionUrl = transpileToModuleUrl(`
    export async function executeGroupSpeechTasks(params) {
      const state = globalThis.__GROUP_MESSAGING_STATE__;
      state.executionCalls += 1;
      state.executedPlanIds.push(params.planId);
    }
  `);
  const schedulerUrl = transpileToModuleUrl(`
    export function acknowledgeGroupInvocationInput(groupId, upperBound) {
      globalThis.__GROUP_MESSAGING_STATE__.acknowledged.push({ groupId, upperBound });
    }
    export function notifyGroupInvocationSettled(groupId) {
      globalThis.__GROUP_MESSAGING_STATE__.settled.push(groupId);
    }
  `);
  const source = read('src/features/chat/group/application/GroupChatMessaging.ts')
    .replace(/from ['"]\.\/GroupSpeechExecutionAbort['"]/g,
      `from '${transpileToModuleUrl(read('src/features/chat/group/application/GroupSpeechExecutionAbort.ts'))}'`)
    .replace(/from ['"]\.\.\/\.\.\/messages\/events\/ChatEvents['"]/g, `from '${eventUrl}'`)
    .replace(/from ['"]\.\/ChatGroupRuntime['"]/g, `from '${runtimeUrl}'`)
    .replace(/from ['"]\.\/GroupMessageCommit['"]/g, `from '${commitUrl}'`)
    .replace(/from ['"]\.\/GroupSpeakerPlanning['"]/g, `from '${planningUrl}'`)
    .replace(/from ['"]\.\/GroupSpeechTaskExecution['"]/g, `from '${executionUrl}'`)
    .replace(/from ['"]\.\/GroupAutoInvocationScheduler['"]/g, `from '${schedulerUrl}'`);
  return import(transpileToModuleUrl(source));
}

async function verifyInvocationFlow(GroupChatRepository, invokeGroupChat) {
  const db = createSpeechPlanDatabase();
  globalThis.__GROUP_CLAIM_COORDINATOR__ = createCoordinator(db);
  const repository = new GroupChatRepository();
  const state = {
    currentUserMessages: [
      { id: 21, text: '请大家聊聊', isMe: true, senderType: 'user' },
    ],
    inputUpperBoundMessageId: 21,
    captureLowerBounds: [],
    plannerCalls: 0,
    executionCalls: 0,
    executedPlanIds: [],
    events: [],
    typing: [],
    planChanges: [],
    systemTips: [],
    throwPlanning: false,
    adminRequestFailureNotice: null,
    sequenceMembers: [{
      id: 'member-1',
      groupId: 'g1',
      aiAssistantId: 'ai-1',
      agentId: 'agent-1',
      displayOrder: 0,
      enabled: true,
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
    }],
    statusUpdates: [],
    createTaskCalls: 0,
    activatedTaskInputs: [],
    acknowledged: [],
    settled: [],
  };
  globalThis.__GROUP_MESSAGING_STATE__ = state;
  globalThis.__GROUP_MESSAGING_DEPS__ = {
    groups: {
      getById: async () => ({
        group: {
          id: 'g1',
          name: '测试群',
          avatar: null,
          lastMessage: null,
          lastTime: null,
          isPinned: false,
          createdAt: '2026-08-12T12:00:00.000Z',
          updatedAt: '2026-08-12T12:00:00.000Z',
        },
        members: state.sequenceMembers,
        adminConfig: {
          groupId: 'g1',
          name: '管理员',
          model: 'admin-model',
          apiKey: null,
          apiBaseUrl: null,
          systemPrompt: null,
          temperature: 0.7,
          topP: 1,
          maxTokens: null,
          contextMessageCount: 20,
          createdAt: '2026-08-12T12:00:00.000Z',
          updatedAt: '2026-08-12T12:00:00.000Z',
        },
      }),
      tryClaimGroupSpeechPlan: (groupId) => {
        state.events.push('claim');
        return repository.tryClaimGroupSpeechPlan(groupId);
      },
      listSpeechPlanTasks: async (planId) => repository.listSpeechPlanTasks(planId),
      beginSpeechPlanPreparation: async (...args) => repository.beginSpeechPlanPreparation(...args),
      activateSpeechPlanWithTasks: async (planId, params) => {
        state.createTaskCalls += 1;
        state.activatedTaskInputs.push(params.tasks.map((task) => task.aiAssistantId));
        return repository.activateSpeechPlanWithTasks(planId, params);
      },
      updateSpeechPlanInput: async (...args) => repository.updateSpeechPlanInput(...args),
      updateSpeechPlanStatus: async (...args) => {
        state.statusUpdates.push(args);
        return repository.updateSpeechPlanStatus(...args);
      },
    },
  };

  const results = await Promise.all([
    invokeGroupChat('g1'),
    invokeGroupChat('g1'),
  ]);
  const winner = results.find((result) => result.success);
  const loser = results.find((result) => !result.success);
  assert.ok(winner, '并发召唤必须有 winner');
  assert.ok(loser, '并发召唤必须有 loser');
  assert.equal(state.plannerCalls, 1, '管理员规划只能由 claim winner 执行一次');
  assert.equal(state.createTaskCalls, 1);
  assert.equal(state.executionCalls, 1);
  assert.ok(
    state.events.indexOf('claim') < state.events.indexOf('input-capture'),
    'claim 必须先于本轮输入快照捕获',
  );
  assert.ok(
    state.events.indexOf('input-capture') < state.events.indexOf('planning'),
    '管理员规划必须晚于本轮输入快照捕获',
  );
  assert.deepEqual(state.captureLowerBounds, [0]);
  assert.equal(loser.planId, winner.planId, 'loser 必须返回 winner 的 active planId');
  assert.deepEqual(
    state.statusUpdates.map((entry) => entry[1]),
    ['completed'],
    'pending→running 由激活事务原子完成，编排层只在执行结束后写 completed',
  );
  assert.deepEqual(
    state.activatedTaskInputs,
    [['ai-1']],
    '激活事务必须携带规划产出的任务列表',
  );
  assert.equal(
    db.prepare(
      `SELECT status FROM group_speech_tasks WHERE plan_id = ?`,
    ).get(winner.planId).status,
    'queued',
    '执行器被桩替代时任务应保持激活后的 queued 状态',
  );
  assert.deepEqual(state.typing, [
    { groupId: 'g1', isTyping: true },
    { groupId: 'g1', isTyping: false },
  ]);
  assert.deepEqual(
    state.planChanges,
    ['g1', 'g1'],
    'plan 进入 preparing 与 invocation 收尾都必须发布持久事实变化',
  );
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM group_speech_plans
       WHERE group_id = 'g1' AND status IN ('pending', 'running')`,
    ).get().count,
    0,
  );

  state.currentUserMessages = [];
  const empty = await invokeGroupChat('g1');
  assert.equal(empty.success, false);
  assert.equal(empty.error, '先发几句，再召唤 AI 参与吧');
  assert.equal(empty.planId, null, '无消息仍保留旧友好错误，不向 UI 暴露占位 plan');
  assert.equal(
    db.prepare(
      `SELECT status FROM group_speech_plans
       WHERE group_id = 'g1' ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get().status,
    'completed',
    'claim 后发现没有消息必须把自身 plan 转为终态',
  );

  state.currentUserMessages = [
    { id: 22, text: '再来一轮', isMe: true, senderType: 'user' },
  ];
  state.inputUpperBoundMessageId = 22;
  state.throwPlanning = true;
  const failed = await invokeGroupChat('g1');
  assert.equal(failed.success, false);
  assert.equal(state.plannerCalls, 2, '下一轮终态释放后可以再次进入规划');
  assert.equal(
    db.prepare(
      `SELECT status FROM group_speech_plans WHERE id = ?`,
    ).get(failed.planId).status,
    'failed',
    'claim 后规划异常必须释放为 failed 终态',
  );
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM group_speech_plans
       WHERE group_id = 'g1' AND status IN ('pending', 'running')`,
    ).get().count,
    0,
  );

  state.throwPlanning = false;
  state.currentUserMessages = [
    { id: 23, text: '管理员请求失败仍继续', isMe: true, senderType: 'user' },
  ];
  state.inputUpperBoundMessageId = 23;
  state.adminRequestFailureNotice = {
    text: '管理员调度失败，本次已切换为全量召唤：API Key 无效',
    metadata: { actorType: 'admin', actorName: '管理员' },
  };
  const adminRequestFailure = await invokeGroupChat('g1');
  assert.equal(adminRequestFailure.success, true);
  assert.equal(
    state.systemTips.at(-1).text,
    '管理员调度失败，本次已切换为全量召唤：API Key 无效',
    '管理员请求失败提示必须写入群时间线，同时整轮继续成功执行',
  );
  assert.equal(
    state.systemTips.at(-1).planId,
    adminRequestFailure.planId,
    '管理员请求失败提示必须绑定当前 plan 的所有权 fence',
  );
  assert.equal(
    db.prepare(`SELECT status FROM group_speech_plans WHERE id = ?`)
      .get(adminRequestFailure.planId).status,
    'completed',
  );

  db.close();
}

const { GroupChatRepository } = await loadGroupChatRepository();
const { updateGroupChatAdminConfig, updateGroupChatProfile } = await loadGroupChatManagement();
const { getGroupParticipantDirectory } = await loadGroupParticipantDirectory();
const { captureGroupInvocationContext, prepareGroupSpeechPlan } = await loadGroupSpeakerPlanning();
const { runMigration57 } = await loadMigration57();
const { runMigration58 } = await loadMigration58();
const { invokeGroupChat } = await loadGroupChatMessaging();

await verifyMigration57(runMigration57);
await verifyMigration58(runMigration58);
await verifyRepositoryClaim(GroupChatRepository);
await verifyInvocationContextCapture(captureGroupInvocationContext);
await verifyAdminConfigPersistence(GroupChatRepository);
await verifyAdminConfigCommand(updateGroupChatAdminConfig);
await verifyGroupProfilePersistence(GroupChatRepository);
await verifyGroupProfileValidation(updateGroupChatProfile);
await verifyGroupParticipantDirectory(getGroupParticipantDirectory);
await verifyAdminRecentContext(prepareGroupSpeechPlan);
await verifyAdminSelectionSemantics(prepareGroupSpeechPlan);
await verifyInvocationFlow(GroupChatRepository, invokeGroupChat);

console.log('群聊召唤 claim 与管理员上下文行为验证通过。');
