import type { ChatTextDraft, ChatTextDraftRepository } from '../domain/ChatTextDraftRepository';

/** 页面和列表共用一份草稿；异步发送只能清除自己捕获的版本。 */
export class ChatTextDraftStore {
  private snapshot = { ready: false, drafts: new Map<string, ChatTextDraft>() as ReadonlyMap<string, ChatTextDraft> };
  private listeners = new Set<() => void>();
  private pending = new Map<string, ChatTextDraft>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loading: Promise<void> | null = null;
  private writing: Promise<void> | null = null;

  constructor(private readonly repository: ChatTextDraftRepository, private readonly reportError: (error: unknown) => void) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(drafts = this.snapshot.drafts) {
    this.snapshot = { ...this.snapshot, drafts };
    for (const listener of this.listeners) listener();
  }

  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.repository.list().then(drafts => {
      const next = new Map(drafts.map(draft => [draft.conversationId, draft]));
      // 页面在读取期间的编辑优先于磁盘快照。
      for (const [id, draft] of this.snapshot.drafts) next.set(id, draft);
      this.snapshot = { ready: true, drafts: next };
      this.publish();
    });
    return this.loading;
  }

  read(id: string): ChatTextDraft | undefined { return this.snapshot.drafts.get(id); }

  change(id: string, text: string): void {
    if (this.read(id)?.text === text) return;
    const draft = { conversationId: id, text };
    const next = new Map(this.snapshot.drafts);
    next.set(id, draft);
    this.pending.set(id, draft);
    this.publish(next);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(this.reportError); }, 300);
  }

  replaceIfUnchanged(id: string, expected: ChatTextDraft | undefined, text: string): void {
    if (this.read(id) === expected) this.change(id, text);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.writing) return this.writing;
    this.writing = Promise.resolve().then(async () => {
      while (this.pending.size) {
        const batch = [...this.pending.values()];
        await this.repository.save(batch);
        for (const draft of batch) {
          if (this.pending.get(draft.conversationId) === draft) this.pending.delete(draft.conversationId);
        }
      }
    }).finally(() => { this.writing = null; });
    return this.writing;
  }
}
