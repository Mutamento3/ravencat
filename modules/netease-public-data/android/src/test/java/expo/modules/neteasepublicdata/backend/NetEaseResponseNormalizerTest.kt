package expo.modules.neteasepublicdata.backend

import expo.modules.neteasepublicdata.model.PublicDataFailureCode
import expo.modules.neteasepublicdata.model.PublicDataResult
import expo.modules.neteasepublicdata.model.SongLyrics
import expo.modules.neteasepublicdata.protocol.EapiResponse
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NetEaseResponseNormalizerTest {
  @Test
  fun `business rejection and malformed shape stay distinct`() {
    val rejected = NetEaseResponseNormalizer.requireSuccess(EapiResponse(200, JSONObject("{\"code\":403}")))
    assertFailure(rejected, PublicDataFailureCode.API_REJECTED)

    val malformed = NetEaseResponseNormalizer.requireSuccess(EapiResponse(200, JSONObject("{}")))
    assertFailure(malformed, PublicDataFailureCode.INVALID_RESPONSE)
  }

  @Test
  fun `known playlist 404 maps to not found`() {
    val result = NetEaseResponseNormalizer.requireSuccess(
      EapiResponse(200, JSONObject("{\"code\":404}")),
      notFoundCode = 404,
    )
    assertFailure(result, PublicDataFailureCode.NOT_FOUND)
  }

  @Test
  fun `lyric states and maximum output are preserved`() {
    assertEquals(
      SongLyrics.Uncollected,
      success(NetEaseResponseNormalizer.lyrics(JSONObject("{\"uncollected\":true}"))),
    )
    assertEquals(
      SongLyrics.NoLyrics,
      success(NetEaseResponseNormalizer.lyrics(JSONObject("{\"nolyric\":true}"))),
    )
    val longText = "词".repeat(NetEaseResponseNormalizer.MAX_LYRIC_CHARACTERS + 10)
    val available = success(NetEaseResponseNormalizer.lyrics(
      JSONObject().put("lrc", JSONObject().put("lyric", longText)),
    )) as SongLyrics.Available
    assertEquals(NetEaseResponseNormalizer.MAX_LYRIC_CHARACTERS, available.text.length)
    assertTrue(available.truncated)
  }

  private fun assertFailure(result: PublicDataResult<*>, code: PublicDataFailureCode) {
    assertEquals(code, (result as PublicDataResult.Failure).error.code)
  }

  private fun <T> success(result: PublicDataResult<T>): T = (result as PublicDataResult.Success).data
}
