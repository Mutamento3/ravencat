/** 快照仅服务当前 lookAtUser；文件删除成功后清空 URI，历史文本与 OCR 事实保留。 */
import { createRandomUUID, persistentMediaStore, getPersistentMediaCategoryPrefix, PERSISTENT_MEDIA_CATEGORY } from '@platform/device';
import { getCallRuntimeDependencies } from '../runtime/CallRuntimeDependencies';

export const CALL_SNAPSHOT_BACKUP_EXCLUSIONS = [getPersistentMediaCategoryPrefix(PERSISTENT_MEDIA_CATEGORY.callSnapshot)];
// 文件先于事实提交；运行实例前缀让冷启动能回收无记录的残留，同时保护本实例正在准备的帧。
export const CALL_SNAPSHOT_PROCESS_PREFIX = `call-runtime-${createRandomUUID()}_`;

export async function discardPreviousProcessCallSnapshots(): Promise<void> {
  const repository = getCallRuntimeDependencies().repositories.calls;
  try {
    const files = await repository.listSnapshotFiles();
    await persistentMediaStore.deleteCategoryFilesExceptPrefix(PERSISTENT_MEDIA_CATEGORY.callSnapshot, CALL_SNAPSHOT_PROCESS_PREFIX);
    for (const file of files) {
      if (file.uri.slice(file.uri.lastIndexOf('/') + 1).startsWith(CALL_SNAPSHOT_PROCESS_PREFIX)) continue;
      await repository.clearSnapshotFile(file.id, file.uri);
    }
  } catch (error) {
    console.warn('[Calls] 上一进程快照清理失败，保留待清理引用：', error);
  }
}

export async function discardCallSnapshots(callId?: string, attachmentIds?: readonly string[]): Promise<void> {
  const repository = getCallRuntimeDependencies().repositories.calls;
  let files: { id: string; uri: string }[];
  try { files = await repository.listSnapshotFiles(callId); }
  catch (error) { console.warn('[Calls] 快照清理查询失败：', error); return; }
  for (const file of files) {
    if (attachmentIds && !attachmentIds.includes(file.id)) continue;
    try {
      await persistentMediaStore.deleteCategoryFileIfExists(file.uri, PERSISTENT_MEDIA_CATEGORY.callSnapshot);
      await repository.clearSnapshotFile(file.id, file.uri);
    } catch (error) {
      // 失败保留定位供下次冷启动重试；不把文件 IO 放进 SQLite 事务。
      console.warn('[Calls] 快照销毁失败，保留待清理引用：', { attachmentId: file.id, error });
    }
  }
}
