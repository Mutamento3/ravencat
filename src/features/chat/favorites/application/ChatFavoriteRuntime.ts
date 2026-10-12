import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { ChatFavoriteRepository } from '../domain/ChatFavoriteRepository';

const slot = createRuntimeSlot<ChatFavoriteRepository>('Chat favorites');
export function configureChatFavoriteRuntime(repository: ChatFavoriteRepository): void { slot.configure(repository); }
export function getChatFavoriteRepository(): ChatFavoriteRepository { return slot.get(); }
