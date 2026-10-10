/** 定义每 AI 的逐工具授权覆盖。 */

export interface AssistantToolPermission {
  assistantId: string;
  toolName: string;
  enabled: boolean;
  updatedAt: string;
}

export interface AssistantToolPermissionRepository {
  list(assistantId: string): Promise<AssistantToolPermission[]>;
  set(permission: AssistantToolPermission): Promise<AssistantToolPermission>;
}
