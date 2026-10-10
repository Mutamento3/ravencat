package expo.modules.neteasepublicdata.protocol

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/** 只实现 PHONE-8A 已验证的 EAPI MD5 + AES-128-ECB envelope。 */
object EapiCodec {
  private const val SEPARATOR = "-36cd479b6b5-"
  private val key = "e82ckenh8dichen8".toByteArray(StandardCharsets.UTF_8)

  fun plaintext(uri: String, jsonPayload: String): String {
    val digestInput = "nobody${uri}use${jsonPayload}md5forencrypt"
    val digest = MessageDigest.getInstance("MD5")
      .digest(digestInput.toByteArray(StandardCharsets.UTF_8))
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    return "$uri$SEPARATOR$jsonPayload$SEPARATOR$digest"
  }

  fun encrypt(uri: String, jsonPayload: String): String {
    val cipher = Cipher.getInstance("AES/ECB/PKCS5Padding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
    return cipher.doFinal(plaintext(uri, jsonPayload).toByteArray(StandardCharsets.UTF_8))
      .joinToString("") { byte -> "%02X".format(byte.toInt() and 0xff) }
  }
}
