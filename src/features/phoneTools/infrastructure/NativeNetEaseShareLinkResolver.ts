import { resolveShareLink } from '../../../../modules/netease-public-data';
import type { NetEaseShareLinkBackend } from '../application/NetEaseShareLinkResolver';

/** production adapter 只把 Phone Tools share-link contract 交给 native resolver。 */
export const nativeNetEaseShareLinkResolver: NetEaseShareLinkBackend = {
  resolveNetEaseShareLink: resolveShareLink,
};
