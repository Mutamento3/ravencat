/** 前台单任务调度器；数据库保存尝试次数，重启与前后台切换不会重置失败预算。 */
import { showAppDialog } from '@shared/ui/appDialogStore';
import { InteractionManager } from 'react-native';
import { subscribeMemoryChanged } from '@features/memory';
import { processNextMemoryEmbedding, synchronizeMemoryEmbeddingModel } from '@features/memory/composition';

let configured = false;
let active = false;
let running: Promise<void> | null = null;
let controller: AbortController | null = null;
let scheduled: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let requested = false;
let modelRefresh: Promise<void> = Promise.resolve();
let refreshingModel = 0;

export function refreshMemoryEmbeddingModel(): void {
  refreshingModel++;
  controller?.abort();
  scheduled?.cancel(); scheduled = null;
  modelRefresh = modelRefresh.then(async () => {
    if (running) await running;
    await synchronizeMemoryEmbeddingModel();
  }).catch((error: unknown) => {
    console.error('[Memory] 模型配置同步失败', error);
  }).finally(() => { refreshingModel--; requestMemoryEmbeddingRun(); });
}

export function configureMemoryEmbeddingQueue(): void {
  if (configured) return;
  configured = true;
  subscribeMemoryChanged(requestMemoryEmbeddingRun);
}
export function requestMemoryEmbeddingRun(): void {
  if (!configured || !active) return;
  requested = true;
  if (running || scheduled || refreshingModel) return;
  if (timer) { clearTimeout(timer); timer = null; }
  scheduled = InteractionManager.runAfterInteractions(() => {
    scheduled = null;
    requested = false;
    controller = new AbortController();
    const signal = controller.signal;
    running = processNextMemoryEmbedding(signal).then((result) => {
      if (result.failedMemoryId && active) showAppDialog({ title: '记忆向量更新失败', message: '自动尝试已停止。记忆正文已经保存，可在记忆页查看原因并手动重试。', tone: 'error' });
      if (result.processed) requested = true;
      if (result.nextWakeAt && active) timer = setTimeout(requestMemoryEmbeddingRun, Math.max(0, Date.parse(result.nextWakeAt) - Date.now()));
    }).catch((error: unknown) => {
      if (!signal.aborted) console.error('[Memory] 向量任务执行失败', error);
    }).finally(() => {
      running = null; controller = null;
      if (requested && active) requestMemoryEmbeddingRun();
    });
  });
}
export function setMemoryEmbeddingForegroundActive(value: boolean): void {
  active = value;
  if (active) requestMemoryEmbeddingRun();
  else {
    scheduled?.cancel(); scheduled = null;
    if (timer) clearTimeout(timer);
    timer = null; requested = false; controller?.abort();
  }
}
export async function stopMemoryEmbeddingQueueForReset(): Promise<void> {
  setMemoryEmbeddingForegroundActive(false);
  if (running) await running;
  await modelRefresh;
}
