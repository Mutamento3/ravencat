import type {
  TogetherListeningActivity,
  TogetherListeningEndReason,
  TogetherListeningPhase,
} from './TogetherListeningActivity';

export type CreateTogetherListeningActivityResult =
  | { outcome: 'created'; activity: TogetherListeningActivity }
  | { outcome: 'non_terminal_activity_exists'; activity: TogetherListeningActivity };

/** 生命周期 patch 不包含 identity 字段；Activity 创建后参与者与会话绑定不可改写。 */
export interface TogetherListeningTransitionPatch {
  phase: TogetherListeningPhase;
  updatedAtEpochMs: number;
  activatedAtEpochMs?: number | null;
  endedAtEpochMs?: number | null;
  endReason?: TogetherListeningEndReason | null;
}

export interface ITogetherListeningRepository {
  /** 在一个独占事务中裁决全局唯一 non-terminal Activity。 */
  createIfNoCurrent(
    activity: TogetherListeningActivity,
  ): Promise<CreateTogetherListeningActivityResult>;
  getById(id: string): Promise<TogetherListeningActivity | null>;
  getCurrent(): Promise<TogetherListeningActivity | null>;
  /** expected phase 判断与 UPDATE 属于同一条 SQLite 写语义。 */
  transitionActivityIfPhase(
    id: string,
    expectedPhases: [TogetherListeningPhase, ...TogetherListeningPhase[]],
    patch: TogetherListeningTransitionPatch,
  ): Promise<TogetherListeningActivity | null>;
}
