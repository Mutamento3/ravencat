/** 将现有 Feature Tool 转换为 AgentTool，不在适配层重新实现工具业务。 */
import type {
  AgentTool,
  AgentToolDescriptor,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolIdempotency,
  AgentToolRisk,
  JsonSchema,
  Tool,
  ToolContext,
  ToolExecuteResult,
} from '@shared/aiTools';

export interface LegacyAgentToolMetadata {
  owner: string;
  risk: AgentToolRisk;
  idempotency: AgentToolIdempotency;
}

export type LegacyToolContextFactory = (
  context: AgentToolExecutionContext
) => ToolContext;

export function convertLegacyToolResult(
  result: ToolExecuteResult
): AgentToolExecutionResult<unknown> {
  if (result.success) {
    if (!result.message) {
      throw new Error('Legacy Agent tool success result is missing model content');
    }

    const metadata = result.suppressAssistantReply
      ? { suppressAssistantReply: true }
      : undefined;
    return {
      status: 'success',
      data: result.data,
      modelContent: result.message,
      ...(metadata ? { metadata } : {}),
    };
  }

  const modelContent = result.error ?? result.message;
  if (!modelContent) {
    throw new Error('Legacy Agent tool failure result is missing model content');
  }

  return {
    status: 'error',
    code: result.errorCode ?? 'LEGACY_TOOL_EXECUTION_FAILED',
    retryable: false,
    modelContent,
  };
}

export class LegacyAgentToolAdapter implements AgentTool<unknown, unknown> {
  readonly descriptor: AgentToolDescriptor;
  private readonly legacyTool: Tool;
  private readonly createLegacyContext: LegacyToolContextFactory;

  constructor(
    legacyTool: Tool,
    metadata: LegacyAgentToolMetadata,
    createLegacyContext: LegacyToolContextFactory
  ) {
    this.legacyTool = legacyTool;
    this.createLegacyContext = createLegacyContext;
    this.descriptor = {
      name: legacyTool.name,
      description: legacyTool.definition.description,
      inputSchema: legacyTool.definition.parameters as unknown as JsonSchema,
      owner: metadata.owner,
      source: 'local',
      risk: metadata.risk,
      idempotency: metadata.idempotency,
    };
  }

  async execute(
    input: unknown,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult<unknown>> {
    const result = await this.legacyTool.execute(
      input,
      this.createLegacyContext(context)
    );
    return convertLegacyToolResult(result);
  }
}
