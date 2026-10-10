/** Chat 向 Host 请求的聚合助手能力；各子域运行时只接收自己使用的切片。 */

import type { AIProfile } from '@features/assistants';

export interface ChatAssistantDirectory {
  list(): Promise<AIProfile[]>;
  getById(id: string): Promise<AIProfile | null>;
  getBlockState(aiId: string): Promise<{ isBlocked: boolean }>;
}
