/** 聊天选图的原图读取配置、实际大小、取消与外部错误回归。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const filename = path.resolve(import.meta.dirname, '../src/platform/device/chat/selectChatImage.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cacheUri = 'file:///image-picker-cache/screenshot.jpg';
const pickedAsset = { uri: cacheUri, fileName: 'screenshot.jpg', mimeType: 'image/jpeg', fileSize: 345664, width: 1080, height: 5100 };
const state = {
  selections: [],
  size: 346230,
  result: { canceled: false, assets: [pickedAsset] },
  error: null,
  fileError: null,
};
const dependencies = {
  'expo-image-picker': {
    async launchImageLibraryAsync(options) {
      state.selections.push(options);
      if (state.error) throw state.error;
      return state.result;
    },
  },
  'expo-file-system': {
    File: class {
      constructor(uri) { assert.equal(uri, cacheUri); }
      get name() { return 'screenshot.jpg'; }
      get size() {
        if (state.fileError) throw state.fileError;
        return state.size;
      }
    },
  },
};
const module = { exports: {} };
vm.runInThisContext(`(function(require, module, exports) { ${code}\n})`, { filename })(
  (name) => {
    if (!(name in dependencies)) throw new Error(`未预期的外部依赖：${name}`);
    return dependencies[name];
  }, module, module.exports,
);
const { selectChatImage } = module.exports;

const image = await selectChatImage();
assert.deepEqual(state.selections[0], { mediaTypes: ['images'], allowsEditing: false, quality: 1 });
assert.deepEqual(image, { uri: cacheUri, fileName: 'screenshot.jpg', mimeType: 'image/jpeg', fileSize: 346230, width: 1080, height: 5100, source: 'gallery' });

state.result = { canceled: false, assets: [{ ...pickedAsset, fileName: null }] };
assert.equal((await selectChatImage()).fileName, 'screenshot.jpg', '提供器未返回名称时使用实际缓存文件名');

state.result = { canceled: true, assets: null };
assert.equal(await selectChatImage(), null);
state.result = { canceled: false, assets: [{ ...pickedAsset, fileSize: 1 }] };
state.size = 5 * 1024 * 1024 + 1;
await assert.rejects(selectChatImage(), /图片不能超过 5MB/);

state.size = 346230;
state.error = new Error('所选文件授权失败');
const before = state.selections.length;
await assert.rejects(selectChatImage(), (error) => error === state.error);
assert.equal(state.selections.length, before + 1, '外部失败不得重试选择器');
state.error = null;
state.fileError = new Error('缓存文件读取失败');
await assert.rejects(selectChatImage(), (error) => error === state.fileError);
console.log('聊天选图入口回归通过：原图读取配置、实际大小、文件名、取消、限额与错误传播；原生字节完整性仍需真机验证');
