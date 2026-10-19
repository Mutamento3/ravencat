/** FlashList 保留最终滚动位置、实际视口覆盖与迟到布局的阅读锚点。 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'node_modules/@shopify/flash-list/dist/recyclerview');
const changes = [
  ['helpers/EngagedIndicesTracker.js', `        const viewportEnd = viewportStart + viewportSize;
        // STEP 2: Determine buffer size and distribution`, `        // 预测末端在缓冲约束之后计算。
        // STEP 2: Determine buffer size and distribution`],
  ['helpers/EngagedIndicesTracker.js', `        let extendedStart = Math.max(0, viewportStart - bufferBefore);
        // If we couldn't apply full buffer at start, calculate how much was unused
        const unusedStartBuffer = Math.max(0, bufferBefore - viewportStart);
        // Add any unused start buffer to the end buffer
        let extendedEnd = viewportEnd + bufferAfter + unusedStartBuffer;`, `        // 预测只分配已有缓冲区，不能把当前可见内容推出窗口；保留原有挂载预算。
        const boundedViewportStart = Math.max(offset - bufferAfter, Math.min(offset + bufferBefore, viewportStart));
        let extendedStart = Math.max(0, boundedViewportStart - bufferBefore);
        const unusedStartBuffer = Math.max(0, bufferBefore - boundedViewportStart);
        let extendedEnd = boundedViewportStart + viewportSize + bufferAfter + unusedStartBuffer;`],
  ['hooks/useRecyclerViewController.js', `(hasDataChanged || recyclerViewManager.ignoreScrollEvents
                    ? data === null || data === void 0 ? void 0 : data.findIndex((item, index) => recyclerViewManager.getDataKey(index) ===
                        firstVisibleItemKey.current)
                    : undefined)`, `(data === null || data === void 0 ? void 0 : data.findIndex((item, index) => recyclerViewManager.getDataKey(index) ===
                        firstVisibleItemKey.current))`],
  ['hooks/useRecyclerViewController.js', '                const currentIndexOfFirstVisibleItem =', `                // 暂停结束后仍可能有迟到测量把锚点移出窗口；必须继续按稳定 key 找回它。
                const currentIndexOfFirstVisibleItem =`],
  ['hooks/useRecyclerViewController.js', `                        if (hasDataChanged) {
                            updateScrollOffsetWithCallback(recyclerViewManager.getAbsoluteLastScrollOffset() + diff, () => { });`, `                        // 迟到测量的修正也要同步渲染窗口，不能等待下一次原生滚动才追上。
                        updateScrollOffsetWithCallback(recyclerViewManager.getAbsoluteLastScrollOffset() + diff, () => { });
                        if (hasDataChanged) {`],
  ['RecyclerViewManager.js', 'export class RecyclerViewManager {', `export class RecyclerViewManager {
    // 原生手势可能在分页定位暂停期间结束；恢复时交回同一个滚动入口。
    get ignoreScrollEvents() { return this._ignoreScrollEvents; }
    set ignoreScrollEvents(value) {
        this._ignoreScrollEvents = value;
        if (!value) {
            const pending = this.pendingIgnoredScrollEvent;
            this.pendingIgnoredScrollEvent = undefined;
            if (pending) pending();
        }
    }
    deferScrollEvent(callback) { this.pendingIgnoredScrollEvent = callback; }`],
  ['RecyclerViewManager.js', '    dispose() {', `    dispose() {
        this.pendingIgnoredScrollEvent = undefined;`],
  ['RecyclerView.js', `        if (recyclerViewManager.ignoreScrollEvents) {
            return;
        }`, `        if (recyclerViewManager.ignoreScrollEvents) {
            event.persist();
            recyclerViewManager.deferScrollEvent(() => onScrollHandler(event));
            return;
        }`],
];
const plans = new Map();
for (const [name, original, patched] of changes) {
  const file = path.join(root, name);
  const source = plans.get(file) ?? fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  if (source.includes(patched)) continue;
  if (source.split(original).length !== 2) throw new Error(`FlashList ${name} 滚动契约已变化，请审查滚动补丁`);
  plans.set(file, source.replace(original, patched));
}
for (const [file, source] of plans) {
  fs.writeFileSync(file, source, 'utf8');
}
console.log('[postinstall] FlashList 保留最终滚动位置与实际视口覆盖');
