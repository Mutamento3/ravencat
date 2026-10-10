/** 单次 Host Agent run 内按 URL + 凭据引用复用 MCP 连接，账号之间互不共享。 */

import { McpClientError, type McpClientPort, type McpProtocolSelection } from '@platform/mcp';

/** 创建协议无关 MCP Client；具体协商策略由 host composition 注入。 */
export type McpClientFactory = (
  url: string,
  knownProtocol: McpProtocolSelection | undefined,
  credentialRef: string | null,
) => McpClientPort | Promise<McpClientPort>;

/**
 * run 级 MCP 连接池：
 * - 同一连接身份的并行工具调用共享创建和握手 Promise；
 * - run 结束统一 dispose：legacy session 在适用时发送 DELETE close，modern 幂等无操作。
 * client 惰性创建：run 中没有任何 MCP 调用时池为空，dispose 是空操作。
 */
export class McpRunClientPool {
  private readonly createClient: McpClientFactory;
  private readonly clients = new Map<string, Promise<McpClientPort>>();
  private readonly connections = new Map<string, Promise<McpClientPort>>();
  private disposed = false;

  constructor(createClient: McpClientFactory) {
    this.createClient = createClient;
  }

  /** 每个连接身份只握手一次；凭据读取与握手都在 run 的取消生命周期内。 */
  async getConnected(
    url: string,
    knownProtocol: McpProtocolSelection | undefined,
    signal: AbortSignal,
    credentialRef: string | null = null,
  ): Promise<McpClientPort> {
    if (this.disposed) {
      throw new McpClientError('TRANSPORT_FAILED', 'MCP 连接池已随本次 run 关闭');
    }
    // 同 URL 的不同账号不能共享连接。惰性创建的 Promise 本身拥有 claim，
    // 并行工具在安全存储读取期间也不会创建第二个 client。
    const key = JSON.stringify([url, credentialRef]);
    const connected = this.connections.get(key);
    if (connected !== undefined) return connected;
    const pendingClient = Promise.resolve().then(() => this.createClient(url, knownProtocol, credentialRef));
    this.clients.set(key, pendingClient);
    const connection = pendingClient.then(async (client) => {
      await client.connect(signal);
      return client;
    });
    this.connections.set(key, connection);
    return connection;
  }

  /**
   * run 结束收口：关闭全部 client。幂等；单个 client 关闭失败不得覆盖 run 主结果。
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    const clients = [...this.clients.values()];
    this.clients.clear();
    this.connections.clear();
    await Promise.all(
      clients.map(async (pendingClient) => {
        try {
          const client = await pendingClient;
          await client.close();
        } catch {
          // best-effort：close 失败仅丢失 session 清理，不影响下一次 run（各自新建 client）。
        }
      })
    );
  }
}
