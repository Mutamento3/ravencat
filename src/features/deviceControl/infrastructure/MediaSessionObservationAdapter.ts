/** 将 Device Control 原生 MediaSession 观察 bridge 适配为独立应用层端口。 */

import {
  getMediaSessionSnapshot,
  getNotificationListenerAccessState,
  openNotificationListenerSettings,
} from '../../../../modules/device-control';
import type { MediaSessionObservationPort } from '../application/MediaSessionObservationPort';

export const mediaSessionObservationAdapter: MediaSessionObservationPort = {
  getNotificationListenerAccessState,
  openNotificationListenerSettings,
  getMediaSessionSnapshot,
};
