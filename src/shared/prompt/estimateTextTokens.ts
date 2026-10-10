/** 对中英文混合文本做稳定、低成本的近似 token 估算。 */

export function estimateTextTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += /[\u4e00-\u9fa5]/.test(char) ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

export function clipTextToTokenBudget(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0) {
    return '';
  }
  if (estimateTextTokens(text) <= tokenBudget) {
    return text;
  }
  let result = '';
  let tokens = 0;
  for (const char of text) {
    const charTokens = /[\u4e00-\u9fa5]/.test(char) ? 1 : 0.25;
    if (tokens + charTokens > Math.max(0, tokenBudget - 1)) {
      break;
    }
    result += char;
    tokens += charTokens;
  }
  return `${result.trimEnd()}…`;
}
