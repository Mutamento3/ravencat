package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Outline
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import expo.modules.ravencatfloatinglayer.model.RavenCatTogetherListeningPresentation
import java.io.File
import java.io.FileOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.shadows.ShadowBitmapFactory

@RunWith(RobolectricTestRunner::class)
class RavenCatTogetherListeningPanelContentViewTest {
  @Suppress("DEPRECATION")
  private val context: Context = RuntimeEnvironment.getApplication()
  private lateinit var contentView: RavenCatTogetherListeningPanelContentView

  @Before
  fun setUp() {
    ShadowBitmapFactory.setAllowInvalidImageData(false)
    contentView = RavenCatTogetherListeningPanelContentView(context)
  }

  @Test
  fun `valid custom avatar and missing user avatar both show images`() {
    val file = writePng("ai.png", width = 400, height = 400)

    contentView.render(presentation(aiAvatar = Uri.fromFile(file).toString(), userAvatar = null))

    val (aiImage, aiFallback) = avatarViews(AI_AVATAR_INDEX)
    assertEquals(View.VISIBLE, aiImage.visibility)
    assertEquals(View.GONE, aiFallback.visibility)

    val (userImage, userFallback) = avatarViews(USER_AVATAR_INDEX)
    assertEquals(View.VISIBLE, userImage.visibility)
    assertEquals(View.GONE, userFallback.visibility)
    assertTrue(userImage.drawable is BitmapDrawable)
  }

  @Test
  fun `undecodable avatar uri falls back to default ai avatar`() {
    val missing = File(context.cacheDir, "missing.png")

    contentView.render(presentation(aiAvatar = Uri.fromFile(missing).toString()))

    val (aiImage, aiFallback) = avatarViews(AI_AVATAR_INDEX)
    assertEquals(View.VISIBLE, aiImage.visibility)
    assertEquals(View.GONE, aiFallback.visibility)
    assertTrue(aiImage.drawable is BitmapDrawable)
  }

  @Test
  fun `avatar slots are clipped to a circle`() {
    listOf(AI_AVATAR_INDEX, USER_AVATAR_INDEX).forEach { index ->
      val wrapper = contentView.getChildAt(index) as FrameLayout
      assertTrue(wrapper.clipToOutline)

      // 无背景的 wrapper 用默认 BACKGROUND provider 只能得到空 outline；
      // 布局出尺寸后 outline 非空且可裁剪，说明圆形裁剪真实生效。
      wrapper.layout(0, 0, 100, 100)
      val outline = Outline()
      wrapper.outlineProvider.getOutline(wrapper, outline)
      assertFalse(outline.isEmpty)
      assertTrue(outline.canClip())
    }
  }

  @Test
  fun `same uri does not reload while a changed uri decodes again`() {
    val first = writePng("first.png", width = 400, height = 400)
    val second = writePng("second.png", width = 200, height = 200)
    val (aiImage, aiFallback) = avatarViews(AI_AVATAR_INDEX)

    contentView.render(presentation(aiAvatar = Uri.fromFile(first).toString()))
    val firstDrawable = aiImage.drawable

    // 同一 URI 重复 render 不得重新解码、不得替换 drawable。
    contentView.render(presentation(aiAvatar = Uri.fromFile(first).toString()))
    assertSame(firstDrawable, aiImage.drawable)

    // URI 变化后重新解码并替换 bitmap。
    contentView.render(presentation(aiAvatar = Uri.fromFile(second).toString()))
    val reloaded = aiImage.drawable as BitmapDrawable
    assertNotSame(firstDrawable, reloaded)
    assertNotSame((firstDrawable as BitmapDrawable).bitmap, reloaded.bitmap)

    // URI 清空后退回产品默认头像。
    contentView.render(presentation(aiAvatar = null))
    assertEquals(View.VISIBLE, aiImage.visibility)
    assertEquals(View.GONE, aiFallback.visibility)
    assertNotSame(reloaded, aiImage.drawable)
  }

  private fun avatarViews(index: Int): Pair<ImageView, TextView> {
    val wrapper = contentView.getChildAt(index) as FrameLayout
    return (wrapper.getChildAt(0) as ImageView) to (wrapper.getChildAt(1) as TextView)
  }

  private fun presentation(
    aiAvatar: String?,
    userAvatar: String? = null,
  ) = RavenCatTogetherListeningPresentation(
    activityId = "activity-1",
    hostAiId = "host-1",
    chatSessionId = "session-1",
    activatedAtEpochMs = 1_000L,
    aiName = "Kimi",
    aiAvatar = aiAvatar,
    userName = "用户",
    userAvatar = userAvatar,
  )

  private fun writePng(name: String, width: Int, height: Int): File {
    val file = File(context.cacheDir, name)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    FileOutputStream(file).use { output ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
    }
    return file
  }

  private companion object {
    // 布局顺序：AI 头像槽、时长、用户头像槽。
    const val AI_AVATAR_INDEX = 0
    const val USER_AVATAR_INDEX = 2
  }
}
