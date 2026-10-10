/** 模型事实提交后通知 Host 重读配置，事件不携带凭据或另一份配置。 */
const listeners = new Set<() => void>();
export function subscribeAuxiliaryModelsChanged(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function emitAuxiliaryModelsChanged(): void { for (const listener of listeners) listener(); }
