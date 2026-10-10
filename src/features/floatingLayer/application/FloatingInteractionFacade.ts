/**
 * 悬浮交互的应用层 owner。
 *
 * SQLite 中的 enabled 是用户意图真值；Android 悬浮层只是该意图的执行投影。
 * 因此投影失败时只向调用方报告错误，不回写或覆盖用户已经提交的意图，后续
 * reconcile 可以继续尝试收敛 native 状态。
 */

import type { FloatingInteractionSettings } from '../domain/FloatingInteractionSettings';
import { getFloatingLayerRuntimeDependencies } from './FloatingLayerRuntimeDependencies';

export interface FloatingInteractionState {
  settings: FloatingInteractionSettings;
  running: boolean;
  overlayGranted: boolean;
}

export class FloatingInteractionOverlayPermissionError extends Error {
  readonly code = 'overlay_permission_missing' as const;

  constructor() {
    super('需要先允许悬浮显示，才能开启悬浮交互。');
    this.name = 'FloatingInteractionOverlayPermissionError';
  }
}

/** 只读取 SQLite 用户意图和当前 native 投影，不改变任何状态。 */
export async function loadFloatingInteractionState(): Promise<FloatingInteractionState> {
  const dependencies = getFloatingLayerRuntimeDependencies();
  const [settings, running, overlayGranted] = await Promise.all([
    dependencies.repositories.floatingInteractionSettings.ensureDefault(),
    dependencies.native.floatingLayer.isFloatingLayerRunning(),
    dependencies.native.floatingLayer.isOverlayPermissionGranted(),
  ]);
  return { settings, running, overlayGranted };
}

/**
 * 提交用户意图后再投影到 Android。
 * 开启前缺少 Overlay 权限时不提交意图；提交成功后的 native 失败则原样抛出，
 * 保留 SQLite 中的 enabled 供之后恢复或显式 reconcile。
 */
export async function setFloatingInteractionEnabled(
  enabled: boolean,
): Promise<FloatingInteractionState> {
  const dependencies = getFloatingLayerRuntimeDependencies();

  if (enabled && !await dependencies.native.floatingLayer.isOverlayPermissionGranted()) {
    throw new FloatingInteractionOverlayPermissionError();
  }

  const settings = await dependencies.repositories.floatingInteractionSettings.setEnabled(enabled);
  if (enabled) {
    await dependencies.native.floatingLayer.startFloatingLayer();
  } else {
    await dependencies.native.floatingLayer.stopFloatingLayer();
  }

  const [running, overlayGranted] = await Promise.all([
    dependencies.native.floatingLayer.isFloatingLayerRunning(),
    dependencies.native.floatingLayer.isOverlayPermissionGranted(),
  ]);
  return { settings, running, overlayGranted };
}

/**
 * 以 SQLite 用户意图为依据修复 Android 投影。
 * 缺少 Overlay 时保持 enabled=true 的意图不变，等待权限恢复后再次对账；
 * 其他 native 错误直接暴露给上层，不在此处偷偷关闭或重试。
 */
export async function reconcileFloatingInteraction(): Promise<FloatingInteractionState> {
  const dependencies = getFloatingLayerRuntimeDependencies();
  const settings = await dependencies.repositories.floatingInteractionSettings.ensureDefault();
  const [running, overlayGranted] = await Promise.all([
    dependencies.native.floatingLayer.isFloatingLayerRunning(),
    dependencies.native.floatingLayer.isOverlayPermissionGranted(),
  ]);

  if (settings.enabled && !running && overlayGranted) {
    await dependencies.native.floatingLayer.startFloatingLayer();
    return {
      settings,
      running: await dependencies.native.floatingLayer.isFloatingLayerRunning(),
      overlayGranted,
    };
  } else if (!settings.enabled && running) {
    await dependencies.native.floatingLayer.stopFloatingLayer();
    return {
      settings,
      running: await dependencies.native.floatingLayer.isFloatingLayerRunning(),
      overlayGranted,
    };
  }

  return {
    settings,
    running,
    overlayGranted,
  };
}
