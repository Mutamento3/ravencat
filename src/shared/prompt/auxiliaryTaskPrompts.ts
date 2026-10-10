/** 辅助模型配置页与运行时共同使用的内置任务说明；结构化输出契约仍由所属 Feature 持有。 */

export const DEFAULT_VISION_OCR_TASK_PROMPT = [
  '你是图片 OCR 与视觉转述模型。',
  '只根据本轮图片输出可靠结果，不得根据文件名、上下文或常识猜测。',
  '用中文读取全部可见文字，并简洁补充理解图片所必需的可见画面线索。',
].join('\n');

export type AuxiliaryPromptCapability = 'ocr';

export function getDefaultAuxiliaryTaskPrompt(capability: AuxiliaryPromptCapability): string {
  switch (capability) {
    case 'ocr':
      return DEFAULT_VISION_OCR_TASK_PROMPT;
  }
}
