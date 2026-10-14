/** FlashList 定位暂停只延后消费滚动位置；恢复时不能丢掉用户停住的最后一帧。 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'node_modules/@shopify/flash-list/dist/recyclerview');
const changes = [
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
  if (source.split(original).length !== 2) throw new Error(`FlashList ${name} 滚动契约已变化，请审查暂停恢复补丁`);
  plans.set(file, source.replace(original, patched));
}
for (const [file, source] of plans) {
  fs.writeFileSync(file, source, 'utf8');
}
console.log('[postinstall] FlashList 定位恢复消费末次原生滚动事件');
