import type { MediaAssetChatAttachment } from '../../messages/domain/ChatAttachment';
import type { ChatVoiceMessageMetadata } from '../../messages/domain/chatMessageMetadata';

export type ChatFavoriteCategory = 'text' | 'audio' | 'image' | 'file';
export interface ChatFavoriteSnapshot {
  sourceName: string;
  authorName: string;
  authorKind: 'user' | 'assistant';
  messageCreatedAt: string;
  text: string;
  replyToText: string | null;
  attachments: MediaAssetChatAttachment[];
  voice: ChatVoiceMessageMetadata['voice'] | null;
}
export interface ChatFavorite {
  id: string;
  sourceMessageId: number;
  category: ChatFavoriteCategory;
  savedAt: string;
  snapshot: ChatFavoriteSnapshot;
}
export interface ChatFavoriteCursor { savedAt: string; id: string }
export interface ChatFavoritePage { items: ChatFavorite[]; nextCursor: ChatFavoriteCursor | null }

export function getChatFavoriteCategory(snapshot: ChatFavoriteSnapshot): ChatFavoriteCategory {
  return snapshot.voice ? 'audio' : snapshot.attachments.some(item => item.type === 'file') ? 'file' : snapshot.attachments.length ? 'image' : 'text';
}
