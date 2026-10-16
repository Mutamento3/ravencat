import type { ConversationTurnRun } from './ConversationTurn';
import type { ChatTurnDisplayVersion, ChatTurnPresentationHistory, ChatTurnPresentationWindow, ChatTurnExecutionProgress, ChatTurnExecutionStatus, ChatInterruptedTurnContext } from './ChatTurnPresentation';

/** 不执行模型、不重放工具；所有写入均不改变 ConversationTurn revision 或回复游标。 */
export interface IChatTurnPresentationRepository {
  open(run: ConversationTurnRun): Promise<boolean>;
  checkpoint(runId: string, items: readonly ChatTurnDisplayVersion[], progress?: ChatTurnExecutionProgress): Promise<boolean>;
  getExecutionStatus(sessionId: string): Promise<ChatTurnExecutionStatus | null>;
  publishVersions(runId: string, items: readonly ChatTurnDisplayVersion[]): Promise<boolean>;
  /** 原子发布当前 canonical 版本并收口已交付批次，返回本次发布的确切版本。 */
  publishMessage(messageId: number): Promise<ChatTurnDisplayVersion | null>;
  listPublishedMessageIds(runIds: readonly string[]): Promise<number[]>;
  complete(runId: string): Promise<boolean>;
  listHistory(sessionId: string, window?: ChatTurnPresentationWindow): Promise<ChatTurnPresentationHistory[]>;
  listInterruptedContext(sessionId: string, fromInputId: number, toInputId?: number): Promise<ChatInterruptedTurnContext[]>;
  listOpenRunIds(sessionId: string): Promise<string[]>;
  interruptOrphans(activeRunIds: readonly string[]): Promise<void>;
  interrupt(runId: string, reason: string): Promise<void>;
}
