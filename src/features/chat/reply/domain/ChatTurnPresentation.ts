/** 交付先持久化再投影；折叠与屏幕测量不能撤销已交付的版本。 */
export interface ChatToolExecutionSnapshot {
  toolCallId: string;
  name: string;
  arguments: string;
  status: 'proposed' | 'running' | 'success' | 'error';
  modelContent?: string;
}

export interface ChatTurnDisplaySnapshot {
  runId: string;
  sequence: number;
  stepIndex: number;
  segmentIndex?: number;
  kind: 'reasoning' | 'assistant' | 'tool';
  status: 'streaming' | 'running' | 'sent' | 'completed' | 'failed';
  text: string;
  clientMessageId: string;
  createdAt: string;
  time: string;
  toolNames?: readonly string[];
  toolDisplayNames?: readonly string[];
  toolExecutionStarted?: boolean;
  toolExecutions?: readonly ChatToolExecutionSnapshot[];
  apiMessageId?: string | null;
  assistantAsActivity?: boolean;
  pendingDelivery?: boolean;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  /** 仅 T3 物化后的正式消息元数据；运行时快照不提前取得媒体所有权。 */
  metadataJson?: string | null;
}

export interface ChatTurnDisplayVersion {
  version: number;
  snapshot: ChatTurnDisplaySnapshot;
}

export type ChatTurnExecutionPhase = 'preparing' | 'waiting_model' | 'receiving_model' | 'executing_tool'
  | 'processing_result' | 'committing' | 'delivering' | 'closing' | 'request_failed';

export interface ChatTurnExecutionProgress { phase: ChatTurnExecutionPhase; at: string }

export interface ChatTurnExecutionStatus {
  phase: ChatTurnExecutionPhase | 'waiting_host' | 'host_started' | 'failed' | 'interrupted';
  at: string;
  reason?: string | null;
}

export interface ChatTurnPresentationHistory {
  runId: string;
  kind: 'user_reply' | 'regenerate';
  state: 'open' | 'completed' | 'interrupted';
  reason: string | null;
  committed: boolean;
  createdAt: string;
  items: ChatTurnDisplayVersion[];
}

export interface ChatTurnPresentationWindow {
  fromMessageId: number;
  runIds: readonly string[];
}

/** 独立执行历史，没有 canonical 回复资格，也不构成重放工具的指令。 */
export interface ChatInterruptedTurnContext {
  runId: string;
  inputHighWatermark: number;
  createdAt: string;
  items: readonly ChatTurnDisplaySnapshot[];
}
