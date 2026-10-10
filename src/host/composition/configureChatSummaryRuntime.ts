/** 普通单聊摘要复用该 AI 的聊天模型与单聊·主批次，不引入管理员模型。 */
import { aiAssistantRepository } from '@features/assistants';
import { callRepository } from '@features/calls/composition';
import { configureChatSummaryRuntime, SQLiteChatSummaryRepository, sessionRepository, createChatSummaryPromptBlock, buildChatSummaryModelInput } from '@features/chat/composition';
import { assembleResolvedStandalonePromptPack } from '@host/prompt';
import { createAIClient } from '@platform/ai';
import { configureChatSummaryQueue } from '../runtime/ChatSummaryQueueCoordinator';
import { promptPackBlockFactory } from '../prompt/PromptPackBlockFactory';
let configured = false;
export function configureChatSummary(): void {
  if (configured) return;
  configured = true;
  configureChatSummaryRuntime({
    repository: new SQLiteChatSummaryRepository((tx, conversationId, boundary) => callRepository.readSummarySources(tx, {
      chatSessionId: conversationId, excludedCallIds: boundary.processedCallIds, after: boundary.historyStartsAfter,
    })),
    async getBatchSize(conversationId) {
      const session = await sessionRepository.getSession(conversationId);
      if (!session) return null;
      const assistant = await aiAssistantRepository.getById(session.aiAssistantId);
      if (!assistant || !assistant.apiKey || !assistant.apiBaseUrl || !assistant.model) return null;
      return assistant.privateContextPrimaryLimit;
    },
    async generateAddition(claim, signal) {
      const session = await sessionRepository.getSession(claim.conversationId);
      if (!session) throw new Error('摘要会话已删除');
      const assistant = await aiAssistantRepository.getById(session.aiAssistantId);
      if (!assistant) throw new Error('摘要所属 AI 已删除');
      const controller = new AbortController();
      const forward = () => controller.abort();
      signal.addEventListener('abort', forward, { once: true });
      if (signal.aborted) controller.abort();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const pack = await assembleResolvedStandalonePromptPack({ scenarioId: 'chat.summary', assistantId: assistant.id,
          blocks: [createChatSummaryPromptBlock(), promptPackBlockFactory.createPersonaBlock({
            id: assistant.id, name: assistant.name, systemPrompt: assistant.systemPrompt ?? undefined,
          })], currentInput: buildChatSummaryModelInput(claim, assistant.agentId) });
        const response = await createAIClient({ baseURL: assistant.apiBaseUrl!, apiKey: assistant.apiKey!, model: assistant.model,
          temperature: assistant.temperature, topP: assistant.topP, disableThinking: assistant.disableThinking, maxTokens: assistant.maxTokens ?? undefined }).chat([
            { role: 'system', content: pack.systemPrompt },
            { role: 'user', content: pack.currentInput.content },
          ], { signal: controller.signal, includeSystemPrompt: false });
        if (!response.success) {
          // 此处持有本次请求的角色配置快照，失败时保留模型身份与参数，便于定位多会话队列中的配置错误。
          const context = JSON.stringify({ assistantId: assistant.id, assistantName: assistant.name,
            model: assistant.model, temperature: assistant.temperature, topP: assistant.topP,
            disableThinking: assistant.disableThinking });
          throw new Error(`聊天摘要模型请求失败 ${context}: ${response.error ?? '聊天摘要生成失败'}`);
        }
        return response.text;
      } finally { clearTimeout(timer); signal.removeEventListener('abort', forward); }
    },
  });
  configureChatSummaryQueue();
}
