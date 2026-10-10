/** AI 回复的确定性分段：分段由客户端代码决定，不依赖模型输出任何格式标记。 */
import type { BubbleDeliveryMode } from '@shared/prompt';

/** 单段超过该长度时按句末标点二次切分。 */
const MAX_SEGMENT_LENGTH = 100;

/** 句末切分点：中英文句末标点之后允许继续切。 */
const SENTENCE_END_PATTERN = /[。！？!?；;…]+["'”’）)]*/g;

/**
 * 把模型输出的纯文本切成气泡段：
 * 1. 按空行切分为候选段；
 * 2. 超长候选段按句末标点二次切分；
 * 3. single-bubble 模式下整段一个气泡。
 *
 * 没有句末标点可切的超长段整段保留，不做硬切：硬切会把一句话劈成两个气泡，
 * 宁可让单条气泡更长，也不输出半句话。
 */
export function segmentAssistantReplyText(
  rawText: string,
  bubbleDeliveryMode: BubbleDeliveryMode,
): string[] {
  const text = rawText.trim();
  if (!text) {
    return [];
  }
  if (bubbleDeliveryMode === 'single-bubble') {
    return [text];
  }
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.flatMap(splitLongParagraph);
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_SEGMENT_LENGTH) {
    return [paragraph];
  }
  const segments: string[] = [];
  let current = '';
  let lastIndex = 0;
  SENTENCE_END_PATTERN.lastIndex = 0;
  for (let match = SENTENCE_END_PATTERN.exec(paragraph); match; match = SENTENCE_END_PATTERN.exec(paragraph)) {
    const sentenceEnd = match.index + match[0].length;
    const sentence = paragraph.slice(lastIndex, sentenceEnd);
    lastIndex = sentenceEnd;
    if (current && current.length + sentence.length > MAX_SEGMENT_LENGTH) {
      segments.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  // 最后一个句末标点之后的剩余内容并入末段，不按阈值硬切。
  current += paragraph.slice(lastIndex);
  const finalSegment = current.trim();
  if (finalSegment) {
    segments.push(finalSegment);
  }
  return segments.filter(Boolean);
}
