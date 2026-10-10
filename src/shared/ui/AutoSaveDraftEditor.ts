/** 设置编辑入口共用输入确认规则；不拥有业务校验或数据库调度。 */
export type DraftErrors<D> = Partial<Record<keyof D, string>>;

export interface DraftCommit<D, P> {
  patch: P;
  accepted: (keyof D)[];
  errors: DraftErrors<D>;
}

export class AutoSaveDraftEditor<D extends object, P> {
  private saved: D;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | null = null;
  private restoring = false;
  private readyDraft: D | null = null;
  private drainAll = false;
  private listeners = new Set<() => void>();
  private state: { draft: D; errors: DraftErrors<D>; saveError: string | null; dirty: boolean };

  constructor(
    initial: D,
    private readonly parse: (draft: D, changed: (keyof D)[]) => DraftCommit<D, P>,
    private readonly save: (patch: P) => Promise<void>,
  ) {
    this.saved = initial;
    this.state = { draft: initial, errors: {}, saveError: null, dirty: false };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private changed(): (keyof D)[] {
    return (Object.keys(this.saved) as (keyof D)[])
      .filter((key) => this.state.draft[key] !== this.saved[key]);
  }

  private publish() {
    this.state = { ...this.state, dirty: this.changed().length > 0 || this.running !== null };
    for (const listener of this.listeners) listener();
  }

  change = (patch: Partial<D>, immediate = false) => {
    this.state = { ...this.state, draft: { ...this.state.draft, ...patch } };
    // 已显示的错误随输入重新校验；首次输入允许完整的编辑间隔。
    if (Object.keys(this.state.errors).length > 0) {
      this.state.errors = this.parse(this.state.draft, this.changed()).errors;
    }
    this.publish();
    this.cancelTimer();
    if (immediate) void this.requestSave(false);
    else this.timer = setTimeout(() => { void this.requestSave(false); }, 1000);
  };

  /** 路由保留后的外部刷新只同步没有本地修改的字段。 */
  rebase = (incoming: D) => {
    if (this.running) return;
    const changed = new Set(this.changed());
    const draft = { ...this.state.draft };
    const saved = { ...this.saved };
    for (const key of Object.keys(incoming) as (keyof D)[]) {
      if (!changed.has(key)) {
        draft[key] = incoming[key];
        saved[key] = incoming[key];
      }
    }
    this.saved = saved;
    this.state = { ...this.state, draft };
    this.publish();
  };

  flush = (): Promise<boolean> => {
    return this.requestSave(true);
  };

  private requestSave(drainAll: boolean): Promise<boolean> {
    this.cancelTimer();
    this.readyDraft = this.state.draft;
    this.drainAll ||= drainAll;
    if (this.running) return this.running;
    // 先建立执行句柄，再进入异步写入；所有入口等待同一次 drain。
    this.running = Promise.resolve().then(() => this.drain()).finally(() => {
      this.running = null;
      this.readyDraft = null;
      this.drainAll = false;
      if (this.changed().length === 0) this.cancelTimer();
      this.publish();
    });
    this.publish();
    return this.running;
  }

  private async drain(): Promise<boolean> {
    while (true) {
      // 普通自动保存只消费已结束输入间隔的版本；返回/失焦等明确 flush 才排空当前草稿。
      // 旧版本在等待写入期间又被编辑时，让最新版本继续自己的防抖间隔。
      if (!this.drainAll && this.readyDraft !== this.state.draft) return this.changed().length === 0;
      const snapshot = this.state.draft;
      this.readyDraft = null;
      const commit = this.parse(snapshot, this.changed());
      this.state = { ...this.state, errors: commit.errors };
      this.publish();
      if (commit.accepted.length === 0) {
        if (this.changed().length === 0) {
          this.state = { ...this.state, saveError: null };
          return true;
        }
        return false;
      }
      try {
        await this.save(commit.patch);
      } catch (error) {
        console.error('[自动保存] 写入失败', error);
        this.state = {
          ...this.state,
          saveError: '这次修改未能保存，你的输入已保留。',
        };
        return false;
      }
      const saved = { ...this.saved };
      for (const key of commit.accepted) saved[key] = snapshot[key];
      this.saved = saved;
      // 确认只更新 saved；正在输入的草稿始终由用户拥有。
      this.state = { ...this.state, saveError: null };
      this.publish();
      if (this.restoring) return false;
      if (!this.drainAll && this.readyDraft === null) return this.changed().length === 0;
    }
  }

  restore = async () => {
    this.cancelTimer();
    const discarded = this.state.draft;
    this.restoring = true;
    // 已提交的写入不能撤销；等待其确认后恢复到真正持久化的值。
    if (this.running) await this.running;
    this.cancelTimer();
    const draft = { ...this.state.draft };
    // 恢复只放弃点击时的输入；等待已提交写入期间的新输入仍属于用户。
    for (const key of Object.keys(this.saved) as (keyof D)[]) {
      if (draft[key] === discarded[key]) draft[key] = this.saved[key];
    }
    this.state = { draft, errors: {}, saveError: null, dirty: false };
    this.restoring = false;
    this.publish();
    if (this.changed().length > 0) this.timer = setTimeout(() => { void this.requestSave(false); }, 1000);
  };

  validateAll = (): P | null => {
    const commit = this.parse(this.state.draft, Object.keys(this.saved) as (keyof D)[]);
    this.state = { ...this.state, errors: commit.errors };
    this.publish();
    return Object.keys(commit.errors).length === 0 ? commit.patch : null;
  };

  cancelTimer = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
  };
}
