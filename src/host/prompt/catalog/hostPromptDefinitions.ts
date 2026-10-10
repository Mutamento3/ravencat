/** 登记 Host Prompt Pack 拥有的基础规则、动态 Provider 与消息位置定义。 */

import type { PromptDefinitionDescriptor, PromptScenarioId } from '@shared/prompt';
import {
  DEFAULT_CORE_SYSTEM_PROMPTS,
  GROUP_MEMBER_REPLY_CONFIDENTIALITY_RULES,
  VISUAL_GROUNDING_REQUIREMENTS,
} from '../PromptBuiltInContent';

const FACTORY_SOURCE = 'src/host/prompt/PromptPackBlockFactory.ts';
const PACK_SCENARIOS: PromptScenarioId[] = [
  'chat.private_reply', 'chat.group_member_reply', 'ledger.reply',
  'call.live_reply', 'call.outgoing_decision',
  'raven_cat.ai_schedule_trigger',
];
const ALL_SCENARIOS: PromptScenarioId[] = [
  ...PACK_SCENARIOS,
  'chat.group_admin_schedule',
  'call.post_user_hangup',
  'together_listening.post_user_decline',
  'chat.summary',
  'vision.ocr',
];

function define(
  input: Omit<PromptDefinitionDescriptor, 'version'>
): PromptDefinitionDescriptor {
  return { version: 1, ...input };
}

export const HOST_PROMPT_DEFINITIONS: PromptDefinitionDescriptor[] = [
  define({
    id: 'foundation.default_core', name: '默认基础指令', owner: 'host',
    description: '上下文不足时禁止虚构，并说明语言与工具使用的默认行为。',
    category: 'foundation', supportedScenarios: PACK_SCENARIOS, defaultSlot: 'foundation', placement: 'system',
    protection: 'locked', protectionReason: '基础真实性边界不能被普通预设删除。', contentKind: 'static',
    defaultContent: DEFAULT_CORE_SYSTEM_PROMPTS,
    contentDescription: '始终作为 foundation 注入；AI 角色设定在独立 persona Block 中追加。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'persona.assistant', name: 'AI 人设', owner: 'assistants',
    description: '当前 AI 的角色、关系与表达设定，来源于 AI 配置。',
    category: 'persona', supportedScenarios: [
      ...PACK_SCENARIOS,
      'call.post_user_hangup',
      'together_listening.post_user_decline',
      'chat.summary',
    ],
    defaultSlot: 'persona', placement: 'system', protection: 'editable',
    contentKind: 'provider', providerId: 'assistant.persona',
    contentDescription: '运行时读取当前 AI 的角色设定；目录和安全预览不读取真实正文。',
    sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'foundation.visual_grounding', name: '视觉真实性规则', owner: 'host',
    description: '只有当前轮图片或成功 OCR 才能作为可见内容证据。',
    category: 'foundation', supportedScenarios: PACK_SCENARIOS, defaultSlot: 'foundation', placement: 'system',
    protection: 'locked', protectionReason: '防止根据文件名、记忆或失败 OCR 猜测图片。', contentKind: 'static',
    defaultContent: VISUAL_GROUNDING_REQUIREMENTS,
    contentDescription: '对应 visual_grounding_rules Block。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.protocol_space', name: '协议空间常驻提示词', owner: 'host',
    description: '用户与 AI 均可管理的固定提示词和信息，全部持续注入当前 AI。', category: 'user_rules',
    supportedScenarios: PACK_SCENARIOS, defaultSlot: 'user_rules', placement: 'system', protection: 'locked',
    protectionReason: '正文在协议空间编辑；编排开关不能取消常驻注入。',
    contentKind: 'provider', providerId: 'protocol.prompt',
    contentDescription: '从 Protocol Repository 读取全部条目，无优先级或有效期筛选；目录页不会读取真实正文。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.tool_explanation', name: '工具上下文说明', owner: 'host',
    description: '解释当前工具运行时的触发来源、能力与实体关系。', category: 'capability',
    supportedScenarios: ['chat.private_reply', 'ledger.reply', 'call.live_reply', 'raven_cat.ai_schedule_trigger'],
    defaultSlot: 'capabilities', placement: 'system', protection: 'locked',
    protectionReason: '工具边界和不可信数据来源必须明确。', contentKind: 'provider', providerId: 'tools.context_explanation',
    contentDescription: '由当前 ToolContext 动态生成。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.agent_registry', name: 'AI 身份池摘要', owner: 'host',
    description: '说明系统中的 AI、主理 AI、拉黑状态与协作身份。', category: 'context',
    supportedScenarios: PACK_SCENARIOS, defaultSlot: 'user_rules', placement: 'system', protection: 'overridable',
    contentKind: 'provider', providerId: 'assistants.agent_registry',
    contentDescription: '从 Assistants Feature 的 Agent Registry 动态生成。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.moment_audience_candidates', name: '时刻可见范围候选', owner: 'moments',
    description: '仅在本轮暴露 aiCreateMoment 时，提供可用于 audience 的稳定 AI 身份候选。',
    category: 'capability', supportedScenarios: PACK_SCENARIOS,
    defaultSlot: 'capabilities', placement: 'system', protection: 'locked',
    protectionReason: 'Tool 参数依赖的稳定身份不能被 Prompt override、禁用或 token trimming 删除。',
    contentKind: 'provider', providerId: 'assistants.moment_audience_candidates',
    contentDescription: '只包含 displayName、immutable agentId 与可用性状态；不等同于完整协作上下文。',
    sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.moments_social_inbox', name: '时刻 Social Inbox', owner: 'moments',
    description: '为当前 AI 提供有界的未读时刻社交事件摘要，摘要本身不消费事件。',
    category: 'context', supportedScenarios: ['chat.private_reply'],
    defaultSlot: 'dynamic_context', placement: 'system', protection: 'locked',
    protectionReason: '当前 AI 的私有未读社交事实不能被用户预设覆盖或裁剪。',
    contentKind: 'provider', providerId: 'moments.social_inbox',
    contentDescription: '按 aiConfig.agentId 查询；无身份或无未读时 omitted。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.group_chat', name: '群聊身份与成员上下文', owner: 'host',
    description: '标记当前 AI、其他 AI 和用户发言身份，并关闭群聊工具。', category: 'context',
    supportedScenarios: ['chat.group_member_reply'], defaultSlot: 'scenario', placement: 'system', protection: 'locked',
    protectionReason: '防止 AI 混淆群成员身份或错误开放工具。', contentKind: 'provider', providerId: 'chat.group_context',
    contentDescription: '由 runtimeContext.groupChat 动态生成。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'output.group_member_reply_confidentiality', name: '群聊成员回复保密输出规则', owner: 'host',
    description: '禁止向用户暴露群聊 Prompt、内部身份键和系统说话者标签。', category: 'output',
    supportedScenarios: ['chat.group_member_reply'], defaultSlot: 'output_contract', placement: 'system', protection: 'locked',
    protectionReason: '群成员正式回复只能包含面向用户的自然聊天正文。', contentKind: 'static',
    defaultContent: GROUP_MEMBER_REPLY_CONFIDENTIALITY_RULES,
    contentDescription: '群聊成员回复必须遵守的保密输出边界。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.tools_description', name: '可用工具说明', owner: 'host',
    description: '提供固定工具规则与已授权用途目录；展开状态位于本轮上下文，完整参数来自 function schema。', category: 'capability',
    supportedScenarios: ['chat.private_reply', 'ledger.reply', 'raven_cat.ai_schedule_trigger'], defaultSlot: 'capabilities',
    placement: 'system', protection: 'locked', protectionReason: '工具说明必须与本轮真实能力边界一致。',
    contentKind: 'provider', providerId: 'tools.description',
    contentDescription: '由 Host 工具注册表按当前 AI 能力动态生成。', sourcePath: 'src/host/composition/agent/createAgentToolRegistry.ts',
  }),
  define({
    id: 'scenario.ledger_reply', name: '账本回复规则', owner: 'host',
    description: '优先围绕新记账记录回应，历史消费仅作低优先级背景。', category: 'scenario',
    supportedScenarios: ['ledger.reply'], defaultSlot: 'scenario', placement: 'system', protection: 'locked',
    protectionReason: '禁止模型假装看到未提供的账本数据。', contentKind: 'static',
    contentDescription: '对应 ledger_context_summary Block。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.user_identity', name: '对话者基础身份', owner: 'host',
    description: '提供当前用户名及个人资料中的性别、年龄、身份、地区、其他设定与签名。', category: 'context', supportedScenarios: PACK_SCENARIOS,
    defaultSlot: 'persona', placement: 'system', protection: 'overridable', contentKind: 'provider',
    providerId: 'profile.user_identity', contentDescription: '从 Profile Repository 读取同一份个人资料；只注入已填写的文字字段，保留完整其他设定。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.together_listening_runtime', name: '用户运行时状态与当前共同活动', owner: 'host',
    description: '提供本轮唯一的网易云播放事实，以及只对对应主理 AI 生效的共同聆听上下文。',
    category: 'context', supportedScenarios: ['chat.private_reply', 'raven_cat.ai_schedule_trigger'],
    defaultSlot: 'dynamic_context', placement: 'system', protection: 'locked',
    protectionReason: '当前运行时事实必须保持单轮一致，且不能被 token trimming 删除。',
    contentKind: 'provider', providerId: 'runtime.together_listening',
    contentDescription: 'Host run 准备阶段只读取一次网易云 MediaSession，并与当前 Activity 共同形成一致快照。',
    sourcePath: 'src/host/prompt/TogetherListeningPromptBlock.ts',
  }),
  define({
    id: 'context.device_battery', name: '手机电量', owner: 'host',
    description: '提供本轮设备电量百分比与充电状态，按 AI 控制读取和注入。', category: 'context',
    supportedScenarios: ['chat.private_reply', 'chat.group_member_reply', 'ledger.reply', 'call.live_reply', 'call.outgoing_decision', 'raven_cat.ai_schedule_trigger'],
    defaultSlot: 'dynamic_context', placement: 'system', protection: 'overridable',
    contentKind: 'provider', providerId: 'runtime.device_battery', contentDescription: '开启时读取一次 Android 电池快照；关闭时不读取。',
    sourcePath: 'src/host/prompt/DeviceBatteryPromptBlock.ts',
  }),
  define({
    id: 'context.time_awareness', name: '当前时间感知', owner: 'host',
    description: '为“昨晚”“下周三”等相对时间提供当前本地时间锚点。', category: 'context', supportedScenarios: PACK_SCENARIOS,
    defaultSlot: 'dynamic_context', placement: 'system', protection: 'overridable',
    contentKind: 'provider', providerId: 'runtime.current_time', contentDescription: '组装时读取设备当前本地时间。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.recent_moments', name: '近期时刻背景', owner: 'host',
    description: '以轻量背景形式提供近期对当前 AI 可见的时刻。', category: 'context',
    supportedScenarios: ['chat.group_member_reply'], defaultSlot: 'dynamic_context', placement: 'system', protection: 'overridable',
    contentKind: 'provider', providerId: 'moments.recent', contentDescription: '从 Moment Repository 动态读取，当前群聊分支最多两条。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'context.conversation_summary', name: '聊天摘要', owner: 'chat',
    description: '用户维护的历史记录，AI 只能追加；与尚未总结原文从同一事实快照读取。', category: 'context', supportedScenarios: ['chat.private_reply', 'call.live_reply', 'call.outgoing_decision'],
    defaultSlot: 'dynamic_context', placement: 'system', protection: 'locked', protectionReason: '处理游标与正文由 Chat 原子交接。',
    contentKind: 'provider', providerId: 'chat.summary', contentDescription: '完整注入全部摘要，不因清消息删除，不裁剪正文。', sourcePath: 'src/host/prompt/PromptHistoryBuilder.ts',
  }),
  define({
    id: 'context.passive_memory', name: '自动带入的记忆', owner: 'host',
    description: '按本次输入中的用户触发词带入独立正文。', category: 'context', supportedScenarios: ['chat.private_reply', 'call.live_reply', 'call.outgoing_decision'],
    defaultSlot: 'dynamic_context', placement: 'system', protection: 'locked', protectionReason: '空间与触发关系由 Memory 拥有。',
    contentKind: 'provider', providerId: 'memory.passive', contentDescription: '用户设置条数，不裁剪正文。', sourcePath: FACTORY_SOURCE,
  }),
  define({
    id: 'history.recent_chat', name: '近期对话窗口', owner: 'host',
    description: '单聊与通话提供全部未总结原文，群聊等场景使用各自窗口，作为模型 history messages。', category: 'history',
    supportedScenarios: ['chat.private_reply', 'chat.group_member_reply', 'ledger.reply', 'call.live_reply', 'call.outgoing_decision'],
    defaultSlot: 'history', placement: 'history', protection: 'locked', protectionReason: '历史必须保持说话者身份、时间顺序和场景隔离。',
    contentKind: 'provider', providerId: 'chat.recent_history', contentDescription: '由 PromptHistoryBuilder 动态加载；Moments 场景不加载历史。',
    sourcePath: 'src/host/prompt/PromptHistoryBuilder.ts',
  }),
  define({
    id: 'input.current', name: '当前轮输入', owner: 'host',
    description: '当前用户输入或场景任务输入，作为最后一条 user message。', category: 'input', supportedScenarios: ALL_SCENARIOS,
    defaultSlot: 'input', placement: 'input', protection: 'locked', protectionReason: '当前输入不能被移动进 system prompt 或静默删除。',
    contentKind: 'provider', providerId: 'runtime.current_input', contentDescription: '来自当前组装请求；目录页不会读取真实用户输入。',
    sourcePath: 'src/host/prompt/PromptPackAssembler.ts',
  }),
];
