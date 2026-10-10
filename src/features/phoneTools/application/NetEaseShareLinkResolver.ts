/** Phone Tools 拥有的网易云 share-link 公开身份解析 contract；不暴露 HTTP redirect 细节。 */

export type NetEaseShareLinkFailureCode =
  | 'invalid_url'
  | 'unsupported_host'
  | 'redirect_rejected'
  | 'too_many_redirects'
  | 'network_failure'
  | 'unsupported_resource_type'
  | 'invalid_resource_id'
  | 'unresolvable_share_link';

export type NetEaseShareLinkFailure = {
  code: NetEaseShareLinkFailureCode;
  message: string;
};

export type NetEaseShareLinkResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NetEaseShareLinkFailure };

/**
 * Share-link resolver 唯一承诺输出的 identity：只含稳定 numeric ID，不含 title / 歌手 / 封面。
 * 首版只承诺 song / playlist。
 */
export type NetEaseSharedResource =
  | { type: 'song'; songId: number }
  | { type: 'playlist'; playlistId: number };

export interface NetEaseShareLinkBackend {
  resolveNetEaseShareLink(url: string): Promise<NetEaseShareLinkResult<NetEaseSharedResource>>;
}
