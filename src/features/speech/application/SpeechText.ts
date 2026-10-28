import type { SpeechProviderId } from '../domain/SpeechProvider';

const minimaxInterjections = [
  'laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath', 'pant',
  'inhale', 'exhale', 'gasps', 'sniffs', 'sighs', 'snorts', 'burps',
  'lip-smacking', 'humming', 'hissing', 'emm', 'sneezes',
];
const elevenAudioTagExamples = [
  'whispers', 'excited', 'laughs', 'short pause',
];
const fishAudioTagExamples = [
  'happy', 'whispering', 'laughing', 'break', 'long-break',
];
const MAX_AUDIO_TAG_LENGTH = 100;
const AUDIO_TAG_CLOSERS: Record<string, string> = { '[': ']', '［': '］', '【': '】' };
const CONTROL_TAG_CLOSERS: Record<string, string> = { ...AUDIO_TAG_CLOSERS, '<': '>', '(': ')', '（': '）' };
const SPEECH_TOKEN_PATTERN = /<[^>\r\n]*>|[\[［【][^\[\]［］【】\r\n]*[\]］】]|[（(][^（）()\r\n]*[）)]/g;

interface SpeechTextRules {
  tags: string[];
  audioTags: boolean;
  pause: 'minimax' | 'ssml' | null;
}

/** 只承诺已核对模型的语法；兼容接口和动态目录中的未知模型不继承其他模型的能力。 */
function speechTextRules(provider: SpeechProviderId, model: string): SpeechTextRules {
  if (provider === 'minimaxT2aV2' && [
    'speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd',
    'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo',
  ].includes(model)) {
    return {
      tags: model.startsWith('speech-2.8-') ? minimaxInterjections.map((tag) => `(${tag})`) : [],
      audioTags: false,
      pause: 'minimax' as const,
    };
  }
  if (provider === 'elevenlabs') {
    if (['eleven_v3', 'eleven_v4', 'eleven_v4_turbo'].includes(model))
      return { tags: [], audioTags: true, pause: null };
    if (['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'].includes(model))
      return { tags: [], audioTags: false, pause: 'ssml' };
  }
  if (provider === 'fishAudio' && ['s2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3'].includes(model))
    return { tags: [], audioTags: true, pause: null };
  return { tags: [], audioTags: false, pause: null };
}

export function getSpeechTextGuidance(provider: SpeechProviderId, model: string, allowInstructions = true): string {
  const rules = speechTextRules(provider, model);
  const guidance = [
    '语音正文是实际说出的内容，可以自然使用“嗯、啊、唔”等语气词，以及逗号、破折号、省略号来表达节奏；按情境使用，不必每句添加。',
    '不要在正文中写动作描写、旁白、角色名前缀或中文表演说明。',
  ];
  if (rules.tags.length)
    guidance.push(`当前模型允许在正文的相应位置插入这些声音或表达标记：${rules.tags.join('、')}。只使用列出的标记，不要混用其他厂商语法；标记不属于转写正文。`);
  if (rules.audioTags) {
    const examples = provider === 'fishAudio' ? fishAudioTagExamples : elevenAudioTagExamples;
    guidance.push(`可根据情境自主决定是否使用 Audio Tags，以及标签的自然语言内容。例如 ${examples.map((tag) => `[${tag}]`).join('、')}，这些只是示例，不是白名单。使用 [标签]，也兼容 ［标签］、【标签】；每个标签去除首尾空格后为 1～${MAX_AUDIO_TAG_LENGTH} 个字符，只含文字、数字、空格和自然语言标点（引号、逗号、句号、问号、感叹号、冒号、分号、顿号、省略号、连字符或破折号），至少包含文字或数字，不允许嵌套、换行或其他符号。不使用 XML、SSML 或其他厂商语法；标签不属于转写正文，语音仍须包含可朗读正文。标签效果由模型与音色决定。`);
    if (provider === 'fishAudio')
      guidance.push('Fish 的句子情绪通常放在句首，声音和停顿放在发生的位置。例如“[warm and gentle]嗯，我在。[break]你慢慢说。”或“[happy][laughing]哈哈，太好了！”。可用简短自然语言描述语气，不混用 S1 的圆括号标签；[break]、[long-break] 只表达相对停顿，不承诺秒数。不输出说话人、音标或成对 XML 标签。');
  }
  if (rules.pause === 'minimax')
    guidance.push('停顿使用 <#秒数#>，范围 0.01～99.99 秒，最多两位小数，例如“嗯，<#0.5#>我在听。”；只能放在可朗读正文之间，不能连续使用。');
  if (rules.pause === 'ssml')
    guidance.push('停顿可使用 <break time="0.5s" />，大于 0 且不超过 3 秒；不要添加其他 XML 或 SSML 标签，也不要使用方括号声音标签。');
  if (!rules.tags.length && !rules.audioTags && !rules.pause)
    guidance.push('当前模型没有已声明的句内控制标记，只使用自然语言和标点；不要在正文中插入 XML、SSML、方括号或括号表达标签。');
  if (allowInstructions && (provider === 'openai' || provider === 'openrouter') && model.includes('gpt-4o-mini-tts'))
    guidance.push('用独立的 instructions 描述语气、轻声、语速和自然停顿等说话方式，不把指令写进正文；不承诺精确停顿时长或特定非语言声音。');
  return guidance.join('\n');
}

/** 分句消费的语法事实；这里只识别停顿，合法性仍由 prepareSpeechText 在输出边界验证。 */
export function hasSpeechPause(text: string): boolean {
  return /<#|<break\b|[\[［【][^\[\]［］【】\r\n]*(?:\bpauses?\b|\b(?:long-)?break\b|停顿)[^\[\]［］【】\r\n]*[\]］】]/i.test(text);
}

/** 模型输出的语音文本边界：保留模型支持的标记，移除不支持的完整标记，让正文仍可朗读。 */
export function prepareSpeechText(text: string, provider: SpeechProviderId, model: string): {
  synthesisText: string;
  transcript: string;
} {
  const rules = speechTextRules(provider, model);
  const source = text.trim();
  const tokens = [...source.matchAll(SPEECH_TOKEN_PATTERN)];
  let cursor = 0;
  let pauseCursor = 0;
  let transcript = '';
  let synthesisText = '';
  let removedUnsupportedTag = false;
  for (let index = 0; index < tokens.length; index++) {
    const match = tokens[index];
    const token = match[0];
    const start = match.index;
    let normalized = token;
    if (CONTROL_TAG_CLOSERS[token[0]] !== token.at(-1)
      || /[<>\[\]［］【】()（）]/.test(token.slice(1, -1)))
      throw new Error(`语音正文包含不匹配或嵌套的控制标记：${token}`);
    if (AUDIO_TAG_CLOSERS[token[0]]) {
      const body = token.slice(1, -1).trim();
      if (!body || [...body].length > MAX_AUDIO_TAG_LENGTH
        || !/^[\p{L}\p{M}\p{N}\p{Zs}'’‘"“”,.!?:;，。！？、；：…\-‐‑‒–—]+$/u.test(token.slice(1, -1))
        || !/[\p{L}\p{N}]/u.test(body))
        throw new Error(`Audio Tag 语法无效：${token}`);
      normalized = rules.audioTags ? `[${body.replace(/\p{Zs}+/gu, ' ')}]` : ' ';
    } else if (!rules.tags.includes(token)) {
      const pause = rules.pause === 'minimax'
        ? /^<#(\d+(?:\.\d{1,2})?)#>$/.exec(token)
        : rules.pause === 'ssml' ? /^<break\s+time="(\d+(?:\.\d+)?)s"\s*\/>$/.exec(token) : null;
      const seconds = pause ? Number(pause[1]) : 0;
      const max = rules.pause === 'minimax' ? 99.99 : 3;
      const min = rules.pause === 'minimax' ? 0.01 : 0;
      if (!pause && ((rules.pause === 'minimax' && token.startsWith('<#'))
        || (rules.pause === 'ssml' && /^<break\b/.test(token))))
        throw new Error(`当前语音模型不支持该标记或停顿时长：${token}`);
      if (pause && (seconds < min || seconds === 0 || seconds > max))
        throw new Error(`当前语音模型不支持该停顿时长：${token}`);
      if (!pause) normalized = ' ';
      if (pause && rules.pause === 'minimax') {
        const next = tokens.slice(index + 1).find((candidate) => candidate[0].startsWith('<#'))?.index ?? source.length;
        const before = source.slice(pauseCursor, start).replace(SPEECH_TOKEN_PATTERN, '');
        const after = source.slice(start + token.length, next).replace(SPEECH_TOKEN_PATTERN, '');
        if (!/[\p{L}\p{N}]/u.test(before) || !/[\p{L}\p{N}]/u.test(after))
          throw new Error('MiniMax 停顿必须位于可朗读正文之间，不能连续使用');
        pauseCursor = start + token.length;
      }
    }
    if (normalized === ' ') removedUnsupportedTag = true;
    synthesisText += source.slice(cursor, start) + normalized;
    transcript += source.slice(cursor, start) + ' ';
    cursor = start + token.length;
  }
  synthesisText += source.slice(cursor);
  transcript = (transcript + source.slice(cursor)).trim();
  if (tokens.length) transcript = transcript.replace(/[ \t]{2,}/g, ' ').replace(/ +([，。！？、；：,.!?;:])/g, '$1');
  if (removedUnsupportedTag) synthesisText = synthesisText.trim().replace(/[ \t]{2,}/g, ' ').replace(/ +([，。！？、；：,.!?;:])/g, '$1');
  if (/[<>\[\]［］【】()（）]/.test(transcript)) throw new Error('语音正文包含不完整或嵌套的控制标记');
  if (!transcript) throw new Error('语音正文不能为空，不能只有声音或停顿标记');
  return { synthesisText, transcript };
}
