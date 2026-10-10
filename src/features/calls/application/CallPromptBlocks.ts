/** 构造通话实时回复与去电决策的 Feature 私有 Prompt Blocks。 */

import type { PromptPackBlock, PromptScenarioId } from '@shared/prompt';
import type { CallAIConfig } from '../domain/CallAIConfig';
import type { CallSession } from '../domain/CallSession';

export const CALL_END_MARKER = '[[END_CALL]]';

// 口语输出格式由 CALL_PLAIN_SPOKEN_TEXT_PROMPT 承担，这里只说「你在通话里」与「输入只有文字转写」。
export const CALL_LIVE_SPEECH_PROMPT = [
  '【视频通话口语模式】',
  '你正在与用户实时视频通话，回复会被语音模型朗读出来。',
  '用户输入是通话麦克风的实时转写，即你此刻听到的话；不要声称听到语气、音量、呼吸、笑声或背景声等声音细节。',
].join('\n\n');

export const CALL_PLAIN_SPOKEN_TEXT_PROMPT = [
  '只返回口语正文，当前语音模型允许的控制标记以本轮说明为准。',
  '可以自然使用“嗯、啊、唔”等语气词，以及逗号、破折号、省略号表达停顿。',
  '不要使用 JSON、Markdown 代码块或包裹正文的 XML。',
  '不要描写动作、舞台指示、旁白或未声明的表演说明；已声明的语音控制标记可以使用。',
].join('\n\n');

// 调用时机与「调用成功才算看到」由 lookAtUser 的工具说明承担，这里只保留工具说明没有的：
// 通话不持续收画面、摄像头关了就看不见、不得用旧信息描述、只能用本轮系统提供的视觉上下文。
export const CALL_VISUAL_SNAPSHOT_PROMPT = [
  '当前是视频通话体验，但你不会持续接收摄像头画面；摄像头关闭时你看不见用户及其周围环境。',
  '要描述当前画面，必须先在本轮调用 lookAtUser；不要根据之前的快照、历史聊天或记忆描述当前画面，这些信息可能已经过时。',
  '调用 lookAtUser 后，只能使用系统在本轮提供的视觉上下文：有 OCR 文本时用 OCR 文本，确实收到图片时才能用图片；系统说明没有可靠视觉能力时，就说明自己看不到，不要返回虚假描述。',
].join('\n\n');

export const CALL_END_CONTROL_PROMPT = [
  `如果你此刻自然地决定结束通话，请以 ${CALL_END_MARKER} 开始回复，写下你想说的话。`,
  `如果你想继续交谈，就不要包含 ${CALL_END_MARKER}。`,
].join('\n\n');

export const OUTGOING_CALL_DECISION_PROMPT = [
  '【内部视频通话决策任务】',
  '用户正在向你发起视频通话。',
  '请根据当前上下文以及你和用户的关系，自然地决定接听或拒接。',
  '接听后会进入自然的口语对话场景，可以根据需要使用摄像头查看用户的生活。',
].join('\n\n');

export const OUTGOING_CALL_JSON_CONTRACT = [
  '只返回以下两种形状之一的严格 JSON：',
  '{"decision":"accept","spokenText":"通话接通后你要说的第一句话"}',
  '{"decision":"reject","rejectionReason":"自然的拒接原因"}',
  'spokenText 使用纯口语，可自然使用语气词和标点停顿，不含厂商控制标记；接通后的实时回复会另行声明当前语音模型能力。',
  '不要返回 XML，也不要使用 Markdown 包裹 JSON。',
].join('\n\n');

export const CALL_POST_USER_HANGUP_PROMPT = [
  '【内部通话结束跟进决策】',
  '用户刚刚主动结束了一次与你的视频通话。',
  '请结合 user 消息中的结构化通话事实，自行判断是否需要再次联系用户。',
].join('\n\n');

export const CALL_POST_USER_HANGUP_JSON_CONTRACT = [
  '只返回严格 JSON，且只能包含 decision、message 两个字段。',
  '{"decision":"send_message","message":"一条自然的普通聊天消息"}',
  '{"decision":"stay_silent","message":null}',
  'decision 只能是 send_message 或 stay_silent。send_message 的 message 必须是非空字符串；stay_silent 的 message 必须是 null。',
  '不要返回 XML、Markdown、解释文字或其他字段。',
].join('\n\n');

/** 提示词中心安全预览不读取通话事实；真实回复传入当前通话状态。 */
export function buildCallLivePromptBlocks(call?: CallSession, speechTextGuidance?: string): PromptPackBlock[] {
  const speech = call ? CALL_LIVE_SPEECH_PROMPT + '\n\n【当前通话状态】\n' + JSON.stringify({
    callId: call.id, state: call.state, direction: call.direction, mediaMode: call.activeMode, acceptedAt: call.acceptedAt,
  }) : CALL_LIVE_SPEECH_PROMPT;
  const spokenText = [
    CALL_PLAIN_SPOKEN_TEXT_PROMPT,
    speechTextGuidance ?? '本轮未声明厂商控制标记，只使用自然语言和标点停顿。',
    '通话分句会分别合成；需要指定停顿时，把标记放在正文之间，不要只输出一段标记。需要持续表达语气时，在相应句子重新添加已声明的表达标记。说话风格使用角色默认配置，不返回 instructions 等额外字段。',
  ].join('\n\n');
  return [
    block('scenario.call_live_speech', '通话实时口语模式', speech, 'scenario'),
    block('capability.call_visual_snapshot', '通话视觉快照能力', CALL_VISUAL_SNAPSHOT_PROMPT, 'capabilities'),
    block('output.call_plain_spoken_text', '通话纯口语输出', spokenText, 'output_contract'),
    block('control.call_end_marker', '通话结束标记', CALL_END_CONTROL_PROMPT, 'output_contract'),
  ];
}

/**
 * 去电决策走 resolved Chat Pack：人设、用户身份、附加提示词与近期历史由聊天管线统一提供，
 * 这里只追加决策场景与 JSON 契约，避免 persona 重复注入。
 */
export function buildOutgoingCallDecisionBlocks(): PromptPackBlock[] {
  return [
    block('scenario.call_outgoing_decision', '用户去电决策', OUTGOING_CALL_DECISION_PROMPT, 'scenario'),
    block('output.call_outgoing_decision_json', '去电决策 JSON 契约', OUTGOING_CALL_JSON_CONTRACT, 'output_contract'),
  ];
}

export function buildPostUserHangUpPromptBlocks(aiConfig: CallAIConfig): PromptPackBlock[] {
  const persona = String(aiConfig.systemPrompt || '').trim();
  const scenario: PromptScenarioId = 'call.post_user_hangup';
  return [
    block('persona.assistant', 'AI 人设', persona, 'persona', false, scenario),
    block(
      'scenario.call_post_user_hangup',
      '用户主动挂断后的跟进决策',
      CALL_POST_USER_HANGUP_PROMPT,
      'scenario',
      true,
      scenario
    ),
    block(
      'output.call_post_user_hangup_json',
      '用户主动挂断后的跟进 JSON 契约',
      CALL_POST_USER_HANGUP_JSON_CONTRACT,
      'output_contract',
      true,
      scenario
    ),
  ];
}

function block(
  definitionId: string,
  title: string,
  content: string,
  slot: 'persona' | 'scenario' | 'capabilities' | 'output_contract',
  required = true,
  scenario?: PromptScenarioId
): PromptPackBlock {
  const resolvedScenario = scenario || (
    definitionId.includes('outgoing') ? 'call.outgoing_decision' : 'call.live_reply'
  );
  return {
    key: 'persona',
    instanceId: `calls:${definitionId}`,
    definitionId,
    slot,
    protection: definitionId === 'persona.assistant' ? 'editable' : 'locked',
    title,
    content,
    required,
    status: 'ready',
    source: 'CallPromptBlocks',
    truncatable: false,
    scenario: resolvedScenario,
    placement: 'system',
    // 通话状态与能力放在历史之后；人设和摘要前缀不因切换通话模式而改写。
    systemSegment: slot === 'persona' ? 'stable-prefix' : slot === 'output_contract' ? 'output-requirement' : 'dynamic-suffix',
  };
}
