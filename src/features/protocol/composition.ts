/** 组装协议空间界面用例与 SQLite 仓储。 */
import {
  PROTOCOL_MAX_LENGTH,
  protocolRepository,
} from './infrastructure/SQLiteProtocolRepository';

export { PROTOCOL_MAX_LENGTH };

export async function listProtocolsByAI(aiAssistantId: string) {
  return protocolRepository.getByAI(aiAssistantId);
}

export async function saveProtocol(params: {
  protocolId?: string | null;
  aiAssistantId: string;
  content: string;
  summary?: string | null;
}) {
  const payload = {
    content: params.content,
    summary: params.summary ?? null,
  };

  if (params.protocolId) {
    const protocol = await protocolRepository.update(params.aiAssistantId, params.protocolId, payload);
    if (!protocol) throw new Error('协议不存在或不属于当前 AI，请刷新后重试');
    return true;
  }

  await protocolRepository.insert({
    aiAssistantId: params.aiAssistantId,
    ...payload,
  });
  return true;
}

export async function deleteProtocol(aiAssistantId: string, protocolId: string) {
  const deleted = await protocolRepository.delete(aiAssistantId, protocolId);
  if (!deleted) throw new Error('协议不存在或不属于当前 AI，请刷新后重试');
  return true;
}
