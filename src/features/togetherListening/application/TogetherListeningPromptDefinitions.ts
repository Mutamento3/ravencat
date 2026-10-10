/** 暴露 Together Listening 拥有的内置提示词元数据，不执行任何运行时。 */

import type { PromptDefinitionDescriptor } from '@shared/prompt';
import {
  TOGETHER_LISTENING_POST_USER_DECLINE_JSON_CONTRACT,
  TOGETHER_LISTENING_POST_USER_DECLINE_PROMPT,
} from './TogetherListeningPromptBlocks';

const POST_USER_DECLINE_SCENARIO = ['together_listening.post_user_decline'] as const;

export const TOGETHER_LISTENING_PROMPT_DEFINITIONS = [
  {
    id: 'scenario.together_listening_post_user_decline',
    version: 1,
    name: '一起听邀请被拒后的跟进决策',
    description: '让 AI 判断用户拒绝其一起听邀请后是否发送一条普通聊天消息。',
    owner: 'togetherListening',
    category: 'scenario',
    supportedScenarios: [...POST_USER_DECLINE_SCENARIO],
    defaultSlot: 'scenario',
    placement: 'system',
    protection: 'locked',
    protectionReason: '邀请被拒后的跟进只允许输出严格结构化决策。',
    contentKind: 'static',
    content: TOGETHER_LISTENING_POST_USER_DECLINE_PROMPT,
    sourcePath: 'src/features/togetherListening/application/TogetherListeningPromptBlocks.ts',
  },
  {
    id: 'output.together_listening_post_user_decline_json',
    version: 1,
    name: '一起听邀请被拒后的跟进 JSON 契约',
    description: '只允许发送普通消息或保持安静两种严格 JSON 结果。',
    owner: 'togetherListening',
    category: 'output',
    supportedScenarios: [...POST_USER_DECLINE_SCENARIO],
    defaultSlot: 'output_contract',
    placement: 'system',
    protection: 'locked',
    protectionReason: '跟进执行链只接受明确的消息正文或静默选择。',
    contentKind: 'static',
    content: TOGETHER_LISTENING_POST_USER_DECLINE_JSON_CONTRACT,
    sourcePath: 'src/features/togetherListening/application/TogetherListeningPromptBlocks.ts',
  },
] satisfies PromptDefinitionDescriptor[];
