/** MCP era 协商客户端：auto 先 probe modern，明确 legacy 证据后进入一次 initialize。 */

import { McpClientError } from './McpClientError';
import type { McpClientPort, McpToolCallOptions } from './McpClientPort';
import type {
  McpConnectionInfo,
  McpListToolsResult,
  McpProtocolSelection,
  McpToolCallResult,
} from './McpProtocolTypes';
import {
  LegacyMcpClientAdapter,
} from './legacy/LegacyMcpClientAdapter';
import {
  isModernProbeLegacyError,
  ModernMcpClientAdapter,
} from './modern/ModernMcpClientAdapter';

export interface NegotiatingMcpClientOptions {
  url: string;
  bearerToken?: string;
  timeoutMs?: number;
  /**
   * 整个连接测试（含 era negotiation）的绝对截止时间戳（epoch ms）；
   * 每个网络请求 timer 只使用剩余时间，不逐请求重置完整预算。
   */
  deadlineAt?: number;
  /** tools/list 最大页数，超过即失败。 */
  maxListPages?: number;
  /** tools/list 最大工具总数，超过即失败。 */
  maxListTools?: number;
  /** 单次 HTTP 响应体上限（字节）。 */
  maxResponseBytes?: number;
  /**
   * 最近一次成功连接的精确 era/revision：
   * - legacy：跳过 modern probe，直接 initialize，并要求本次协商 revision 完全一致；
   * - modern：不发 probe，直接采用 Modern adapter；后续请求失败由调用方显式刷新连接测试。
   */
  knownProtocol?: McpProtocolSelection;
}

export class NegotiatingMcpClient implements McpClientPort {
  private readonly options: NegotiatingMcpClientOptions;
  /** 协商选中的 adapter；connect 成功前为 null。 */
  private selected: McpClientPort | null = null;
  private closed = false;

  constructor(options: NegotiatingMcpClientOptions) {
    this.options = options;
  }

  async connect(signal: AbortSignal): Promise<McpConnectionInfo> {
    this.assertOpen();
    if (this.selected !== null) {
      // 幂等：委托已选中 adapter，其自身保证返回同一协商结果的不可变副本。
      return this.selected.connect(signal);
    }
    if (this.options.knownProtocol !== undefined) {
      return this.connectKnownProtocol(signal, this.options.knownProtocol);
    }
    return this.connectAuto(signal);
  }

  private async connectKnownProtocol(
    signal: AbortSignal,
    knownProtocol: McpProtocolSelection
  ): Promise<McpConnectionInfo> {
    if (knownProtocol.protocolEra === 'legacy') {
      const legacy = new LegacyMcpClientAdapter({
        ...this.options,
        expectedProtocolVersion: knownProtocol.protocolVersion,
      });
      const info = await legacy.connect(signal);
      this.selected = legacy;
      return info;
    }
    const modern = new ModernMcpClientAdapter({
      ...this.options,
      assumeConnected: true,
      protocolVersion: knownProtocol.protocolVersion,
    });
    const info = await modern.connect(signal);
    this.selected = modern;
    return info;
  }

  /** auto：Modern adapter 自己运行纯 classifier；只有明确 legacy verdict 才进入一次 initialize。 */
  private async connectAuto(signal: AbortSignal): Promise<McpConnectionInfo> {
    const modern = new ModernMcpClientAdapter(this.options);
    try {
      const info = await modern.connect(signal);
      this.selected = modern;
      return info;
    } catch (error) {
      if (isModernProbeLegacyError(error)) {
        const legacy = new LegacyMcpClientAdapter(this.options);
        const info = await legacy.connect(signal);
        this.selected = legacy;
        return info;
      }
      throw error;
    }
  }

  async listAllTools(signal: AbortSignal): Promise<McpListToolsResult> {
    this.assertOpen();
    return this.selectedAdapter().listAllTools(signal);
  }

  async callTool(
    name: string,
    args: unknown,
    signal: AbortSignal,
    options: McpToolCallOptions
  ): Promise<McpToolCallResult> {
    this.assertOpen();
    return this.selectedAdapter().callTool(name, args, signal, options);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.selected !== null) {
      await this.selected.close();
    }
  }

  private selectedAdapter(): McpClientPort {
    if (this.selected === null) {
      throw new McpClientError('PROTOCOL_ERROR', 'MCP client 尚未完成协议协商');
    }
    return this.selected;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new McpClientError('TRANSPORT_FAILED', 'MCP client 已关闭');
    }
  }
}
