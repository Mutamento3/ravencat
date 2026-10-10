/** 仅供 Host 组装 Floating Layer 的具体仓储与 Android 适配器。 */

export { configureFloatingLayerRuntimeDependencies } from './application/FloatingLayerRuntimeDependencies';
export { floatingLayerAdapter } from './infrastructure/FloatingLayerAdapter';
export { bubbleSkinRepository } from './infrastructure/NativeBubbleSkinRepository';
export { floatingInteractionSettingsRepository } from './infrastructure/SQLiteFloatingInteractionSettingsRepository';
