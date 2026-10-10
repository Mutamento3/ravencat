/** 将 Device Control 原生 MediaSession transport bridge 适配为独立应用层控制端口。 */

import { dispatchMediaSessionCommand } from '../../../../modules/device-control';
import type { MediaSessionControlPort } from '../application/MediaSessionControlPort';

export const mediaSessionControlAdapter: MediaSessionControlPort = {
  dispatchMediaSessionCommand,
};
