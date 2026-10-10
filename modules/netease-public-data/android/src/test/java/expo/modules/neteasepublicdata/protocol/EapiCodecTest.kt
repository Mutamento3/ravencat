package expo.modules.neteasepublicdata.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class EapiCodecTest {
  @Test
  fun `plaintext and encryption match PHONE-8A fixture`() {
    val uri = "/api/cloudsearch/pc"
    val payload = "{\"s\":\"晴天\",\"type\":1}"
    assertEquals(
      "/api/cloudsearch/pc-36cd479b6b5-$payload-36cd479b6b5-5f82741949a4fdbbe158f53e551ea131",
      EapiCodec.plaintext(uri, payload),
    )
    assertEquals(
      "2B5D64177AA6460FBAA3DCB1285E28954BBB4F7556E09B0FB25750F12398BB5037682BEE8E4AD93F62BEEEE05F00B9E0BEE316873AA94B1A16E26ABB4C447A02DC2107351661EF0FFA09E7D09BE3900D226FEDBB50B3826BD67BD7C98D10FF56C6654F25B32E530C5B1AA5DFFEAC5C53",
      EapiCodec.encrypt(uri, payload),
    )
  }
}
