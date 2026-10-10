/** 悬浮交互用户意图的领域仓储端口。 */

import type { FloatingInteractionSettings } from './FloatingInteractionSettings';

export interface IFloatingInteractionSettingsRepository {
  get(): Promise<FloatingInteractionSettings | null>;
  ensureDefault(): Promise<FloatingInteractionSettings>;
  setEnabled(enabled: boolean): Promise<FloatingInteractionSettings>;
}
