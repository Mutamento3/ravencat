/** 构造用户拒绝一起听邀请后跟进决策的 Feature 私有 Prompt Blocks。 */

import type { PromptPackBlock, PromptScenarioId } from '@shared/prompt';
import type { TogetherListeningDeclineFollowUpAIConfig } from './TogetherListeningRuntime';

export const TOGETHER_LISTENING_POST_USER_DECLINE_PROMPT = [
  '【内部一起听邀请跟进决策】',
  '你刚刚主动向用户发起了 Together Listening（一起听网易云音乐）邀请，用户拒绝了你的邀请，该一起听 Activity 已经终止为 declined_by_user。',
  '请结合 user 消息中的结构化事实、你的人设以及你和用户的关系，自行判断此时是否需要通过普通聊天自然补充一句。',
  '被拒绝后保持安静完全合理，不要求一定回应；不要强行挽留，不要立即再次邀请一起听，不要把拒绝解释成用户的错误，也不要声称一起听仍在进行。',
  '如果你选择回应，消息应当简短、自然、符合你当前的人设；不要把这次内部决策过程告诉用户。',
].join('\n\n');

export const TOGETHER_LISTENING_POST_USER_DECLINE_JSON_CONTRACT = [
  '只返回严格 JSON，且只能包含 decision、message 两个字段。',
  '{"decision":"send_message","message":"一条自然的普通聊天消息"}',
  '{"decision":"stay_silent","message":null}',
  'decision 只能是 send_message 或 stay_silent。send_message 的 message 必须是非空字符串；stay_silent 的 message 必须是 null。',
  '不要返回 XML、Markdown、解释文字或其他字段。',
].join('\n\n');

export function buildPostUserDeclinePromptBlocks(
  aiConfig: TogetherListeningDeclineFollowUpAIConfig,
): PromptPackBlock[] {
  const persona = String(aiConfig.systemPrompt || '').trim();
  const scenario: PromptScenarioId = 'together_listening.post_user_decline';
  return [
    block('persona.assistant', 'AI 人设', persona, 'persona', false, scenario),
    block(
      'scenario.together_listening_post_user_decline',
      '一起听邀请被拒后的跟进决策',
      TOGETHER_LISTENING_POST_USER_DECLINE_PROMPT,
      'scenario',
      true,
      scenario,
    ),
    block(
      'output.together_listening_post_user_decline_json',
      '一起听邀请被拒后的跟进 JSON 契约',
      TOGETHER_LISTENING_POST_USER_DECLINE_JSON_CONTRACT,
      'output_contract',
      true,
      scenario,
    ),
  ];
}

function block(
  definitionId: string,
  title: string,
  content: string,
  slot: 'persona' | 'scenario' | 'output_contract',
  required: boolean,
  scenario: PromptScenarioId,
): PromptPackBlock {
  return {
    key: 'persona',
    instanceId: `togetherListening:${definitionId}`,
    definitionId,
    slot,
    protection: definitionId === 'persona.assistant' ? 'editable' : 'locked',
    title,
    content,
    required,
    status: 'ready',
    source: 'TogetherListeningPromptBlocks',
    truncatable: false,
    scenario,
    placement: 'system',
  };
}
