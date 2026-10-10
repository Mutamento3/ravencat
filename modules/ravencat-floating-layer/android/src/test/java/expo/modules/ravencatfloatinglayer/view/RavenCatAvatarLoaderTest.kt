package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.shadows.ShadowBitmapFactory

@RunWith(RobolectricTestRunner::class)
class RavenCatAvatarLoaderTest {
  @Suppress("DEPRECATION")
  private val context: Context = RuntimeEnvironment.getApplication()

  @Before
  fun setUp() {
    // legacy shadow 默认对非法图片也返回假 Bitmap；关掉后 decode 失败语义与真机一致（返回 null）。
    ShadowBitmapFactory.setAllowInvalidImageData(false)
  }

  @Test
  fun `file uri of an existing image decodes and is sampled near target size`() {
    val file = writePng("avatar-ai.png", width = 800, height = 800)

    val bitmap = RavenCatAvatarLoader.loadLocalAvatar(
      context, Uri.fromFile(file).toString(), targetSizePx = 36,
    )

    assertNotNull(bitmap)
    // 2 的幂采样：800px 图对 36px 目标采样到 [36, 72) 区间，不再持有原图尺寸。
    assertTrue(requireNotNull(bitmap).width in 36 until 72)
    assertTrue(bitmap.height in 36 until 72)
  }

  @Test
  fun `absolute path without scheme also decodes`() {
    val file = writePng("avatar-user.png", width = 200, height = 200)

    assertNotNull(
      RavenCatAvatarLoader.loadLocalAvatar(context, file.absolutePath, targetSizePx = 36),
    )
  }

  @Test
  fun `missing or invalid files return null`() {
    val missing = File(context.cacheDir, "missing.png")
    assertNull(
      RavenCatAvatarLoader.loadLocalAvatar(
        context, Uri.fromFile(missing).toString(), targetSizePx = 36,
      ),
    )

    val broken = File(context.cacheDir, "broken.png").apply { writeText("not an image") }
    assertNull(
      RavenCatAvatarLoader.loadLocalAvatar(
        context, Uri.fromFile(broken).toString(), targetSizePx = 36,
      ),
    )
  }

  @Test
  fun `content uri whose resolver throws returns null without crashing`() {
    assertNull(
      RavenCatAvatarLoader.loadLocalAvatar(
        context, "content://nonexistent.authority/avatar/1", targetSizePx = 36,
      ),
    )
  }

  @Test
  fun `http uris and blank input are not loaded`() {
    assertNull(RavenCatAvatarLoader.loadLocalAvatar(context, null, targetSizePx = 36))
    assertNull(RavenCatAvatarLoader.loadLocalAvatar(context, "   ", targetSizePx = 36))
    assertNull(
      RavenCatAvatarLoader.loadLocalAvatar(
        context, "https://example.com/avatar.png", targetSizePx = 36,
      ),
    )
    assertNull(
      RavenCatAvatarLoader.loadLocalAvatar(
        context, "http://example.com/avatar.png", targetSizePx = 36,
      ),
    )
  }

  private fun writePng(name: String, width: Int, height: Int): File {
    val file = File(context.cacheDir, name)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    FileOutputStream(file).use { output ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
    }
    return file
  }
}
