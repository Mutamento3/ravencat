/** 通过悬浮层原生模块保存图片，使悬浮 Service 可脱离 React 页面加载装扮。 */

import {
  deleteBubbleSkin,
  getBubbleSkins,
  importBubbleSkin,
  renameBubbleSkin,
  selectBubbleSkin,
  updateBubbleSkinImage,
  setBubbleSize,
} from '../../../../modules/ravencat-floating-layer';
import type { IBubbleSkinRepository } from '../domain/BubbleSkinRepository';
import { withMediaFileLifetime } from '@platform/device';

export const bubbleSkinRepository: IBubbleSkinRepository = {
  list: getBubbleSkins,
  import: (input) => withMediaFileLifetime(() => importBubbleSkin(input)),
  updateImage: (input) => withMediaFileLifetime(() => updateBubbleSkinImage(input)),
  rename: (id, name) => renameBubbleSkin({ id, name }),
  delete: (id) => withMediaFileLifetime(() => deleteBubbleSkin(id)),
  select: selectBubbleSkin,
  setSize: setBubbleSize,
};
