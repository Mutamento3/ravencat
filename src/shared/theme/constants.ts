/** 为静态样式导出默认主题 token 的兼容入口。 */
// 新代码应优先从 @shared/theme 获取运行时主题。

import { defaultLightTheme } from './themes/defaultLight';
import { legacyColorsFromTheme } from './legacyTokens';

export const COLORS = legacyColorsFromTheme(defaultLightTheme);
