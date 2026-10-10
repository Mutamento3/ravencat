/**
 * Expo SQLite 16.0.10 销毁模块时必须先复制待关闭连接列表，再清空缓存。
 * 原实现返回已被清空的同一个列表，开发版重载会遗留连接及未结束事务的写锁。
 * 上游问题：https://github.com/expo/expo/issues/48999
 * 上游修复进入依赖后应审查并删除此补丁，不在业务调用点重试或切换数据库。
 */
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', 'node_modules', 'expo-sqlite',
  'android', 'src', 'main', 'java', 'expo', 'modules', 'sqlite', 'SQLiteModule.kt');

const original = `  private fun removeAllCachedDatabases(): List<NativeDatabase> {
    val databases = cachedDatabases
    cachedDatabases.clear()
    return databases
  }`;
const patched = `  private fun removeAllCachedDatabases(): List<NativeDatabase> {
    val databases = cachedDatabases.toList()
    cachedDatabases.clear()
    return databases
  }`;

const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
if (!source.includes(patched)) {
  if (!source.includes(original)) {
    throw new Error('Expo SQLite 连接销毁实现已变化，请审查并移除此补丁，禁止猜测性替换。');
  }
  fs.writeFileSync(target, source.replace(original, patched), 'utf8');
}
console.log('[postinstall] 已修正 Expo SQLite 模块销毁时的连接列表快照');

// 从源码构建时沿用宿主的 NDK 契约，不能落到 Android Gradle Plugin 自己的默认版本。
const buildTarget = path.join(__dirname, '..', 'node_modules', 'expo-sqlite', 'android', 'build.gradle');
const originalBuild = `android {
  namespace "expo.modules.sqlite"`;
const patchedBuild = `android {
  ndkVersion rootProject.ext.ndkVersion
  namespace "expo.modules.sqlite"`;
const buildSource = fs.readFileSync(buildTarget, 'utf8').replace(/\r\n/g, '\n');
if (!buildSource.includes(patchedBuild)) {
  if (!buildSource.includes(originalBuild)) {
    throw new Error('Expo SQLite 原生构建配置已变化，请审查并移除此补丁，禁止猜测性替换。');
  }
  fs.writeFileSync(buildTarget, buildSource.replace(originalBuild, patchedBuild), 'utf8');
}
