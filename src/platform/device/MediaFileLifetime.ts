/**
 * 备份从数据库快照开始持有长期文件，直到原生打包结束。
 * 删除与原地替换必须经过同一边界；新建独立文件不需要等待，且不得在 SQLite 事务内等待它。
 */
let fileLifetimeTail: Promise<void> = Promise.resolve();

export async function withMediaFileLifetime<T>(operation: () => Promise<T>): Promise<T> {
  const previous = fileLifetimeTail;
  let release!: () => void;
  fileLifetimeTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); }
  finally { release(); }
}
