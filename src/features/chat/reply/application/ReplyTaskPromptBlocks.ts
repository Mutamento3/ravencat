/** 构造图片 OCR 内部模型任务使用的受保护 Prompt Blocks。 */

import {
  DEFAULT_VISION_OCR_TASK_PROMPT,
  type PromptPackBlock,
  type PromptScenarioId,
} from '@shared/prompt';

export const VISION_OCR_SYSTEM_PROMPT = DEFAULT_VISION_OCR_TASK_PROMPT;

export const VISION_OCR_OUTPUT_CONTRACT = [
  '无法确认的内容必须明确说无法识别。',
  '只输出转述正文，不要输出 XML、Markdown 围栏或前后说明。',
].join('\n');

export function buildVisionOCRPromptBlocks(promptOverride?: string | null): PromptPackBlock[] {
  return [
    block(
      'vision.ocr',
      'internal.vision_ocr',
      '图片 OCR 与视觉转述',
      promptOverride?.trim() || VISION_OCR_SYSTEM_PROMPT,
      'foundation',
      'overridable',
    ),
    block(
      'vision.ocr',
      'output.vision_ocr_plain_text',
      'OCR 纯文本输出',
      VISION_OCR_OUTPUT_CONTRACT,
      'output_contract',
      'locked',
    ),
  ];
}

function block(
  scenario: PromptScenarioId,
  definitionId: string,
  title: string,
  content: string,
  slot: 'foundation' | 'scenario' | 'output_contract',
  protection: 'overridable' | 'locked',
): PromptPackBlock {
  return {
    key: 'persona',
    instanceId: `chatTask:${definitionId}`,
    definitionId,
    slot,
    protection,
    title,
    content,
    required: true,
    status: 'ready',
    source: 'ReplyTaskPromptBlocks',
    truncatable: protection !== 'locked',
    scenario,
    placement: 'system',
  };
}
