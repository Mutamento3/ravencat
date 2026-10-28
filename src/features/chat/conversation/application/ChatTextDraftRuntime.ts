import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { ChatTextDraftRepository } from '../domain/ChatTextDraftRepository';

const slot = createRuntimeSlot<ChatTextDraftRepository>('Chat text drafts');
export const configureChatTextDrafts = (repository: ChatTextDraftRepository) => slot.configure(repository);
export const getChatTextDraftRepository = () => slot.get();
