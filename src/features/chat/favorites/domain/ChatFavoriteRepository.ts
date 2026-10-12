import type { DatabaseTransactionExecutor } from '@platform/persistence';
import type { ChatFavorite, ChatFavoriteCategory, ChatFavoriteCursor, ChatFavoritePage } from './ChatFavorite';

export interface ChatFavoriteRepository {
  getBySourceInTransaction(transaction: DatabaseTransactionExecutor, messageId: number): Promise<ChatFavorite | null>;
  createInTransaction(transaction: DatabaseTransactionExecutor, favorite: ChatFavorite): Promise<void>;
  list(category: ChatFavoriteCategory | null, cursor: ChatFavoriteCursor | null): Promise<ChatFavoritePage>;
  removeInTransaction(transaction: DatabaseTransactionExecutor, id: string): Promise<string[]>;
}
