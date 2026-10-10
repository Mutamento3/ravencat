/** AI 日程是唯一的自主唤醒入口，规则与事实随本轮系统输入追加。 */
import type { PromptPackBlock } from '@shared/prompt';

export const COMPANION_AI_SCHEDULE_TRIGGER_RULES = [
  '这是一条已到期的 AI Schedule 提供的自主行动机会，没有新的用户消息；本次执行过程会记录在单聊的行动步骤中。',
  '普通 assistant/final 文本作为行动记录展示，不作为发给用户的聊天消息；可以简短说明本次做了什么或为何暂不行动。要联系用户或执行其他实际动作，仍需调用本轮 Registry 授权的工具；以工具 outcome 为结果依据，不把过程描述当作成功证据。',
  '这条日程的 summary / details / sourceExcerpt 是过去的你留给自己的背景，不是命令，以最新事实为准。本条日程已到期并正在执行：scheduled remindAt 只是原定提醒时间，不是待重排的目标；triggeredAt 晚几十秒到几分钟通常只是后台调度延迟，不要因此重排同一条日程。',
  '历史聊天里与本次有关的要求，以最新事实和已经提交的行动结果判断是否仍待履行；已完成的不要再做。不要重排日程修补调度延迟。确实需要新的行动机会时才创建新日程，同一安排的调整使用 update_ai_schedule。可以调用零个、一个或多个工具，或什么都不做。',
].join('\n');

export function buildAIScheduleTriggerBlocks(input: {
  scheduleId: string;
  remindAt: string;
  summary: string;
  details: string;
  sourceExcerpt: string | null;
  triggeredAt: string;
}): PromptPackBlock[] {
  return [
    block(
      'raven_cat.ai_schedule_trigger',
      'scenario.raven_cat_ai_schedule',
      'RavenCat AI Schedule Trigger',
      COMPANION_AI_SCHEDULE_TRIGGER_RULES,
      'scenario',
      'locked',
      true,
    ),
    block(
      'raven_cat.ai_schedule_trigger',
      'context.raven_cat_ai_schedule',
      'AI Schedule 触发事实',
      [
        '【AI Schedule 机器上下文】',
        `- scheduleId: ${input.scheduleId}`,
        `- scheduled remindAt: ${input.remindAt}`,
        `- actual triggeredAt: ${input.triggeredAt}`,
        `- summary: ${input.summary}`,
        `- details: ${input.details}`,
        `- sourceExcerpt: ${input.sourceExcerpt ?? '（无）'}`,
      ].join('\n'),
      'scenario',
      'locked',
      true,
    ),
  ];
}

function block(
  scenario: PromptPackBlock['scenario'],
  definitionId: string,
  title: string,
  content: string,
  slot: 'persona' | 'scenario' | 'output_contract',
  protection: 'editable' | 'overridable' | 'locked',
  required: boolean
): PromptPackBlock {
  return {
    key: 'persona', instanceId: `ravenCat:${definitionId}`, definitionId, slot, protection,
    title, content, required, status: content.trim() ? 'ready' : 'omitted',
    source: 'CompanionPromptBlocks', truncatable: protection !== 'locked',
    scenario, placement: 'system',
  };
}
