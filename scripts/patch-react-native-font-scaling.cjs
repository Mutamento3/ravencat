/**
 * 应用统一采用固定字号；在 RN 文本底座关闭系统缩放，覆盖第三方 Markdown 等组件。
 * React 19 的函数组件不再应用 defaultProps，不能在入口修改 Text.defaultProps 来实现此策略。
 * 原生自绘文字另用 DIP；这里只负责 RN 的 Text 与 TextInput，不修改系统资源配置。
 */
const fs = require('node:fs');
const path = require('node:path');

const patches = [
  {
    file: 'Libraries/Text/Text.js',
    replacements: [
      ['allowFontScaling: allowFontScaling !== false,', 'allowFontScaling: false,'],
      ['allowFontScaling={allowFontScaling !== false}', 'allowFontScaling={false}'],
    ],
  },
  {
    file: 'Libraries/Components/TextInput/TextInput.js',
    replacements: [
      ['allowFontScaling={allowFontScaling}', 'allowFontScaling={false}'],
    ],
  },
];

// 先确认所有依赖入口均匹配当前版本，再写入，避免依赖升级时只应用半个策略。
const plans = patches.map(({ file, replacements }) => {
  const target = path.join(__dirname, '..', 'node_modules', 'react-native', file);
  let source = fs.readFileSync(target, 'utf8');
  for (const [original, patched] of replacements) {
    const originalCount = source.split(original).length - 1;
    const patchedCount = source.split(patched).length - 1;
    if (originalCount === 0 && patchedCount === 1) continue;
    if (originalCount !== 1 || patchedCount !== 0) {
      throw new Error(`React Native 文本入口已变化，请审查固定字号策略：${file}`);
    }
    source = source.replace(original, patched);
  }
  return { target, source };
});
for (const { target, source } of plans) {
  fs.writeFileSync(target, source, 'utf8');
}
console.log('[postinstall] 已关闭 React Native 文本与输入框的系统字体缩放');
