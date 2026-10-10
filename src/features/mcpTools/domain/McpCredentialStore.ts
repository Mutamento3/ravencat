/** 凭据不进入 SQLite、发现快照或模型上下文；引用在写入后保持不可变。 */
export interface McpCredentialStore {
  save(token: string): Promise<string>;
  read(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}
