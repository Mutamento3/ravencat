package expo.modules.neteasepublicdata.bridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.neteasepublicdata.backend.NetEasePublicDataBackend
import expo.modules.neteasepublicdata.model.NetEaseSharedResource
import expo.modules.neteasepublicdata.model.PlaylistCandidate
import expo.modules.neteasepublicdata.model.PublicDataFailure
import expo.modules.neteasepublicdata.model.PublicDataFailureCode
import expo.modules.neteasepublicdata.model.PublicDataResult
import expo.modules.neteasepublicdata.model.PublicPlaylist
import expo.modules.neteasepublicdata.model.SongCandidate
import expo.modules.neteasepublicdata.model.SongLyrics
import expo.modules.neteasepublicdata.protocol.HttpsEapiTransport
import expo.modules.neteasepublicdata.resolver.HttpsShareLinkRedirectTransport
import expo.modules.neteasepublicdata.resolver.NetEaseShareLinkResolver

/** Phone Tools 的网易云公开只读 bridge；不拥有 Tool 注册、授权、播放或 UI。 */
class NetEasePublicDataModule : Module() {
  private val backend = NetEasePublicDataBackend(HttpsEapiTransport())
  private val shareLinkResolver = NetEaseShareLinkResolver(HttpsShareLinkRedirectTransport())

  override fun definition() = ModuleDefinition {
    Name("RavenCatNetEasePublicData")

    AsyncFunction("searchSongs") { query: String, limit: Int ->
      backend.searchSongs(query, limit).toBridgeMap { songs -> songs.map(SongCandidate::toMap) }
    }
    AsyncFunction("searchPublicPlaylists") { query: String, limit: Int ->
      backend.searchPublicPlaylists(query, limit)
        .toBridgeMap { playlists -> playlists.map(PlaylistCandidate::toMap) }
    }
    AsyncFunction("getPublicPlaylist") { playlistId: Double, offset: Int, limit: Int ->
      parseId(playlistId)?.let { id ->
        backend.getPublicPlaylist(id, offset, limit).toBridgeMap(PublicPlaylist::toMap)
      } ?: invalidId<PublicPlaylist>().toBridgeMap(PublicPlaylist::toMap)
    }
    AsyncFunction("getSongLyrics") { songId: Double ->
      parseId(songId)?.let { id ->
        backend.getSongLyrics(id).toBridgeMap(SongLyrics::toMap)
      } ?: invalidId<SongLyrics>().toBridgeMap(SongLyrics::toMap)
    }
    AsyncFunction("resolveShareLink") { url: String ->
      shareLinkResolver.resolve(url).toBridgeMap(NetEaseSharedResource::toMap)
    }
  }

  private fun parseId(value: Double): Long? = value.toLong().takeIf {
    value.isFinite() && value == it.toDouble() && it in 1..9_007_199_254_740_991L
  }

  private fun <T> invalidId(): PublicDataResult<T> = PublicDataResult.Failure(PublicDataFailure(
    PublicDataFailureCode.INVALID_RESPONSE,
    "ID 必须是正安全整数",
  ))
}
