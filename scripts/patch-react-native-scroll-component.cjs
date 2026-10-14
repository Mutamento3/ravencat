/** 为聊天的文字选择滚动适配开放原生视图插槽；其余滚动逻辑继续由 RN 拥有。 */
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js');
const original = `const NativeScrollView = horizontal
      ? HScrollViewNativeComponent
      : VScrollViewNativeComponent;`;
const patched = `const NativeScrollView = this.props.nativeScrollViewComponent ?? (horizontal
      ? HScrollViewNativeComponent
      : VScrollViewNativeComponent);`;
const source = fs.readFileSync(file, 'utf8');
if (source.includes(patched)) {
  console.log('[postinstall] RN 原生滚动组件插槽已存在');
} else {
  if (source.split(original).length !== 2) throw new Error('RN ScrollView 入口已变化，请审查文字选择滚动适配');
  fs.writeFileSync(file, source.replace(original, patched), 'utf8');
  console.log('[postinstall] 已开放 RN 原生滚动组件插槽');
}
