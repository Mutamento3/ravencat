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
    await protocolRepository.update(params.protocolId, payload);
    return true;
  }

  await protocolRepository.insert({
    aiAssistantId: params.aiAssistantId,
    ...payload,
  });
  return true;
}

export async function deleteProtocol(protocolId: string) {
  return protocolRepository.delete(protocolId);
}
