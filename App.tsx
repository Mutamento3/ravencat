/** 兼容非 Router 工具链的应用入口；实际宿主由 Expo Router 根布局托管。 */
import { ChatScreen } from '@features/chat';
import KimiPhoneHost from '@host/KimiPhoneHost';

export default function KimiPhoneCompatibilityEntry() {
  return (
    <KimiPhoneHost>
      <ChatScreen />
    </KimiPhoneHost>
  );
}
