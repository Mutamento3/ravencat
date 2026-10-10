/** 集中提示词中心使用的目录枚举中文标签。 */

import type {
  PromptScenarioId,
  PromptSlot,
} from '@shared/prompt';

export const SCENARIO_LABELS: Record<PromptScenarioId, string> = {
  'chat.private_reply': '私聊回复',
  'chat.group_member_reply': '群聊成员回复',
  'chat.group_admin_schedule': '群聊管理员',
  'ledger.reply': '账本回复',
  'call.live_reply': '通话中回复',
  'call.outgoing_decision': '去电决策',
  'call.post_user_hangup': '用户挂断后跟进',
  'together_listening.post_user_decline': '一起听邀请被拒后的回应',
  'raven_cat.ai_schedule_trigger': 'AI 日程触发',
  'chat.summary': '聊天摘要',
  'vision.ocr': '图片 OCR',
};

export const SLOT_LABELS: Record<PromptSlot, string> = {
  foundation: '基础规则', persona: 'AI 人设', user_rules: '用户规则', scenario: '场景任务',
  capabilities: '工具能力', dynamic_context: '动态上下文', output_contract: '输出契约',
  history: '历史', input: '当前输入',
};
