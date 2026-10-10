/** 使用当前 React Native 已内置的 Android 剪贴板能力。 */
import { Clipboard } from 'react-native';

export function copyTextToClipboard(text: string): void {
  Clipboard.setString(text);
}
