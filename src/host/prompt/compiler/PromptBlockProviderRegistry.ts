/** 登记动态 Prompt Provider，Phase 2 只建立解析骨架。 */

export type PromptBlockProvider<TContext = unknown, TResult = unknown> = (
  context: TContext
) => Promise<TResult> | TResult;

export class PromptBlockProviderRegistry {
  private readonly providers = new Map<string, PromptBlockProvider>();

  register(providerId: string, provider: PromptBlockProvider): void {
    if (this.providers.has(providerId)) {
      throw new Error(`Prompt Provider 重复注册：${providerId}`);
    }
    this.providers.set(providerId, provider);
  }

  resolve(providerId: string): PromptBlockProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Prompt Provider 未注册：${providerId}`);
    }
    return provider;
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }
}

export const promptBlockProviderRegistry = new PromptBlockProviderRegistry();
