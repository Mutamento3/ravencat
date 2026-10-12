# UI 原子组件

纯展示组件，无业务逻辑，可在整个项目中复用。

玻璃主题的页面底层保持透明，主要卡片通过 `ThemedSurface` 使用原生材质。
长列表显式传入 `nativeGlass={false}`，输入框与卡片内部的小控件使用主题的轻量染色，
避免逐项模糊或白色底层堆叠。同一玻璃表面里的嵌套卡片不再重复开启原生效果。
`ModalSheet`、全局提示和问号说明气泡统一使用弹窗材质；普通主题保持自己的表面颜色。
表单窗口的键盘避让交给 `ModalSheet` 的 `avoidKeyboard`，Feature 不重复拥有窗口监听。

## 组件列表

| 组件 | 用途 |
|-----|------|
| `AIAvatar` | AI 头像（首字母回退） |
| `AIInfoCard` | AI 信息展示卡片 |
| `AvatarImage` | 通用头像图片（带 fallback） |
| `BackgroundPickerCard` | 背景类图片选择卡片（缩略预览 + 更换 / 恢复默认） |
| `Button` | 通用按钮（primary / secondary / danger / text） |
| `AppDialogHost` / `showAppDialog` | 全应用统一的报错、提示与确认弹窗 |
| `Card` | 通用卡片容器 |
| `CheckIcon` | 勾选图标 |
| `EmptyState` | 空状态占位 |
| `DropdownField` | 通用下拉字段（提供方、模型与参数选择） |
| `InputField` | 通用输入框（带 label / hint） |
| `ListItem` | 通用列表项 |
| `ModalSheet` | 底部弹窗 |
| `ModelPickerModal` | 模型选择弹窗 |
| `NavigationHeader` | 通用页面导航头，可在标题后显示主题主色问号并打开锚定悬浮说明 |
| `Toggle` | 统一的二元开关，包含读屏状态及原生动画 |
| `ToggleField` | 带标题和说明的开关字段，内部使用 `Toggle` |
| `Slider` | 原生手势数值滑杆，支持范围、步长、实时变化及松手通知 |
| `SliderField` | 带标题、数值输入、范围和错误提示的滑杆字段 |
| `UserAvatar` | 用户头像 |

页面只通过 `help.sections` 提供自己拥有的小标题和正文。导航头内部的 `NavigationHeaderHelp` 负责测量问号位置、打开带尖角的悬浮气泡，以及点击外部、系统返回和页面失焦时关闭；页面无需维护提示状态或监听根容器触摸。气泡以透明原生 `Modal` 显示，不占据页面布局，外部点击只关闭气泡，正文内部可滚动阅读。

主窗口和 Modal 的位置都经原生测量，再换算为浮层坐标，避免系统栏和多窗口偏移。气泡宽度受当前窗口限制，小尖角指向问号；页面离开或锚点重新布局后，迟到的测量不能重新打开气泡。问号两侧的布局占位对称，保持页面标题居中；不传 `help` 时不占用说明入口的空间。

## 全局提示弹窗

`showAppDialog({ title, message, tone, buttons })` 用于报错、成功提示、权限说明和操作确认。
`AppDialogHost` 在宿主的主题和安全区域 Provider 内挂载一次，统一拥有展示队列；
调用方继续负责错误解释、业务执行和操作结果，不在公共 UI 中解析异常或重试。

视觉采用柔和圆角、简洁图标和纵向按钮，颜色跟随当前主题。长正文可滚动、选择复制，
按钮不随正文滚动。`tone` 可用 `info`、`success`、`warning`、`error`，默认 `info`。
不提供 `buttons` 时显示“知道了”；操作按钮的 `style` 可用 `default`、`cancel`、`destructive`。
危险操作保持显式确认，返回键或点击遮罩只关闭提示并调用 `onDismiss`，不会执行按钮回调。
必须让用户选择按钮时可传 `dismissible: false`。

连续提示按到达顺序展示；选择按钮后先移出当前提示再调用业务回调，回调产生的新提示继续进入队列。
重复点击不重复执行操作。宿主卸载时清空展示队列，不触发业务回调，不保留旧页面闭包。
这套提示只用于应用内 UI，不承担 Android 通知或 Headless execution 的交付。

```tsx
showAppDialog({
  title: '保存失败',
  message: '无法保存当前配置，请检查后再试。',
  tone: 'error',
});
```

`npm run verify:ui-dialog` 验证确认、关闭、连续提示和宿主卸载行为。

## 添加新组件

`Toggle` 和 `ToggleField` 是受控组件：页面持有业务值、确认弹窗和保存流程，开关只通过
`onValueChange` 表达切换意图，在 `value` 更新后播放动画。异步保存或等待确认时不会先自行
翻转再被旧值拉回。轨道淡入及滑块位移使用原生动画，触摸区域为 48 × 44。
开启轨道使用主题主色；关闭轨道、边框和滑块使用 `components.toggle` 的不透明颜色，
玻璃主题也保持可见。页面不单独设置开关颜色。
`npm run verify:ui-toggle` 验证异步保存、取消确认、禁用、外部状态更新及五个主题的可见性。

`Slider` 为受控组件，调用方保证 `min < max`、`step > 0` 且 `value` 为范围内的合法数值，
通过 `onValueChange` 更新当前值，`onSlidingComplete` 决定提交时机。轨道在原生层接管手势，
快速松手采样最终坐标，系统中断保留最后有效值；禁用时不接受调整。
`SliderField` 在拖动期间只展示本地预览，松手通过 `onSetValue` 通知表单；手动输入及错误原样交给表单，
不解析、保存或回填业务草稿。使用这两个组件的页面需位于已有的 `GestureHandlerRootView` 内。
`npm run verify:ui-slider` 验证手势中断、快速松手、小数步长和已有页面的接入行为。

1. 创建 `.tsx` 文件
2. 默认导出组件
3. 在此目录 `index.ts` 中添加导出
4. 更新本 README
