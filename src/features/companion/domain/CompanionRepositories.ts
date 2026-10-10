/** 汇总本地伴随设置与状态的领域端口。 */

import type {
  CompanionSettings,
  UpdateCompanionSettingsInput,
} from './CompanionSettings';
import type {
  CompanionState,
  UpdateCompanionStateInput,
} from './CompanionState';

export interface CompanionSettingsRepository {
  get(): Promise<CompanionSettings | null>;
  ensureDefault(): Promise<CompanionSettings>;
  update(
    updates: UpdateCompanionSettingsInput
  ): Promise<CompanionSettings>;
}

export interface CompanionStateRepository {
  get(): Promise<CompanionState | null>;
  ensureDefault(): Promise<CompanionState>;
  update(
    updates: UpdateCompanionStateInput
  ): Promise<CompanionState>;
}
