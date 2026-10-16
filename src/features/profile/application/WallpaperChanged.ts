const listeners = new Set<() => void>();

/** 只在业务提交后广播；Host 将 Profile 的事实接入主题展示层。 */
export function publishWallpaperChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeWallpaperChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
