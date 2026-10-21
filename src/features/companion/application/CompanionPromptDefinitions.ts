/** 暴露 RavenCat 自主唤醒任务的内置提示词元数据。 */

import type { PromptDefinitionDescriptor } from '@shared/prompt';
import {
  COMPANION_AI_SCHEDULE_TRIGGER_RULES,
} from './CompanionPromptBlocks';

export const COMPANION_PROMPT_DEFINITIONS = [
  {
    id: 'scenario.raven_cat_ai_schedule',
    version: 2,
    name: 'RavenCat AI 日程触发',
    description: '说明 AI Schedule 到期后 autonomous run 的行动与输出边界。',
    owner: 'companion',
    category: 'scenario',
    supportedScenarios: ['raven_cat.ai_schedule_trigger'],
    defaultSlot: 'output_contract',
    placement: 'system',
    protection: 'locked',
    protectionReason: '自主唤醒不得伪装成新用户消息；最终正文与静默信号必须遵守 Chat 提交契约。',
    contentKind: 'static',
    content: COMPANION_AI_SCHEDULE_TRIGGER_RULES,
    sourcePath: 'src/features/companion/application/CompanionPromptBlocks.ts',
  },
  {
    id: 'context.raven_cat_ai_schedule',
    version: 1,
    name: 'AI Schedule 触发事实',
    description: '注入当前到期 schedule 的 identity、remindAt、summary、details 与来源快照。',
    owner: 'companion',
    category: 'context',
    supportedScenarios: ['raven_cat.ai_schedule_trigger'],
    defaultSlot: 'dynamic_context',
    placement: 'system',
    protection: 'locked',
    protectionReason: 'Schedule identity 与时间必须保持机器事实身份，不能伪装成用户输入。',
    contentKind: 'static',
    contentDescription: '由 autonomous run 在启动时读取最新事实并生成。',
    sourcePath: 'src/features/companion/application/CompanionPromptBlocks.ts',
  },
] satisfies PromptDefinitionDescriptor[];
