/** 对中英文混合文本做稳定、低成本的近似 token 估算。 */

export function estimateTextTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += /[\u4e00-\u9fa5]/.test(char) ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}
