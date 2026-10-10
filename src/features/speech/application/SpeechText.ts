import type { SpeechProviderId } from '../domain/SpeechProvider';

const minimaxInterjections = [
  'laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath', 'pant',
  'inhale', 'exhale', 'gasps', 'sniffs', 'sighs', 'snorts', 'burps',
  'lip-smacking', 'humming', 'hissing', 'emm', 'sneezes',
];
const elevenAudioTags = [
  'whispers', 'excited', 'curious', 'sarcastic', 'crying', 'laughs', 'sighs',
  'chuckles', 'clears throat', 'inhales deeply', 'exhales sharply',
  'short pause', 'long pause',
];

/** 只承诺已核对模型的语法；兼容接口和动态目录中的未知模型不继承其他模型的能力。 */
function speechTextRules(provider: SpeechProviderId, model: string) {
  if (provider === 'minimaxT2aV2' && [
    'speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd',
    'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo',
  ].includes(model)) {
    return {
      tags: model.startsWith('speech-2.8-') ? minimaxInterjections.map((tag) => `(${tag})`) : [],
      pause: 'minimax' as const,
    };
  }
  if (provider === 'elevenlabs') {
    if (['eleven_v3', 'eleven_v4', 'eleven_v4_turbo'].includes(model))
      return { tags: elevenAudioTags.map((tag) => `[${tag}]`), pause: null };
    if (['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'].includes(model))
      return { tags: [], pause: 'ssml' as const };
  }
  return { tags: [], pause: null };
}

export function getSpeechTextGuidance(provider: SpeechProviderId, model: string, allowInstructions = true): string {
  const rules = speechTextRules(provider, model);
  const guidance = [
    '语音正文是实际说出的内容，可以自然使用“嗯、啊、唔”等语气词，以及逗号、破折号、省略号来表达节奏；按情境使用，不必每句添加。',
    '不要在正文中写动作描写、旁白、角色名前缀或中文表演说明。',
  ];
  if (rules.tags.length)
    guidance.push(`当前模型允许在正文的相应位置插入这些声音或表达标记：${rules.tags.join('、')}。只使用列出的标记，不要混用其他厂商语法；标记不属于转写正文。`);
  if (rules.pause === 'minimax')
    guidance.push('停顿使用 <#秒数#>，范围 0.01～99.99 秒，最多两位小数，例如“嗯，<#0.5#>我在听。”；只能放在可朗读正文之间，不能连续使用。');
  if (rules.pause === 'ssml')
    guidance.push('停顿可使用 <break time="0.5s" />，大于 0 且不超过 3 秒；不要添加其他 XML 或 SSML 标签，也不要使用方括号声音标签。');
  if (!rules.tags.length && !rules.pause)
    guidance.push('当前模型没有已声明的句内控制标记，只使用自然语言和标点；不要在正文中插入 XML、SSML、方括号或括号表达标签。');
  if (allowInstructions && (provider === 'openai' || provider === 'openrouter') && model.includes('gpt-4o-mini-tts'))
    guidance.push('用独立的 instructions 描述语气、轻声、语速和自然停顿等说话方式，不把指令写进正文；不承诺精确停顿时长或特定非语言声音。');
  return guidance.join('\n');
}

/** 分句消费的语法事实；这里只识别停顿，合法性仍由 prepareSpeechText 在输出边界验证。 */
export function hasSpeechPause(text: string): boolean {
  return /<#|<break\b|\[(?:short|long) pause\]/.test(text);
}

/** 模型输出的语音文本边界：保留合成输入，只从转写中移除当前模型允许的控制标记。 */
export function prepareSpeechText(text: string, provider: SpeechProviderId, model: string): {
  synthesisText: string;
  transcript: string;
} {
  const rules = speechTextRules(provider, model);
  const synthesisText = text.trim();
  const tokens = [...synthesisText.matchAll(/<[^>\r\n]*>|\[[^\[\]\r\n]*\]|[（(][^（）()\r\n]*[）)]/g)];
  let cursor = 0;
  let pauseCursor = 0;
  let transcript = '';
  for (let index = 0; index < tokens.length; index++) {
    const match = tokens[index];
    const token = match[0];
    const start = match.index;
    if (!rules.tags.includes(token)) {
      const pause = rules.pause === 'minimax'
        ? /^<#(\d+(?:\.\d{1,2})?)#>$/.exec(token)
        : rules.pause === 'ssml' ? /^<break\s+time="(\d+(?:\.\d+)?)s"\s*\/>$/.exec(token) : null;
      const seconds = pause ? Number(pause[1]) : 0;
      const max = rules.pause === 'minimax' ? 99.99 : 3;
      const min = rules.pause === 'minimax' ? 0.01 : 0;
      if (!pause || seconds < min || seconds === 0 || seconds > max)
        throw new Error(`当前语音模型不支持该标记或停顿时长：${token}`);
      if (rules.pause === 'minimax') {
        const next = tokens.slice(index + 1).find((candidate) => candidate[0].startsWith('<#'))?.index ?? synthesisText.length;
        let before = synthesisText.slice(pauseCursor, start);
        let after = synthesisText.slice(start + token.length, next);
        for (const tag of rules.tags) {
          before = before.replaceAll(tag, '');
          after = after.replaceAll(tag, '');
        }
        if (!/[\p{L}\p{N}]/u.test(before) || !/[\p{L}\p{N}]/u.test(after))
          throw new Error('MiniMax 停顿必须位于可朗读正文之间，不能连续使用');
        pauseCursor = start + token.length;
      }
    }
    transcript += synthesisText.slice(cursor, start) + ' ';
    cursor = start + token.length;
  }
  transcript = (transcript + synthesisText.slice(cursor)).trim();
  if (tokens.length) transcript = transcript.replace(/[ \t]{2,}/g, ' ').replace(/ +([，。！？、；：,.!?;:])/g, '$1');
  if (/[<>\[\]()（）]/.test(transcript)) throw new Error('语音正文包含不完整或嵌套的控制标记');
  if (!transcript) throw new Error('语音正文不能为空，不能只有声音或停顿标记');
  return { synthesisText, transcript };
}
