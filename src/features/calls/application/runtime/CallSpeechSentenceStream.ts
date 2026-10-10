/** 通话 delta 按句进入统一 Speech 文本边界，控制标记只交给合成，正文交给字幕和提交。 */
import { hasSpeechPause, prepareSpeechText, readSpeechMetadata, type ResolvedSpeechModel } from '@features/speech';
import { CALL_END_MARKER } from '../CallPromptBlocks';

const SENTENCE_TERMINATOR = /[。！？!?…]/;
const TAG_CLOSERS: Record<string, string> = { '<': '>', '[': ']', '(': ')', '（': '）' };

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
  let markerPrefixBuffer = '';
  let markerDecided = false;
  let endCallDetected = false;
  const sentences: string[] = [];

  const emitSentence = (rawSentence: string) => {
    const text = rawSentence
      .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]/g, '')
      .replace(/[\u2600-\u27BF]/g, '')
      .replace(/[\uFE0F\u200D]/g, '')
      .trim();
    if (!text) return;
    const prepared = prepareSpeechText(text, metadata?.provider ?? 'openaiCompatible', modelSnapshot?.model ?? '');
    sentences.push(prepared.transcript);
    onSentence(prepared.transcript, { synthesisText: prepared.synthesisText, modelSnapshot });
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
    sentenceBuffer += text.replace(/[\r\n]/g, '');
    drainSentences(false);
  };

  const pushWithMarkerDetection = (chunk: string) => {
    let text = chunk;
    if (!markerDecided) {
      markerPrefixBuffer += chunk;
      const trimmedPrefix = markerPrefixBuffer.trimStart();
      if (trimmedPrefix.length < CALL_END_MARKER.length && CALL_END_MARKER.startsWith(trimmedPrefix)) return;
      markerDecided = true;
      if (trimmedPrefix.startsWith(CALL_END_MARKER)) {
        endCallDetected = true;
        text = trimmedPrefix.slice(CALL_END_MARKER.length);
      } else {
        text = markerPrefixBuffer;
      }
      markerPrefixBuffer = '';
    }
    if (text) pushSpeechText(text);
  };

  return {
    push: pushWithMarkerDetection,
    pushSegment(text: string) {
      markerDecided = false;
      markerPrefixBuffer = '';
      pushWithMarkerDetection(text);
    },
    flush() {
      if (!markerDecided && markerPrefixBuffer) {
        markerDecided = true;
        const pendingPrefix = markerPrefixBuffer;
        markerPrefixBuffer = '';
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
