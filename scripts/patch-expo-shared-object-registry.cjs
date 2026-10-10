/**
 * Expo SDK 54 的原生对象注册表必须在同一把锁下读写。
 * 否则注册表扩容时，并发 SQLite 参数转换可能将存活对象误判为已释放。
 * 上游问题：https://github.com/expo/expo/issues/50855
 * 上游修复进入本项目依赖后应删除此补丁。
 */
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', 'node_modules', 'expo-modules-core',
  'android', 'src', 'main', 'java', 'expo', 'modules', 'kotlin', 'sharedobjects',
  'SharedObjectRegistry.kt');

const replacements = [
  [
    `  internal fun toNativeObject(id: SharedObjectId): SharedObject {
    val native = pairs[id.ensureWasNotRelease()]?.first
    return native ?: throw InvalidSharedObjectIdException()
  }`,
    `  internal fun toNativeObject(id: SharedObjectId): SharedObject = synchronized(this) {
    val native = pairs[id.ensureWasNotRelease()]?.first
    native ?: throw InvalidSharedObjectIdException()
  }`,
  ],
  [
    `    val id = SharedObjectId(js.getProperty(sharedObjectIdPropertyName).getInt())
    return pairs[id]?.first`,
    `    val id = SharedObjectId(js.getProperty(sharedObjectIdPropertyName).getInt())
    return synchronized(this) { pairs[id]?.first }`,
  ],
];

let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
for (const [original, patched] of replacements) {
  if (source.includes(patched)) continue;
  if (!source.includes(original)) {
    throw new Error('Expo 原生对象注册表已变化，请审查并移除此补丁，禁止猜测性替换。');
  }
  source = source.replace(original, patched);
}
fs.writeFileSync(target, source, 'utf8');
console.log('[postinstall] 已修正 Expo 原生对象注册表读取锁');
