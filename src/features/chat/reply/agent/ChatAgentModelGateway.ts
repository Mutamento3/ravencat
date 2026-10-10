/** 保留 Chat 既有命名与错误类型，模型请求实现由通用 Agent Runtime Gateway 拥有。 */
import {
  BaseAIClientAgentModelGateway,
  BaseAIClientAgentModelRequestError,
  buildAgentModelMessages,
  type BaseAIClientAgentModelGatewayParams,
  type BaseAIClientAgentModelTurn,
} from '@platform/agentRuntime';
import type { TurnTimelineContext } from '@shared/diagnostics/TurnTimelineLog';

export class ChatAgentModelRequestError extends BaseAIClientAgentModelRequestError {
  constructor(error: unknown) {
    super(error);
    this.name = 'ChatAgentModelRequestError';
  }
}

export type ChatAgentModelTurn = BaseAIClientAgentModelTurn;

export interface ChatAgentModelDiagnosticContext extends TurnTimelineContext {
  sessionId: string;
  runId: string;
}

export class ChatAgentModelGateway extends BaseAIClientAgentModelGateway {
  constructor(params: Omit<BaseAIClientAgentModelGatewayParams, 'diagnosticContext'> & {
    diagnosticContext: ChatAgentModelDiagnosticContext;
  }) {
    super({
      client: params.client,
      initialMessages: params.initialMessages,
      toolInstructionsSlot: params.toolInstructionsSlot,
      diagnosticContext: params.diagnosticContext,
    });
  }

  override requireModelRequestError(): ChatAgentModelRequestError {
    // createModelRequestError 是本 wrapper 建立的类型契约，这里只收窄静态返回类型。
    return super.requireModelRequestError() as ChatAgentModelRequestError;
  }

  protected override createModelRequestError(error: unknown): ChatAgentModelRequestError {
    return new ChatAgentModelRequestError(error);
  }
}

export const buildChatAgentMessages = buildAgentModelMessages;
