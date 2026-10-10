/** 验证 aiCreateMoment exposure 与稳定 audience candidate runtime block 同步。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function transpile(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${relativePath} 无法编译`);
  return compiled.outputText;
}

function evaluate(relativePath, requireMock) {
  const module = { exports: {} };
  new Function('exports', 'require', 'module', transpile(relativePath))(
    module.exports,
    requireMock,
    module,
  );
  return module.exports;
}

const registrySummary = {
  entries: [
    {
      name: '普通 AI',
      agentId: 'agent-ordinary',
      collaborationState: 'self',
    },
    {
      name: '候选 AI',
      agentId: 'agent-candidate',
      collaborationState: 'available',
    },
    {
      name: '已拉黑 AI',
      agentId: 'agent-blocked',
      collaborationState: 'blocked',
    },
  ],
};
let socialInboxSummary = {
  entries: [{ eventType: 'moment_published', momentId: 'moment-1', commentId: null, actorNames: ['候选 AI'], eventCount: 1 }],
  totalUnreadCount: 1,
  remainingUnreadCount: 0,
};

const factoryModule = evaluate(
  'src/host/prompt/PromptPackBlockFactory.ts',
  (specifier) => {
    if (specifier === '@shared') return { DEFAULT_SELF_NAME: '用户' };
    if (specifier === '@features/memory') {
      return { recallPassiveMemory: async () => [] };
    }
    if (specifier === '@features/assistants') {
      return { agentRegistryService: { getSummary: async () => registrySummary } };
    }
    if (specifier === '@features/moments') {
      return {
        loadMomentActorDirectory: async () => ({ resolve: (value) => value }),
        loadSocialInboxSummary: async () => socialInboxSummary,
        formatSocialInboxSummary: (summary) => summary.entries.length ? '【候选 AI 发了一条新时刻（momentId: moment-1）】' : '',
      };
    }
    if (specifier === '@shared/prompt') return {};
    if (specifier === './PromptBuiltInContent') {
      return {
        DEFAULT_CORE_SYSTEM_PROMPTS: {},
        GROUP_MEMBER_REPLY_CONFIDENTIALITY_RULES: {},
        VISUAL_GROUNDING_REQUIREMENTS: {},
        resolveBuiltInPromptContent: ({ content }) => content,
      };
    }
    throw new Error(`PromptPackBlockFactory 未声明依赖：${specifier}`);
  },
);
const realFactory = factoryModule.promptPackBlockFactory;
const actualCandidateBlock = await realFactory.createMomentAudienceCandidatesBlock({
  id: 'ordinary-ai',
  agentId: 'agent-ordinary',
  name: '普通 AI',
});

assert.equal(actualCandidateBlock.required, true);
assert.equal(actualCandidateBlock.truncatable, false);
assert.match(actualCandidateBlock.content, /"displayName":"候选 AI"/u);
assert.match(actualCandidateBlock.content, /"agentId":"agent-candidate"/u);
assert.match(actualCandidateBlock.content, /"state":"available"/u);
assert.match(actualCandidateBlock.content, /"state":"blocked"/u, 'blocked 状态只作为候选状态呈现');
// 候选身份字段必须结构化暴露，且不得泄漏内部管理字段；正文措辞不设断言。
assert.doesNotMatch(actualCandidateBlock.content, /blockReason|isHostAI|isLedgerAI/u);

const actualInboxBlock = await realFactory.createMomentSocialInboxBlock(
  { id: 'ordinary-ai', agentId: 'agent-ordinary', name: '普通 AI' },
  { repositories: { moment: {} } },
);
assert.equal(actualInboxBlock.required, false);
assert.equal(actualInboxBlock.truncatable, false);
// 正文措辞由枫渡决定，测试不对它设任何断言；这里只保留结构与暴露规则。
// 唯一保留的是「不得空块」——防止误删导致静默注入一个空提示词块。
assert.ok(actualInboxBlock.content.trim().length > 0, 'Inbox 块必须有正文，不得是空块');
socialInboxSummary = { entries: [], totalUnreadCount: 0, remainingUnreadCount: 0 };
assert.equal((await realFactory.createMomentSocialInboxBlock(
  { id: 'ordinary-ai', agentId: 'agent-ordinary', name: '普通 AI' },
  { repositories: { moment: {} } },
)).status, 'omitted', '空 Inbox 必须 omitted');

function block(key, content = key) {
  return {
    key,
    title: key,
    content,
    required: false,
    status: 'ready',
    scenario: 'shared',
    placement: 'system',
  };
}

const factoryStub = {
  resolveUserIdentity: async () => ({ displayName: '用户', source: 'test' }),
  createFoundationBlock: () => block('foundation_default_core'),
  createPersonaBlock: () => block('persona'),
  createProtocolPromptBlock: async () => block('protocol_space'),
  createToolContextBlock: () => block('tool_context_explanation'),
  createAgentRegistrySummaryBlock: async () => block('agent_registry_summary', 'AI 身份池摘要'),
  createMomentAudienceCandidatesBlock: async () => actualCandidateBlock,
  createMomentSocialInboxBlock: async () => block('moments_social_inbox'),
  createToolsDescriptionBlock: () => block('tools_description'),
  createUserIdentityBlock: () => block('user_identity_summary'),
  createAutonomousRecentChatContextBlock: () => block('recent_chat_window'),
  createAutonomousExecutionTimeBlock: () => block('time_awareness'),
  createRecentChatWindowBlock: () => block('recent_chat_window'),
  createVisualGroundingRulesBlock: () => block('visual_grounding_rules'),
  createScenarioContextBlock: () => null,
  createTimeAwarenessBlock: () => block('time_awareness'),
  createGroupMemberReplyConfidentialityBlock: () => block('group_chat_context'),
  createRecentMomentsBlock: async () => block('recent_moments_summary'),
};

let capturedPreset = null;
const compilerStub = {
  compile: (input) => {
    capturedPreset = input.preset;
    return { ...input, systemPrompt: '', modelMessages: [] };
  },
};
const defaultPreset = (scenarioId) => ({
  id: `system.${scenarioId}`,
  version: 1,
  name: scenarioId,
  scenarioId,
  items: [],
});
const providerKey = {
  'context.protocol_space': 'protocol_space',
  'context.tool_explanation': 'tool_context_explanation',
  'context.agent_registry': 'agent_registry_summary',
  'context.moments_social_inbox': 'moments_social_inbox',
  'context.tools_description': 'tools_description',
  'context.passive_memory': 'passive_memory',
  'context.group_chat': 'group_chat_context',
};

const assemblerModule = evaluate(
  'src/host/prompt/PromptPackAssembler.ts',
  (specifier) => {
    if (specifier === '@shared/prompt') return {};
    if (specifier === './PromptPackBlockFactory') return { promptPackBlockFactory: factoryStub };
    if (specifier === './PromptHistoryBuilder') {
      return { promptHistoryBuilder: { loadPrivateSummaryContext: async () => ({ messages: [], summaryContent: "" }), loadRecentMessages: async () => [] } };
    }
    if (specifier === './compiler/PromptPackCompiler') return { promptPackCompiler: compilerStub };
    if (specifier === './compiler/systemPromptPresets') return { getSystemPromptPreset: defaultPreset };
    if (specifier === './providers') {
      return {
        renderHostPromptProviderBlock: async (definitionId) => (
          definitionId === 'context.moment_audience_candidates'
            ? actualCandidateBlock
            : block(providerKey[definitionId] ?? 'persona')
        ),
      };
    }
    throw new Error(`PromptPackAssembler 未声明依赖：${specifier}`);
  },
);
const assembler = new assemblerModule.PromptPackAssembler();

function baseParams(overrides = {}) {
  return {
    sessionId: 'session-1',
    currentInput: '用户输入',
    aiConfig: {
      id: 'ordinary-ai',
      agentId: 'agent-ordinary',
      name: '普通 AI',
      enableTools: true,
      isHostAI: false,
    },
    toolContext: { sessionId: 'session-1' },
    toolsDescription: '本轮工具说明',
    allowedToolNames: ['aiCreateMoment'],
    ...overrides,
  };
}

const ordinaryPack = await assembler.assembleChatPromptPack(baseParams());
assert.ok(
  ordinaryPack.blocks.some((candidate) => candidate.key === 'moments_social_inbox'),
  '普通非主理 AI 私聊同样必须获得 Social Inbox',
);
assert.ok(
  ordinaryPack.blocks.some((candidate) => candidate.key === 'moment_audience_candidates'),
  '普通非主理 AI 暴露 aiCreateMoment 时必须获得 audience candidate',
);
assert.ok(
  ordinaryPack.blocks.some((candidate) => candidate.key === 'agent_registry_summary'),
  '身份池摘要不依赖主理身份，普通 AI 同样获得身份锚点',
);

const hostPack = await assembler.assembleChatPromptPack(baseParams({
  aiConfig: { ...baseParams().aiConfig, isHostAI: true },
}));
assert.ok(hostPack.blocks.some((candidate) => candidate.key === 'moment_audience_candidates'));

const noExposurePack = await assembler.assembleChatPromptPack(baseParams({
  allowedToolNames: [],
  toolsDescription: '即使说明文本里写 aiCreateMoment 也不能猜 exposure',
}));
assert.ok(
  !noExposurePack.blocks.some((candidate) => candidate.key === 'moment_audience_candidates'),
  '未暴露 aiCreateMoment 时不得无条件注入 candidate',
);

const groupPack = await assembler.assembleChatPromptPack(baseParams({
  runtimeContext: {
    userDisplayName: '用户',
    groupChat: {
      groupId: 'group-1',
      groupName: '群聊',
      currentAIId: 'ordinary-ai',
      currentAgentId: 'agent-ordinary',
      currentAIName: '普通 AI',
      members: [],
      recentWindowLimit: 10,
    },
  },
}));
assert.ok(
  groupPack.blocks.some((candidate) => candidate.key === 'moment_audience_candidates'),
  '群聊 run 若真实暴露 aiCreateMoment，同样必须获得 candidate',
);
assert.ok(
  !groupPack.blocks.some((candidate) => candidate.key === 'moments_social_inbox'),
  '群聊不得注入当前 AI 的私有 Social Inbox',
);

const ledgerPack = await assembler.assembleLedgerPromptPack(baseParams());
assert.ok(!ledgerPack.blocks.some((candidate) => candidate.key === 'moments_social_inbox'));
const callPack = await assembler.assembleChatPromptPack(baseParams({
  runtimeContext: { triggerSource: 'call' },
}));
assert.ok(!callPack.blocks.some((candidate) => candidate.key === 'moments_social_inbox'));

await assembler.assembleChatPromptPack(baseParams({
  aiConfig: {
    ...baseParams().aiConfig,
    disabledPromptDefinitionIds: ['context.moment_audience_candidates'],
    promptDefinitionOverrides: { 'context.moment_audience_candidates': '用户覆盖内容' },
  },
  preset: {
    ...defaultPreset('chat.private_reply'),
    items: [{
      definitionId: 'context.moment_audience_candidates',
      slot: 'dynamic_context',
      sortOrder: 999,
      enabled: false,
      required: false,
      protection: 'overridable',
    }],
  },
}));
assert.deepEqual(
  capturedPreset.items.find((item) => item.definitionId === 'context.moment_audience_candidates'),
  {
    definitionId: 'context.moment_audience_candidates',
    slot: 'capabilities',
    sortOrder: 85,
    enabled: true,
    required: true,
    protection: 'locked',
  },
  '用户 preset disable/override 不得移除 Tool 所需 candidate',
);
assert.deepEqual(
  capturedPreset.items.find((item) => item.definitionId === 'context.moments_social_inbox'),
  {
    definitionId: 'context.moments_social_inbox',
    slot: 'dynamic_context',
    sortOrder: 125,
    enabled: true,
    required: false,
    protection: 'locked',
  },
  '私聊 Social Inbox 必须以 locked optional runtime item 覆盖用户 preset disable/override',
);


console.log('Moments audience candidate / Social Inbox Prompt exposure 验证通过。');
