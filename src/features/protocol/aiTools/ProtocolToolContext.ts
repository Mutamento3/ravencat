/** 协议 AI 工具实际使用的最小执行上下文。 */
import type { IProtocolRepository } from '../domain/ProtocolRepository';

export interface ProtocolToolContext {
  /** 当前 Agent tool execution 的协作式取消信号。 */
  abortSignal?: AbortSignal;
  repositories: {
    protocol: IProtocolRepository | null;
  };
  getAIId(): string | null;
}
