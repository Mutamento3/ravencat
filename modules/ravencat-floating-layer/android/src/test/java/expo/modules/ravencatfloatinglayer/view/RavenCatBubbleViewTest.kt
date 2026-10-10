package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.Looper
import android.widget.ImageView
import expo.modules.ravencatfloatinglayer.BubbleSkin
import expo.modules.ravencatfloatinglayer.BubbleSkinSource
import expo.modules.ravencatfloatinglayer.BubbleSkinStore
import expo.modules.ravencatfloatinglayer.model.RavenCatBubbleDockSide
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlaySnapshot
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** 保护实际显示、贴边镜像和拖动期间图片复用，不锁定加载器内部实现。 */
@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class RavenCatBubbleViewTest {
  private val context: Context = RuntimeEnvironment.getApplication()

  @Test
  fun `single image stays loaded during drag and mirrors only on left edge`() {
    val file = png()
    val skin = BubbleSkin("user-test", "单图", BubbleSkinSource.USER, "image/png", file.path)
    val snapshot = snapshot(skin)
    val view = RavenCatBubbleView(context) {}
    val image = view.getChildAt(0) as ImageView
    view.render(snapshot)
    await { image.drawable != null }
    val drawable = image.drawable
    // 移除 backing 后继续拖动仍显示同一图，证明移动路径不依赖文件重新读取。
    file.delete()
    repeat(100) { view.render(snapshot.copy(draft = it.toString())) }
    assertSame(drawable, image.drawable)
    view.render(snapshot.copy(bubbleDockSide = RavenCatBubbleDockSide.LEFT))
    assertSame(drawable, image.drawable)
    assertEquals(-1f, image.scaleX)
    view.render(snapshot.copy(bubbleDockSide = RavenCatBubbleDockSide.RIGHT))
    assertSame(drawable, image.drawable)
    assertEquals(1f, image.scaleX)
    view.render(snapshot)
    assertEquals(1f, image.scaleX)
  }

  @Test
  fun `two image forms switch without rereading and size change resamples`() {
    val normal = png()
    val edge = png()
    val skin = BubbleSkin("user-test", "双图", BubbleSkinSource.USER, "image/png", normal.path, dockedFilePath = edge.path, dockedMimeType = "image/png")
    val snapshot = snapshot(skin)
    val view = RavenCatBubbleView(context) {}
    val image = view.getChildAt(0) as ImageView
    view.render(snapshot)
    await { image.drawable != null }
    val frontDrawable = image.drawable
    view.render(snapshot.copy(bubbleDockSide = RavenCatBubbleDockSide.RIGHT))
    val edgeDrawable = image.drawable
    assertNotSame(frontDrawable, edgeDrawable)
    view.render(snapshot.copy(bubbleDockSide = RavenCatBubbleDockSide.LEFT))
    assertSame(edgeDrawable, image.drawable)
    assertEquals(-1f, image.scaleX)
    view.render(snapshot.copy(bubbleSizeDp = 96))
    await { image.drawable != null && image.drawable !== frontDrawable }
    val bitmap = (image.drawable as BitmapDrawable).bitmap
    val target = (96 * context.resources.displayMetrics.density).toInt()
    assertTrue(bitmap.width in target until target * 2)
    normal.delete()
    edge.delete()
  }

  private fun snapshot(skin: BubbleSkin) = RavenCatOverlaySnapshot(
    bubbleSkin = skin,
    bubbleFallbackSkin = BubbleSkinStore(context).list().first { it.source == BubbleSkinSource.BUILTIN },
  )

  private fun png(): File = File(context.cacheDir, "${UUID.randomUUID()}.png").apply {
    outputStream().use { Bitmap.createBitmap(800, 800, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  private fun await(condition: () -> Boolean) {
    val deadline = System.nanoTime() + 5_000_000_000L
    while (!condition() && System.nanoTime() < deadline) {
      shadowOf(Looper.getMainLooper()).idle()
      Thread.sleep(5)
    }
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue("后台图片加载应在测试期限内完成", condition())
  }
}
