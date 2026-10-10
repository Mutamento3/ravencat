/** 在中性 Host composition 中组装 Phone Tools 的设备事实、Protected Apps 真值与网易云设备能力。 */

import { companionSettingsRepository } from '@features/companion/composition';
import {
  dispatchBrowsableUriToPackage,
  dispatchMediaSessionCommand,
  getCurrentWindowState,
  getMediaSessionSnapshot,
} from '@features/deviceControl';
import {
  configureForegroundAppRuntimeDependencies,
  configureNetEaseMusicRuntimeDependencies,
  configureNetEasePlaybackRuntimeDependencies,
  configureProtectedAppsRuntimeDependencies,
} from '@features/phoneTools/composition';

let configured = false;

export function configurePhoneToolsRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configureProtectedAppsRuntimeDependencies({
    loadUserProtectedPackages: async () => (
      await companionSettingsRepository.ensureDefault()
    ).userScreenCaptureBlacklist,
  });
  configureForegroundAppRuntimeDependencies({ getCurrentWindowState });
  // Host 是两个 feature 的唯一 wiring owner：这里只注入 Device Control 的 application primitive，
  // 不写任何网易云业务逻辑。
  configureNetEaseMusicRuntimeDependencies({ dispatchBrowsableUriToPackage });
  configureNetEasePlaybackRuntimeDependencies({
    getMediaSessionSnapshot,
    dispatchMediaSessionCommand,
  });
}
