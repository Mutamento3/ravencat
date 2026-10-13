/** 跨 Feature 初始选择只在 Host 装配；SQL 与用户选择保护留在各 owner。 */
import { configureAuxiliaryModelInitialization, initializeAssistantVoiceModelInTransaction } from '@features/assistants/composition';
import { initializeChatImageModelInTransaction, invalidateChatSummaryModelReferencesInTransaction } from '@features/chat/composition';
import { initializeMemoryEmbeddingModelInTransaction } from '@features/memory/composition';
import { initializeSpeechRecognitionModelInTransaction } from '@features/speech/composition';
import { initializeTranslationModelInTransaction } from '@features/integrations/composition';
import { momentRepository } from '@features/moments/composition';
import { SQLiteStickerRepository, emitStickerAnnotationPending, emitStickerEmbeddingPending } from '@features/stickers/composition';

export function configureAuxiliaryModelInitializationRuntime(): void {
  const stickers = new SQLiteStickerRepository();
  configureAuxiliaryModelInitialization({
    invalidateModelReferencesInTransaction: invalidateChatSummaryModelReferencesInTransaction,
    async initializeModelSelections(transaction, model) {
      switch (model.capabilityKind) {
        case 'ocr':
          await initializeChatImageModelInTransaction(transaction, model.id);
          await momentRepository.initializeImageAnalysisModelInTransaction(transaction, model.id, model.updatedAt);
          await stickers.initializeSystemModelInTransaction(transaction, 'ocr', model.id, model.updatedAt);
          break;
        case 'tts':
          await initializeAssistantVoiceModelInTransaction(transaction, model.id);
          break;
        case 'stt':
          await initializeSpeechRecognitionModelInTransaction(transaction, model.id);
          break;
        case 'embedding':
          await initializeMemoryEmbeddingModelInTransaction(transaction, model.id);
          await stickers.initializeSystemModelInTransaction(transaction, 'embedding', model.id, model.updatedAt);
          break;
        case 'translation':
          await initializeTranslationModelInTransaction(transaction, model.id);
          break;
      }
    },
    async initializeAssistantSelections(transaction, assistantId, models) {
      for (const model of models) {
        if (model.capabilityKind === 'ocr') await initializeChatImageModelInTransaction(transaction, model.id, assistantId);
        if (model.capabilityKind === 'tts') await initializeAssistantVoiceModelInTransaction(transaction, model.id, assistantId);
      }
    },
    modelSelectionsInitialized(model) {
      // 队列唤醒在创建事务提交后；Memory 和设置投影继续消费原有资产变更信号。
      if (model.capabilityKind === 'ocr') emitStickerAnnotationPending();
      if (model.capabilityKind === 'embedding') emitStickerEmbeddingPending();
    },
  });
}
