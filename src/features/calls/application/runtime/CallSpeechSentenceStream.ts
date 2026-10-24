/** 通话控制信号先由 Calls 提取，语音标签交给 Speech，正文交给字幕和提交。 */
import { hasSpeechPause, prepareSpeechText, readSpeechMetadata, type ResolvedSpeechModel } from '@features/speech';
import { CALL_END_MARKER } from '../CallPromptBlocks';

const SENTENCE_TERMINATOR = /[。！？!?…]/;
const TAG_CLOSERS: Record<string, string> = { '<': '>', '[': ']', '［': '］', '【': '】', '(': ')', '（': '）' };

export interface CallSentenceSpeech {
  synthesisText: string;
  modelSnapshot: ResolvedSpeechModel | null;
}

export interface CallSpeechSentenceStream {
  push(chunk: string): void;
  pushSegment(text: string): void;
  flush(): void;
  getSentences(): string[];
  shouldEndCall(): boolean;
}

export function createCallSpeechSentenceStream(
  onSentence: (sentence: string, speech: CallSentenceSpeech) => void,
  modelSnapshot: ResolvedSpeechModel | null,
): CallSpeechSentenceStream {
  const metadata = modelSnapshot ? readSpeechMetadata(modelSnapshot.metadataJson) : null;
  let sentenceBuffer = '';
  let markerBuffer = '';
  let endCallDetected = false;
  const sentences: string[] = [];

  const emitSentence = (rawSentence: string) => {
    const text = rawSentence.trim();
    if (!text) return;
    const prepared = prepareSpeechText(text, metadata?.provider ?? 'openaiCompatible', modelSnapshot?.model ?? '');
    // 先验证原始标签，再移除通话正文中的排版与 emoji，避免清理操作修补非法标签。
    const clean = (value: string) => value
      .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]/g, '')
      .replace(/[\u2600-\u27BF]/g, '')
      .replace(/[\uFE0F\u200D\r\n]/g, '')
      .trim();
    const synthesisText = clean(prepared.synthesisText);
    const transcript = clean(prepared.transcript);
    if (!synthesisText) return;
    if (!transcript) throw new Error('语音正文不能为空，不能只有声音或停顿标记');
    sentences.push(transcript);
    onSentence(transcript, { synthesisText, modelSnapshot });
  };

  const drainSentences = (final: boolean) => {
    for (;;) {
      const end = findSentenceEnd(sentenceBuffer, final);
      if (end === null) return;
      emitSentence(sentenceBuffer.slice(0, end));
      sentenceBuffer = sentenceBuffer.slice(end);
    }
  };

  const pushSpeechText = (text: string) => {
    // 换行是排版；标签可能跨任意 delta，必须先完整缓冲再判断句意边界。
    sentenceBuffer += text;
    drainSentences(false);
  };

  const pushWithMarkerDetection = (chunk: string) => {
    markerBuffer += chunk;
    for (;;) {
      const markerIndex = markerBuffer.indexOf(CALL_END_MARKER);
      if (markerIndex !== -1) {
        endCallDetected = true;
        pushSpeechText(markerBuffer.slice(0, markerIndex));
        markerBuffer = markerBuffer.slice(markerIndex + CALL_END_MARKER.length);
        continue;
      }
      // Calls 控制信号先于 Speech 解析；只暂存可能跨 delta 的精确标记前缀。
      let pendingLength = Math.min(markerBuffer.length, CALL_END_MARKER.length - 1);
      while (pendingLength > 0 && !CALL_END_MARKER.startsWith(markerBuffer.slice(-pendingLength))) pendingLength--;
      const speechText = markerBuffer.slice(0, markerBuffer.length - pendingLength);
      markerBuffer = markerBuffer.slice(markerBuffer.length - pendingLength);
      if (speechText) pushSpeechText(speechText);
      return;
    }
  };

  return {
    push: pushWithMarkerDetection,
    pushSegment(text: string) {
      markerBuffer = '';
      pushWithMarkerDetection(text);
    },
    flush() {
      if (markerBuffer) {
        const pendingPrefix = markerBuffer;
        markerBuffer = '';
        pushSpeechText(pendingPrefix);
      }
      drainSentences(true);
      emitSentence(sentenceBuffer);
      sentenceBuffer = '';
    },
    getSentences: () => sentences,
    shouldEndCall: () => endCallDetected,
  };
}

/**
 * 句末需要一个有意义的后继才确认边界，不用计时猜测。
 * 句间显式停顿必须和两侧正文在同一次合成中，否则会变成开头/末尾的无效标记。
 */
function findSentenceEnd(text: string, final: boolean): number | null {
  for (let index = 0; index < text.length; index++) {
    const closer = TAG_CLOSERS[text[index]];
    if (closer) {
      const end = text.indexOf(closer, index + 1);
      if (end === -1) return null;
      index = end;
      continue;
    }
    if (!SENTENCE_TERMINATOR.test(text[index])) continue;
    let end = index + 1;
    while (end < text.length && SENTENCE_TERMINATOR.test(text[end])) end++;
    let next = end;
    while (next < text.length) {
      if (/\s/.test(text[next])) { next++; continue; }
      const tagCloser = TAG_CLOSERS[text[next]];
      if (!tagCloser) break;
      const tagEnd = text.indexOf(tagCloser, next + 1);
      if (tagEnd === -1) return null;
      next = tagEnd + 1;
    }
    if (next === text.length) return final ? text.length : null;
    if (hasSpeechPause(text.slice(end, next))) {
      index = next - 1;
      continue;
    }
    return end;
  }
  return null;
}
