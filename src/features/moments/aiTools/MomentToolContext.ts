/** 时刻 AI 工具实际使用的最小执行上下文。 */
import type { IMomentRepository } from '../domain/MomentRepository';

export interface MomentToolContext {
  /** 当前 Agent tool execution 的协作式取消信号。 */
  abortSignal?: AbortSignal;
  /** 正常 Agent Run 在工具之间共享的临时状态，不持久化已处理事实。 */
  sharedState: Record<string, unknown>;
  aiConfig: {
    avatar?: string | null;
  };
  repositories: {
    moment: IMomentRepository | null;
  };
  getAgentId(): string | null;
  getAIName(): string | null;
  isBlocked(): boolean;
}
