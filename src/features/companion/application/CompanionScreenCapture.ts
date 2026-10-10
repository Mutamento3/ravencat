/** 连接 Companion 截图策略与 Chat 附件生命周期。 */

import type { ChatAttachment } from '@features/chat';
import {
  captureScreenForCurrentWindow,
  releaseCapturedScreen,
  type CapturedScreen,
} from '@features/screenCapture';
import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';

/** Companion 只发起截图；受保护应用准入由 Screen Observation 统一拥有。 */
export async function captureCompanionScreen(): Promise<CapturedScreen> {
  return captureScreenForCurrentWindow();
}

export async function persistCompanionScreenAttachment(
  capture: CapturedScreen,
): Promise<ChatAttachment> {
  const dependencies = getCompanionRuntimeDependencies();
  const attachment = await dependencies.chatDelivery.persistImageAttachment({
    sourceUri: capture.screenshot.uri,
    source: 'screen_capture',
    fileName: `screen_capture_${capture.screenshot.capturedAtEpochMs}.png`,
    mimeType: capture.screenshot.mimeType,
    width: capture.screenshot.width,
    height: capture.screenshot.height,
  });
  try {
    await releaseCapturedScreen(capture);
  } catch (error) {
    await dependencies.chatDelivery.deletePersistedAttachment(attachment.localUri);
    throw error;
  }
  return attachment;
}

export function deletePersistedCompanionScreenAttachment(
  attachment: ChatAttachment,
): Promise<boolean> {
  return getCompanionRuntimeDependencies()
    .chatDelivery
    .deletePersistedAttachment(attachment.localUri);
}
