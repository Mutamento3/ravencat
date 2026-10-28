/** 草稿只有未发送的原始文字，不携带引用、成员身份或媒体资源。 */
export interface ChatTextDraft {
  conversationId: string;
  text: string;
}

export interface ChatTextDraftRepository {
  list(): Promise<ChatTextDraft[]>;
  save(drafts: readonly ChatTextDraft[]): Promise<void>;
}
