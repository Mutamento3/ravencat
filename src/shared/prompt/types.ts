/** 定义 Prompt 组装器与各 Feature 运行时之间共享的数据契约。 */
import type { ToolContext } from '../aiTools';
import type {
  PromptDefinitionProtection,
  PromptScenarioId,
  PromptSlot,
} from './catalogTypes';

export type PromptPackScenario = PromptScenarioId;
export type MemoryParticipationMode = 'off' | 'read_only' | 'read_write';
export type BubbleDeliveryMode = 'multi-bubble' | 'single-bubble';
export type PromptSystemSegment = 'stable-prefix' | 'conversation-summary' | 'history-context' | 'dynamic-suffix' | 'output-requirement';

/** 已授权工具的固定用途目录与当前展开状态，由 Host 分别生成。 */
export interface PromptToolInstructions {
  catalog: string;
  state: string;
}

/** 编译器保留固定目录和本轮状态各自的位置；网关不自行决定 Prompt 顺序。 */
export interface PromptToolInstructionsSlot {
  before: string;
  after: string;
  contextBefore: string;
  contextAfter: string;
  /** Chat 的本轮 system 消息下标；自主任务为 null，状态接在完整 system 的历史之后。 */
  contextMessageIndex: number | null;
}

export interface PromptMcpServiceSummary {
  name: string;
  description: string;
}

export type PromptBlockKey =
  | 'time_awareness'
  | 'device_battery'
  | 'foundation_default_core'
  | 'persona'
  | 'visual_grounding_rules'
  | 'protocol_space'
  | 'tool_context_explanation'
  | 'agent_registry_summary'
  | 'moment_audience_candidates'
  | 'moments_social_inbox'
  | 'group_chat_context'
  | 'tools_description'
  | 'ledger_context_summary'
  | 'moments_context_summary'
  | 'user_identity_summary'
  | 'recent_moments_summary'
  | 'passive_memory'
  | 'conversation_summary'
  | 'chat_summary_task'
  | 'chat_secondary_summary_task'
  | 'recent_chat_window'
  | 'together_listening_runtime'
  | 'current_input';

export interface PromptPackBlock {
  key: PromptBlockKey;
  /** 迁移期工厂草稿可以省略，最终 Pack 由编译器保证存在。 */
  instanceId?: string;
  definitionId?: string;
  slot?: PromptSlot;
  protection?: PromptDefinitionProtection;
  title: string;
  content: string;
  required: boolean;
  status: 'ready' | 'placeholder' | 'omitted';
  source?: string;
  truncatable?: boolean;
  scenario?: PromptPackScenario | 'shared';
  placement?: 'system' | 'history' | 'input' | 'reserved';
  placeholderTodo?: string;
  estimatedTokens?: number;
  systemSegment?: PromptSystemSegment;
}

export interface PromptPresetItemDefinition {
  definitionId: string;
  slot: PromptSlot;
  sortOrder: number;
  enabled: boolean;
  required: boolean;
  protection: PromptDefinitionProtection;
}

export interface PromptPresetDefinition {
  id: string;
  version: number;
  name: string;
  scenarioId: PromptScenarioId;
  tokenBudget?: number;
  items: PromptPresetItemDefinition[];
}

export type PromptPackMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type PromptPackMessageContent = string | PromptPackMessageContentPart[];

export interface PromptPackMessage {
  role: 'user' | 'assistant';
  content: PromptPackMessageContent;
  sourceMessageId?: number;
  sourceCallEventId?: string;
  logicalMessageId?: string | null;
}

/** 请求可在历史之后放置本轮 system，历史本身仍只有 user/assistant。 */
export type PromptPackRequestMessage = PromptPackMessage | { role: 'system'; content: string };

export interface PromptPackTextMessage extends PromptPackMessage {
  content: string;
}

export interface PromptPackAIConfig {
  id: string;
  agentId?: string;
  name: string;
  /** 当前 AI 使用的模型名，用于顶层基础规则里的运行环境说明；缺省时不注入该句。 */
  model?: string;
  systemPrompt?: string;
  enableTools?: boolean;
  allowMultipleBubbles?: boolean;
  promptDefinitionOverrides?: Record<string, string>;
  disabledPromptDefinitionIds?: string[];
  isHostAI?: boolean;
  isBlocked?: boolean;
}

export interface PromptPackGroupChatMemberContext {
  aiAssistantId: string;
  agentId: string;
  name: string;
}

export interface PromptPackGroupChatContext {
  groupId: string;
  groupName: string;
  currentAIId: string;
  currentAgentId: string;
  currentAIName: string;
  members: PromptPackGroupChatMemberContext[];
  recentWindowLimit: number;
  currentTurnUserMessageIds?: number[];
  inputUpperBoundMessageId?: number;
}

export interface PromptPackRuntimeContext {
  /** Host 在一次 Prompt 组装开始时解析的当前对话者显示名，供多个 block 共享。 */
  userDisplayName?: string;
  triggerSource?: string;
  triggerReason?: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  capabilities?: string[];
  batchSeq?: number;
  batchedUserMessageIds?: number[];
  historyUpperBound?: { messageId: number; createdAt: string };
  /** 通话当前输入已独立提供，历史投影排除同一条已提交转写，避免重复。 */
  currentCallEventId?: string;
  batchedUserMessageCount?: number;
  forceAppendUserText?: boolean;
  recentWindowLimit?: number;
  replyRunId?: string;
  memoryParticipation?: MemoryParticipationMode;
  supportsMultipleBubbles?: boolean;
  groupChat?: PromptPackGroupChatContext;
}

export interface AssemblePromptPackParams {
  sessionId: string;
  currentInput: string;
  aiConfig: PromptPackAIConfig;
  toolContext: ToolContext;
  runtimeContext?: PromptPackRuntimeContext;
  recentWindowLimit?: number;
  toolsDescription?: string;
  /** 本轮经过 Registry/policy/run preparation 后真正暴露给模型的工具名。 */
  allowedToolNames?: readonly string[];
  /** 当前轮已授权 MCP 服务的选择摘要；不包含远端工具 schema。 */
  mcpServices?: readonly PromptMcpServiceSummary[];
  preset?: PromptPresetDefinition;
  additionalBlocks?: PromptPackBlock[];
}

export interface AssembleStandalonePromptPackParams {
  scenarioId: PromptScenarioId;
  assistantId?: string | null;
  groupId?: string | null;
  blocks: PromptPackBlock[];
  currentInput: string;
}

export interface PromptPack {
  scenario: PromptPackScenario;
  blocks: PromptPackBlock[];
  /** 前置系统内容：固定规则与用途说明在前，聊天摘要在后；本轮上下文位于 modelMessages 的历史之后。 */
  systemPrompt: string;
  toolInstructionsSlot?: PromptToolInstructionsSlot;
  stableSystemPrompt: string;
  dynamicSystemPrompt: string;
  outputRequirement: string;
  recentMessages: PromptPackMessage[];
  currentInput: PromptPackTextMessage;
  modelMessages: PromptPackRequestMessage[];
  estimatedTokenCount: number;
  truncationLog?: string[];
}
