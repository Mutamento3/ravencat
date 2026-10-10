/** 定义本地伴随的 SQLite 事实状态与状态不变量。 */

export const COMPANION_STATE_ID = 'default';

export type CompanionActivationStatus =
  | 'disabled'
  | 'enabling'
  | 'enabled'
  | 'paused_error'
  | 'disabling';

export interface CompanionState {
  id: string;
  desiredEnabled: boolean;
  activationStatus: CompanionActivationStatus;
  hostAIId: string | null;
  lastFailureCode: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UpdateCompanionStateInput = Partial<Omit<
  CompanionState,
  'id' | 'createdAt' | 'updatedAt'
>>;

export interface CompanionStateRow {
  id: string;
  desired_enabled: number;
  activation_status: string;
  /** 升级保留的历史列；统一日程不再使用这个单值版本。 */
  schedule_revision: number;
  host_ai_id: string | null;
  last_failure_code: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

const ACTIVATION_STATUSES = new Set<CompanionActivationStatus>([
  'disabled',
  'enabling',
  'enabled',
  'paused_error',
  'disabling',
]);

export function createCompanionState(
  data: Partial<CompanionState> = {}
): CompanionState {
  const now = new Date().toISOString();
  const state: CompanionState = {
    id: data.id ?? COMPANION_STATE_ID,
    desiredEnabled: data.desiredEnabled ?? false,
    activationStatus: data.activationStatus ?? 'disabled',
    hostAIId: data.hostAIId ?? null,
    lastFailureCode: data.lastFailureCode ?? null,
    lastFailureAt: data.lastFailureAt ?? null,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  };
  assertCompanionState(state);
  return state;
}

export function createCompanionStateFromRow(
  row: CompanionStateRow | null
): CompanionState | null {
  if (!row) return null;
  return createCompanionState({
    id: row.id,
    desiredEnabled: parseSQLiteBoolean(row.desired_enabled, 'desired_enabled'),
    activationStatus: parseActivationStatus(row.activation_status),
    hostAIId: row.host_ai_id,
    lastFailureCode: row.last_failure_code,
    lastFailureAt: row.last_failure_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function assertCompanionState(
  state: CompanionState
): void {
  const enabledStatuses = new Set<CompanionActivationStatus>([
    'enabling',
    'enabled',
    'paused_error',
  ]);
  if (state.desiredEnabled !== enabledStatuses.has(state.activationStatus)) {
    throw new Error('RavenCat 用户意图与激活状态不一致');
  }
}

function parseActivationStatus(value: string): CompanionActivationStatus {
  if (!ACTIVATION_STATUSES.has(value as CompanionActivationStatus)) {
    throw new Error(`RavenCat 激活状态非法：${value}`);
  }
  return value as CompanionActivationStatus;
}

function parseSQLiteBoolean(value: number, fieldName: string): boolean {
  if (value !== 0 && value !== 1) {
    throw new Error(`RavenCat ${fieldName} 布尔值损坏`);
  }
  return value === 1;
}
