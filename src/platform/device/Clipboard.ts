/** UI 复制复用 React Native；按需读取使用原生焦点与有界文字契约。 */
import { Clipboard } from 'react-native';

export { readDeviceClipboardText, type DeviceClipboardSnapshot } from '../../../modules/device-observer';

export function copyTextToClipboard(text: string): void {
  Clipboard.setString(text);
}
