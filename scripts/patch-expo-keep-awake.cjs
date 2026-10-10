/** 修复 Expo 开发壳在 Android Activity 不可用时产生的未处理 Keep Awake Promise。 */
const fs = require('fs');
const path = require('path');

const candidatePaths = [
  path.join(
    __dirname,
    '..',
    'node_modules',
    'expo',
    'node_modules',
    'expo-keep-awake',
    'src',
    'index.ts'
  ),
  path.join(
    __dirname,
    '..',
    'node_modules',
    'expo-keep-awake',
    'src',
    'index.ts'
  ),
];

const original = `    activateKeepAwakeAsync(tagOrDefault).then(() => {
      if (isMounted && ExpoKeepAwake.addListenerForTag && options?.listener) {
        addListener(tagOrDefault, options.listener);
      }
    });`;

const patched = `    activateKeepAwakeAsync(tagOrDefault)
      .then(() => {
        if (isMounted && ExpoKeepAwake.addListenerForTag && options?.listener) {
          addListener(tagOrDefault, options.listener);
        }
      })
      .catch(() => {});`;

function patchExpoKeepAwake(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const source = fs.readFileSync(targetPath, 'utf8');
  if (source.includes(patched)) {
    return true;
  }

  if (!source.includes(original)) {
    throw new Error(`expo-keep-awake 源码结构已变化，无法安全应用补丁：${targetPath}`);
  }

  fs.writeFileSync(targetPath, source.replace(original, patched), 'utf8');
  console.log('[postinstall] patched expo-keep-awake activation rejection handling');
  return true;
}

try {
  const patchedTarget = candidatePaths.some(patchExpoKeepAwake);
  if (!patchedTarget) {
    console.warn('[postinstall] expo-keep-awake 未安装，已跳过补丁。');
  }
} catch (error) {
  console.error('[postinstall] failed to patch expo-keep-awake:', error);
  process.exitCode = 1;
}
