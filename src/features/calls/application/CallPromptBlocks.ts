/** 构造通话实时回复与去电决策的 Feature 私有 Prompt Blocks。 */

import type { PromptPackBlock, PromptScenarioId } from '@shared/prompt';
import type { CallAIConfig } from '../domain/CallAIConfig';
import type { CallSession } from '../domain/CallSession';

export const CALL_END_MARKER = '[[END_CALL]]';
export const CALL_ACCEPT_MARKER = '[[接听]]';
export const CALL_REJECT_MARKER = '[[拒绝接听]]';

// 口语输出格式由 CALL_PLAIN_SPOKEN_TEXT_PROMPT 承担，这里只说「你在通话里」与「输入只有文字转写」。
export const CALL_LIVE_SPEECH_PROMPT = [
  '【视频通话口语模式】',
  '你正在与用户实时视频通话，回复会被语音模型朗读出来。',
  '用户输入是通话麦克风的实时转写，即你此刻听到的话；不要声称听到语气、音量、呼吸、笑声或背景声等声音细节。',
].join('\n\n');

export const CALL_PLAIN_SPOKEN_TEXT_PROMPT = [
  '只返回口语正文，当前语音模型允许的控制标记以本轮说明为准。',
  '可以自然使用“嗯、啊、唔”等语气词，以及逗号、破折号、省略号表达停顿。',
  '回复正文不要使用 JSON、Markdown 代码块或包裹正文的 XML。',
  '不要描写动作、舞台指示、旁白或未声明的表演说明；已声明的语音控制标记可以使用。',
].join('\n\n');

// 这里仅声明视觉事实边界；查看画面的调用指导由已授权工具的 schema 承担。
export const CALL_VISUAL_SNAPSHOT_PROMPT = '你不会持续接收摄像头画面，摄像头开启不代表已经看见；旧快照不代表当前画面。';

export const CALL_END_CONTROL_PROMPT = [
  `你可以主动挂断当前通话。决定结束通话（包括回应用户的挂断请求）时，在本轮回复中输出 ${CALL_END_MARKER}，并说一句自然的告别语。`,
  `这是应用的通话控制指令，不是工具调用或语音标签；无论是否启用工具都可使用。${CALL_END_MARKER} 可放在口语正文前或后，不会被朗读，应用会在本轮语音播放结束后挂断。`,
  `仅说“挂了”“再见”不会触发挂断；要继续交谈就不要输出 ${CALL_END_MARKER}。`,
].join('\n\n');

export const OUTGOING_CALL_DECISION_PROMPT = [
  '【内部视频通话决策任务】',
  '用户正在向你发起视频通话。',
  '请根据当前上下文以及你和用户的关系，自然地决定接听或拒接。',
  '接听后会进入自然的口语对话场景；摄像头开启不代表已经收到用户画面。',
].join('\n\n');

export const OUTGOING_CALL_CONTROL_PROMPT = [
  `决定接听时，在本轮回复中输出 ${CALL_ACCEPT_MARKER}；决定拒绝接听时，输出 ${CALL_REJECT_MARKER}。两种标记只能选择一种。`,
  '标记可以放在口语正文之前、之后或中间；应用会抽离标记并执行接听或拒接，标记不会显示或朗读。',
  `例如“${CALL_ACCEPT_MARKER}你好。”、“你好。${CALL_ACCEPT_MARKER}”、“哦，${CALL_ACCEPT_MARKER}你好。”都表示接听。`,
  `拒接时可以输出“${CALL_REJECT_MARKER}我现在不方便，晚点聊。”；标记之外的正文会作为普通聊天回复交给用户。`,
  '其余内容直接使用自然口语，可自然使用语气词、引号、换行和标点停顿；也可以只输出标记而不附带正文。',
  '不要输出 JSON、字段名、XML 或 Markdown 代码块，不含厂商语音控制标记；接通后的实时回复会另行声明当前语音模型能力。',
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
 * 这里只追加决策场景与接听控制标记，避免 persona 重复注入。
 */
export function buildOutgoingCallDecisionBlocks(): PromptPackBlock[] {
  return [
    block('scenario.call_outgoing_decision', '用户去电决策', OUTGOING_CALL_DECISION_PROMPT, 'scenario'),
    block('output.call_outgoing_decision_json', '去电接听控制标记', OUTGOING_CALL_CONTROL_PROMPT, 'output_contract'),
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
