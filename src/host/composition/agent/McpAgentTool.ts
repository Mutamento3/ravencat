/** MCP meta-tool：把本次 run 冻结的定义接入统一 AgentTool 执行契约。 */

import type {
  AgentTool,
  AgentToolDescriptor,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  JsonSchema,
} from '@shared/aiTools';
import { matchesAgentToolInputSchema } from '@shared/aiTools';
import {
  isMcpClientError,
  type McpToolCallResult,
} from '@platform/mcp';
import type { McpRunClientPool } from './McpRunClientPool';
import type { McpFrozenToolDefinition } from './registerMcpAgentTools';

function extractModelText(result: McpToolCallResult): string {
  const texts = result.content
    .filter((part) => typeof part.text === 'string' && part.text.length > 0)
    .map((part) => part.text as string);
  if (texts.length > 0) {
    return texts.join('\n');
  }
  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent);
    } catch {
      return '工具返回了无法序列化的结构化内容';
    }
  }
  return '工具已执行，没有返回文本内容';
}

export function convertMcpToolCallResult(
  result: McpToolCallResult
): AgentToolExecutionResult<unknown> {
  const modelContent = truncateObservation(extractModelText(result));
  if (result.isError) {
    return {
      status: 'error',
      code: 'MCP_TOOL_ERROR',
      retryable: false,
      modelContent,
    };
  }
  return {
    status: 'success',
    data: result.structuredContent ?? result.content,
    modelContent,
  };
}

/** MCP meta-tool 的固定模型名称；具体远端工具不会进入 Registry。 */
export const MCP_META_TOOL_NAMES = ['mcp_list_tools', 'mcp_call_tool'] as const;

/** 观察结果的总字符上限，防止工具目录把后续模型上下文挤掉。 */
export const MCP_META_TOOL_MAX_OBSERVATION_CHARS = 16_000;
/** 单工具按需返回 schema 时允许的上限；MCP 发现阶段已将 schema 限制在 64 KiB。 */
export const MCP_META_TOOL_MAX_SINGLE_SCHEMA_CHARS = 96_000;
/** 单次观察最多展示的工具条目数；超出部分通过按工具查询继续获取。 */
export const MCP_META_TOOL_MAX_TOOLS_PER_OBSERVATION = 64;

interface McpListToolsInput {
  serverName?: string;
  remoteToolName?: string;
}

interface McpCallToolInput {
  serverName: string;
  remoteToolName: string;
  arguments?: Record<string, unknown>;
}

const MCP_LIST_TOOLS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    serverName: {
      type: 'string',
      description: 'MCP 服务名；不传时只返回可用服务摘要',
    },
    remoteToolName: {
      type: 'string',
      description: '远端工具名；传入后只返回该工具的完整参数 schema',
    },
  },
  additionalProperties: false,
};

const MCP_CALL_TOOL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    serverName: {
      type: 'string',
      description: 'MCP 服务名（来自服务简介）',
    },
    remoteToolName: {
      type: 'string',
      description: '远端工具名（来自 mcp_list_tools）',
    },
    arguments: {
      type: 'object',
      description: '远端工具参数对象；无参数工具可省略',
    },
  },
  required: ['serverName', 'remoteToolName'],
  additionalProperties: false,
};

const MCP_LIST_TOOLS_DESCRIPTOR: AgentToolDescriptor = {
  name: 'mcp_list_tools',
  description: '列出 MCP 服务摘要或指定服务的工具名、简介与参数 schema。',
  inputSchema: MCP_LIST_TOOLS_SCHEMA,
  owner: 'mcp:meta',
  source: 'mcp',
  risk: 'safe_read',
  idempotency: 'idempotent',
};

const MCP_CALL_TOOL_DESCRIPTOR: AgentToolDescriptor = {
  name: 'mcp_call_tool',
  description: '按服务名和远端工具名调用已授权的 MCP 工具。',
  inputSchema: MCP_CALL_TOOL_SCHEMA,
  owner: 'mcp:meta',
  source: 'mcp',
  risk: 'external_side_effect',
  idempotency: 'not_idempotent',
};

/** 只在 meta-tool 闭包内持有本次 run 的冻结定义和连接池。 */
export class McpListToolsMetaTool implements AgentTool<McpListToolsInput, unknown> {
  readonly descriptor = MCP_LIST_TOOLS_DESCRIPTOR;

  constructor(private readonly frozen: readonly McpFrozenToolDefinition[]) {}

  async execute(
    input: McpListToolsInput,
    _context: AgentToolExecutionContext,
  ): Promise<AgentToolExecutionResult<unknown>> {
    const serverName = input.serverName;
    const remoteToolName = input.remoteToolName;
    if (remoteToolName !== undefined && serverName === undefined) {
      return errorObservation(
        'MCP_META_INPUT_INVALID',
        '查询单个工具 schema 时必须同时提供 serverName。',
      );
    }

    if (serverName === undefined) {
      return this.listServerSummaries();
    }

    const server = findUniqueServer(this.frozen, serverName);
    if (server.status !== 'ok') {
      return serverObservationError(server, this.frozen);
    }
    const tools = this.frozen.filter((tool) => tool.serverId === server.serverId);
    if (remoteToolName !== undefined) {
      const tool = tools.find((candidate) => candidate.remoteToolName === remoteToolName);
      if (tool === undefined) {
        return errorObservation(
          'MCP_TOOL_NOT_FOUND',
          `MCP 服务「${serverName}」没有已授权工具「${remoteToolName}」。可用工具：${formatToolNames(tools)}。`,
        );
      }
      return this.listSingleTool(serverName, tool);
    }
    return this.listServerTools(serverName, tools);
  }

  private listServerSummaries(): AgentToolExecutionResult<unknown> {
    const summaries = uniqueServerSummaries(this.frozen);
    if (summaries.some((summary) => summary.ambiguous)) {
      return errorObservation(
        'MCP_SERVER_AMBIGUOUS',
        formatAmbiguousServerNames(summaries.filter((summary) => summary.ambiguous).map((summary) => summary.name)),
      );
    }
    const visible = summaries.slice(0, MCP_META_TOOL_MAX_TOOLS_PER_OBSERVATION);
    const lines = ['当前可用的 MCP 服务：'];
    const footer = '需要工具清单时调用 mcp_list_tools 并传 serverName；需要单个参数 schema 时再传 remoteToolName。';
    const overflowNotice = `服务数量超过单次观察上限（${MCP_META_TOOL_MAX_TOOLS_PER_OBSERVATION}），请指定 serverName 查询。`;
    const tail = [overflowNotice, footer];
    const contentLimit = MCP_META_TOOL_MAX_OBSERVATION_CHARS - tail.join('\n').length - 1;
    let appendedCount = 0;
    for (const summary of visible) {
      const line = summary.description.length > 0
        ? `${summary.name}：${trimDescription(summary.description)}`
        : summary.name;
      if (!appendLineWithinLimit(lines, line, contentLimit)) {
        break;
      }
      appendedCount += 1;
    }
    if (appendedCount < summaries.length) {
      lines.push(overflowNotice);
    }
    lines.push(footer);
    return {
      status: 'success',
      data: visible.map(({ name, description }) => ({ name, description })),
      modelContent: lines.join('\n'),
    };
  }

  private listServerTools(
    serverName: string,
    tools: readonly McpFrozenToolDefinition[],
  ): AgentToolExecutionResult<unknown> {
    const visible = tools.slice(0, MCP_META_TOOL_MAX_TOOLS_PER_OBSERVATION);
    const header = `服务「${serverName}」可用工具（共 ${tools.length} 个）：`;
    const footer = '调用 mcp_call_tool 时传 serverName、remoteToolName 和 arguments。';
    const overflowNotice = '工具目录较大，本次仅展示工具名和简介；请传 remoteToolName 查询某个工具的完整参数 schema。';
    const fullLines = [header];
    for (const [index, tool] of visible.entries()) {
      fullLines.push(formatToolEntry(index + 1, tool, true));
    }
    const canIncludeAllSchemas = visible.length === tools.length
      && [...fullLines, footer].join('\n').length <= MCP_META_TOOL_MAX_OBSERVATION_CHARS;
    const lines = [header];
    const tail = canIncludeAllSchemas ? [footer] : [overflowNotice, footer];
    const contentLimit = MCP_META_TOOL_MAX_OBSERVATION_CHARS - tail.join('\n').length - 1;
    for (const [index, tool] of visible.entries()) {
      const line = formatToolEntry(index + 1, tool, canIncludeAllSchemas);
      if (!appendLineWithinLimit(lines, line, contentLimit)) {
        break;
      }
    }
    lines.push(...tail);
    return {
      status: 'success',
      data: visible.map((tool) => ({
        remoteToolName: tool.remoteToolName,
        description: tool.description,
        ...(canIncludeAllSchemas ? { inputSchema: tool.inputSchema } : {}),
      })),
      modelContent: lines.join('\n'),
    };
  }

  private listSingleTool(
    serverName: string,
    tool: McpFrozenToolDefinition,
  ): AgentToolExecutionResult<unknown> {
    const modelContent = [
      `服务「${serverName}」工具「${tool.remoteToolName}」：`,
      `描述：${trimDescription(tool.description) || '（无描述）'}`,
      `参数 schema：${JSON.stringify(tool.inputSchema)}`,
      '调用 mcp_call_tool 时传 serverName、remoteToolName 和 arguments。',
    ].join('\n');
    if (modelContent.length > MCP_META_TOOL_MAX_SINGLE_SCHEMA_CHARS) {
      throw new Error('MCP 工具参数 schema 超出 meta-tool observation 上限');
    }
    return {
      status: 'success',
      data: {
        remoteToolName: tool.remoteToolName,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      modelContent,
    };
  }
}

export class McpCallToolMetaTool implements AgentTool<McpCallToolInput, unknown> {
  readonly descriptor = MCP_CALL_TOOL_DESCRIPTOR;

  constructor(
    private readonly frozen: readonly McpFrozenToolDefinition[],
    private readonly clients: McpRunClientPool,
  ) {}

  async execute(
    input: McpCallToolInput,
    context: AgentToolExecutionContext,
  ): Promise<AgentToolExecutionResult<unknown>> {
    const server = findUniqueServer(this.frozen, input.serverName);
    if (server.status !== 'ok') {
      return serverObservationError(server, this.frozen);
    }
    const definition = this.frozen.find(
      (tool) => tool.serverId === server.serverId && tool.remoteToolName === input.remoteToolName,
    );
    if (definition === undefined) {
      const tools = this.frozen.filter((tool) => tool.serverId === server.serverId);
      return errorObservation(
        'MCP_TOOL_NOT_FOUND',
        `MCP 服务「${input.serverName}」没有已授权工具「${input.remoteToolName}」。可用工具：${formatToolNames(tools)}。`,
      );
    }

    const argumentsValue = input.arguments === undefined ? {} : input.arguments;
    // 具体 MCP schema 是发现快照冻结时的执行契约；在触网前复用 Runtime 的
    // 共享校验器，避免 meta-tool 的外层 schema 把内部参数当成任意 object 放行。
    if (!matchesAgentToolInputSchema(argumentsValue, definition.inputSchema)) {
      return errorObservation(
        'MCP_TOOL_INPUT_INVALID',
        `工具「${input.remoteToolName}」的 arguments 不符合其 input schema；请先调用 mcp_list_tools 获取完整 schema 后重试。`,
      );
    }

    try {
      const client = await this.clients.getConnected(
        definition.serverUrl,
        {
          protocolEra: definition.protocolEra,
          protocolVersion: definition.protocolVersion,
        },
        context.abortSignal,
        definition.credentialRef,
      );
      const result = await client.callTool(
        definition.remoteToolName,
        argumentsValue,
        context.abortSignal,
        { inputSchema: definition.inputSchema },
      );
      return convertMcpToolCallResult(result);
    } catch (error) {
      // 取消必须回到 Runtime 的统一生命周期收口；只有已知 MCP client 错误
      // 才能转换成模型可修正的 observation，未知异常直接暴露为编程错误。
      if (context.abortSignal.aborted || (isMcpClientError(error) && error.code === 'CANCELLED')) {
        throw error;
      }
      if (!isMcpClientError(error)) {
        throw error;
      }
      const message = error.message;
      return errorObservation('MCP_PROTOCOL_ERROR', `MCP 工具调用失败：${message}`);
    }
  }
}

export function createMcpMetaTools(input: {
  frozen: readonly McpFrozenToolDefinition[];
  clients: McpRunClientPool;
}): [McpListToolsMetaTool, McpCallToolMetaTool] {
  return [
    new McpListToolsMetaTool(input.frozen),
    new McpCallToolMetaTool(input.frozen, input.clients),
  ];
}

type ServerLookup =
  | { status: 'ok'; serverId: string }
  | { status: 'missing'; serverName: string }
  | { status: 'ambiguous'; serverName: string; serverIds: string[] };

function findUniqueServer(
  frozen: readonly McpFrozenToolDefinition[],
  serverName: string,
): ServerLookup {
  const matches = frozen.filter((tool) => tool.serverName === serverName);
  if (matches.length === 0) {
    return { status: 'missing', serverName };
  }
  const serverIds = [...new Set(matches.map((tool) => tool.serverId))];
  if (serverIds.length !== 1) {
    return { status: 'ambiguous', serverName, serverIds };
  }
  return { status: 'ok', serverId: serverIds[0] };
}

function uniqueServerSummaries(
  frozen: readonly McpFrozenToolDefinition[],
): { name: string; description: string; ambiguous: boolean }[] {
  const grouped = new Map<string, McpFrozenToolDefinition[]>();
  for (const tool of frozen) {
    const group = grouped.get(tool.serverName);
    if (group === undefined) {
      grouped.set(tool.serverName, [tool]);
    } else {
      group.push(tool);
    }
  }
  return [...grouped.entries()].map(([name, tools]) => ({
    name,
    description: tools[0].serverDescription,
    ambiguous: new Set(tools.map((tool) => tool.serverId)).size > 1,
  }));
}

function serverObservationError(
  lookup: Exclude<ServerLookup, { status: 'ok' }>,
  frozen: readonly McpFrozenToolDefinition[],
): AgentToolExecutionResult<unknown> {
  if (lookup.status === 'ambiguous') {
    return errorObservation(
      'MCP_SERVER_AMBIGUOUS',
      `MCP 服务名「${lookup.serverName}」对应多个配置（${lookup.serverIds.join('、')}），存在配置歧义；请先在 MCP 工具中心重命名服务。`,
    );
  }
  const summaries = uniqueServerSummaries(frozen);
  const ambiguousNames = summaries.filter((summary) => summary.ambiguous).map((summary) => summary.name);
  if (ambiguousNames.length > 0) {
    return errorObservation('MCP_SERVER_AMBIGUOUS', formatAmbiguousServerNames(ambiguousNames));
  }
  const names = summaries.map((summary) => summary.name);
  return errorObservation(
    'MCP_SERVER_NOT_FOUND',
    `MCP 服务「${lookup.serverName}」不存在或未授权。可用服务：${names.join('、') || '无'}。`,
  );
}

function formatAmbiguousServerNames(names: readonly string[]): string {
  return `MCP 服务名存在配置歧义：${names.join('、')}。请先在 MCP 工具中心为重复服务改名。`;
}

function formatToolNames(tools: readonly McpFrozenToolDefinition[]): string {
  const names = tools
    .slice(0, MCP_META_TOOL_MAX_TOOLS_PER_OBSERVATION)
    .map((tool) => tool.remoteToolName);
  const suffix = tools.length > names.length ? ` 等 ${tools.length} 个工具` : '';
  return names.length > 0 ? `${names.join('、')}${suffix}` : '无';
}

function formatToolEntry(
  index: number,
  tool: McpFrozenToolDefinition,
  includeSchema: boolean,
): string {
  const lines = [`${index}. ${tool.remoteToolName} —— ${trimDescription(tool.description) || '（无描述）'}`];
  if (includeSchema) {
    lines.push(`   参数 schema: ${JSON.stringify(tool.inputSchema)}`);
  }
  return lines.join('\n');
}

function trimDescription(description: string): string {
  const maxLength = 512;
  return description.length > maxLength ? `${description.slice(0, maxLength - 1)}…` : description;
}

function appendLineWithinLimit(lines: string[], line: string, limit: number): boolean {
  const candidate = lines.length === 0 ? line : `${lines.join('\n')}\n${line}`;
  if (candidate.length > limit) {
    return false;
  }
  lines.push(line);
  return true;
}

function errorObservation(code: string, modelContent: string): AgentToolExecutionResult<unknown> {
  return {
    status: 'error',
    code,
    retryable: false,
    modelContent: truncateObservation(modelContent),
  };
}

function truncateObservation(value: string): string {
  if (value.length <= MCP_META_TOOL_MAX_OBSERVATION_CHARS) {
    return value;
  }
  const suffix = '\n[观察结果已截断]';
  return `${value.slice(0, MCP_META_TOOL_MAX_OBSERVATION_CHARS - suffix.length)}${suffix}`;
}
