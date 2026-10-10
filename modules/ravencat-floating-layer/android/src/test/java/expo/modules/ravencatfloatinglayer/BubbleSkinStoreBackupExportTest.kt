package expo.modules.ravencatfloatinglayer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowBitmapFactory

/**
 * Bubble Skin 备份导出契约。
 *
 * strict export 不允许跳过损坏项、不允许把无效 selectedId 降级成默认装扮；日常 `list()` /
 * `selectedId()` 的 UI 容错语义必须保持不变。
 */
// Robolectric 4.14 最高支持 SDK 35，工程 targetSdk=36，需显式钉住 SDK。
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@RunWith(RobolectricTestRunner::class)
class BubbleSkinStoreBackupExportTest {

  private lateinit var context: Context
  private lateinit var skinDirectory: File

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
    skinDirectory = File(context.filesDir, SKIN_DIRECTORY).apply { mkdirs() }
    preferences().edit().clear().commit()
    ShadowBitmapFactory.setAllowInvalidImageData(false)
  }

  // 这里复用 owner 私有的偏好文件名与 key：测试直接构造"已持久化的原生真相"，
  // 不通过 import() 走 picker，以免把测试耦合到 contentResolver。
  private fun preferences() =
    context.getSharedPreferences("ravencat_bubble_skins", Context.MODE_PRIVATE)

  private fun writeRawSkins(json: String) {
    check(preferences().edit().putString("custom_skins", json).commit())
  }

  private fun writeSkins(vararg entries: Pair<String, String>) {
    val array = JSONArray()
    entries.forEach { (id, filePath) ->
      array.put(JSONObject().apply {
        put("id", id)
        put("name", "装扮")
        put("mimeType", "image/svg+xml")
        put("filePath", filePath)
      })
    }
    writeRawSkins(array.toString())
  }

  private fun writeSkinFile(id: String, body: String = VALID_SVG): File =
    File(skinDirectory, "$id.svg").apply { writeText(body) }

  private fun store() = BubbleSkinStore(context)

  private fun expectStrictExportRejected(store: BubbleSkinStore) {
    try {
      store.exportBackupStrict()
      fail("strict export 必须拒绝非法 persisted metadata")
    } catch (_: Exception) {
      // strict export 以异常报告非法数据，不静默跳过。
    }
  }

  @Test
  fun `exports every persisted skin and keeps selected id`() {
    val first = writeSkinFile("user-alpha")
    val second = writeSkinFile("user-beta")
    writeSkins("user-alpha" to first.path, "user-beta" to second.path)
    check(preferences().edit().putString("selected_id", "user-beta").commit())

    val exported = JSONObject(store().exportBackupStrict())

    assertEquals(2, exported.getInt("schemaVersion"))
    assertEquals("user-beta", exported.getString("selectedId"))
    val items = exported.getJSONArray("items")
    assertEquals(2, items.length())
    assertEquals("user-alpha.svg", items.getJSONObject(0).getString("fileName"))
    assertEquals("user-beta.svg", items.getJSONObject(1).getString("fileName"))
  }

  @Test
  fun `missing backing file fails strict export while list stays tolerant`() {
    val present = writeSkinFile("user-present")
    writeSkins(
      "user-present" to present.path,
      "user-missing" to File(skinDirectory, "user-missing.svg").path,
    )

    val store = store()

    // 日常 UI 仍然跳过已丢失文件的条目，不阻断列表。
    assertEquals(2, store.list().size)
    expectStrictExportRejected(store)
  }

  @Test
  fun `persisted path outside the skin directory fails strict export`() {
    val outside = File(outsideSkinsDirectory(), "user-outside.svg").apply { writeText(VALID_SVG) }
    writeSkins("user-outside" to outside.path)

    val store = store()

    // 容错读取看不出任何差异：文件名和内容都合法，只是不在 owner root 内。
    assertEquals(2, store.list().size)
    expectStrictExportRejected(store)
  }

  @Test
  fun `valid same name file outside the owner root is still rejected`() {
    val inRoot = writeSkinFile("user-outside")
    val outside = File(outsideSkinsDirectory(), inRoot.name).apply { writeText(VALID_SVG) }
    writeSkins("user-outside" to outside.path)

    // owner root 内即使存在同名合法文件，persisted metadata 指向 root 之外也必须拒绝：
    // 打包只遍历 owner root，接受它会让产物与 settings JSON 不一致，直到 restore preflight 才暴露。
    expectStrictExportRejected(store())
  }

  private fun outsideSkinsDirectory(): File =
    File(context.cacheDir, "outside-skins").apply { mkdirs() }

  @Test
  fun `malformed persisted metadata fails strict export`() {
    writeRawSkins("[{")

    expectStrictExportRejected(store())
  }

  @Test
  fun `mime and extension mismatch fails strict export while list stays tolerant`() {
    val file = writeSkinFile("user-mismatch")
    writeRawSkins(JSONArray().put(JSONObject().apply {
      put("id", "user-mismatch")
      put("name", "装扮")
      put("mimeType", "image/png")
      put("filePath", file.path)
    }).toString())

    val store = store()

    // 容错读取不校验 MIME 与扩展名的一致性。
    assertEquals(2, store.list().size)
    expectStrictExportRejected(store)
  }

  @Test
  fun `invalid svg payload fails strict export`() {
    val file = writeSkinFile("user-broken", "<html></html>")
    writeSkins("user-broken" to file.path)

    expectStrictExportRejected(store())
  }

  @Test
  fun `duplicated skin id fails strict export`() {
    val file = writeSkinFile("user-dup")
    writeSkins("user-dup" to file.path, "user-dup" to file.path)

    expectStrictExportRejected(store())
  }

  @Test
  fun `selected id outside persisted skins fails strict export and is not degraded`() {
    val file = writeSkinFile("user-only")
    writeSkins("user-only" to file.path)
    check(preferences().edit().putString("selected_id", "user-gone").commit())

    val store = store()

    // 日常 selectedId 仍然回退到内置默认装扮。
    assertEquals(BubbleSkinStore.DEFAULT_SKIN_ID, store.selectedId())
    expectStrictExportRejected(store)
  }

  @Test
  fun `single image skin renders both forms and bitmap is sampled for the window`() {
    val store = store()
    val imported = importSvg(store)
    val png = File(context.cacheDir, "front.png").apply {
      outputStream().use { Bitmap.createBitmap(800, 800, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    val skin = imported.copy(mimeType = "image/png", filePath = png.path)
    assertFalse(skin.hasDockedAsset)
    val normal = store.drawableFor(skin, false, 56) as BitmapDrawable
    val docked = store.drawableFor(skin, true, 56) as BitmapDrawable
    assertTrue(normal.bitmap.width in 56 until 112)
    assertEquals(normal.bitmap.width, docked.bitmap.width)
    assertEquals(imported.filePath, store.selected().filePath)
  }

  @Test
  fun `two forms and size survive export validation and restore`() {
    val store = store()
    val skin = importSvg(store)
    val docked = File(context.cacheDir, "edge.svg").apply { writeText(VALID_SVG) }
    val updated = store.updateImage(skin.id, "docked", Uri.fromFile(docked).toString(), docked.name, "image/svg+xml")
    store.setSizeDp(skin.id, 80)
    val encoded = store.exportBackupStrict()
    val item = JSONObject(encoded).getJSONArray("items").getJSONObject(0)
    assertEquals(File(requireNotNull(updated.dockedFilePath)).name, item.getString("dockedFileName"))
    store.validateBackup(encoded, store.backupRootUri())
    preferences().edit().clear().commit()
    store.restoreBackup(encoded)
    assertEquals(80, store.selected().sizeDp)
    assertEquals(updated.copy(sizeDp = 80), store.selected())
    assertTrue(store.selected().hasDockedAsset)
    store.delete(skin.id)
    assertFalse(File(requireNotNull(updated.filePath)).exists())
    assertFalse(File(requireNotNull(updated.dockedFilePath)).exists())
    assertEquals(BubbleSkinStore.DEFAULT_SKIN_ID, store.selectedId())
  }

  @Test
  fun `replacing front image changes file identity preserves edge and removes old file`() {
    val store = store()
    val original = importSvg(store)
    val edge = File(context.cacheDir, "edge.svg").apply { writeText(VALID_SVG) }
    val withEdge = store.updateImage(original.id, "docked", Uri.fromFile(edge).toString(), edge.name, "image/svg+xml")
    val updated = store.updateImage(original.id, "normal", Uri.fromFile(edge).toString(), edge.name, "image/svg+xml")
    assertNotEquals(original.filePath, updated.filePath)
    assertEquals(withEdge.dockedFilePath, updated.dockedFilePath)
    assertFalse(File(requireNotNull(original.filePath)).exists())
    store.validateBackup(store.exportBackupStrict(), store.backupRootUri())
  }

  @Test
  fun `failed image replacement leaves previous skin intact`() {
    val store = store()
    val original = importSvg(store)
    val invalid = File(context.cacheDir, "invalid.png").apply { writeText("broken image") }
    org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
      store.updateImage(original.id, "normal", Uri.fromFile(invalid).toString(), invalid.name, "image/png")
    }
    assertEquals(original, store.selected())
    assertTrue(File(requireNotNull(original.filePath)).isFile)
  }

  @Test
  fun `missing or escaping edge file fails strict backup`() {
    val store = store()
    val skin = importSvg(store)
    val edge = File(context.cacheDir, "edge.svg").apply { writeText(VALID_SVG) }
    val updated = store.updateImage(skin.id, "docked", Uri.fromFile(edge).toString(), edge.name, "image/svg+xml")
    File(requireNotNull(updated.dockedFilePath)).delete()
    expectStrictExportRejected(store)
    val metadata = JSONArray(preferences().getString("custom_skins", "[]"))
    metadata.getJSONObject(0).put("dockedFilePath", File(outsideSkinsDirectory(), "${skin.id}-docked.svg").apply { writeText(VALID_SVG) }.path)
    writeRawSkins(metadata.toString())
    expectStrictExportRejected(store)
  }

  @Test
  fun `old builtin selections migrate and old single image backup keeps default size`() {
    listOf("builtin-blue-ball", "builtin-orange-crab").forEach { oldId ->
      preferences().edit().putString("selected_id", oldId).commit()
      assertEquals(BubbleSkinStore.DEFAULT_SKIN_ID, store().selectedId())
      val oldBackup = JSONObject().put("schemaVersion", 1).put("selectedId", oldId).put("items", JSONArray()).toString()
      store().restoreBackup(oldBackup)
      assertEquals(BubbleSkinStore.DEFAULT_SIZE_DP, store().selected().sizeDp)
    }
    assertEquals(1, store().list().count { it.source == BubbleSkinSource.BUILTIN })
    val store = store()
    val singleImage = importSvg(store)
    val oldBackup = JSONObject().put("schemaVersion", 1).put("selectedId", singleImage.id)
      .put("items", JSONObject(store.exportBackupStrict()).getJSONArray("items")).toString()
    store.setSizeDp(BubbleSkinStore.DEFAULT_SKIN_ID, 96)
    store.restoreBackup(oldBackup)
    assertEquals(singleImage, store.selected())
    assertEquals(56, store.selected().sizeDp)
  }

  @Test
  fun `size bounds persist and factory reset restores default`() {
    val store = store()
    assertEquals(56, store.selected().sizeDp)
    store.setSizeDp(BubbleSkinStore.DEFAULT_SKIN_ID, 32)
    assertEquals(32, store().selected().sizeDp)
    store.setSizeDp(BubbleSkinStore.DEFAULT_SKIN_ID, 96)
    assertEquals(96, store().selected().sizeDp)
    listOf(31, 97).forEach { size ->
      org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { store.setSizeDp(BubbleSkinStore.DEFAULT_SKIN_ID, size) }
    }
    val invalidBackup = JSONObject(store.exportBackupStrict()).apply {
      getJSONObject("skinSizes").put(BubbleSkinStore.DEFAULT_SKIN_ID, 200)
    }.toString()
    org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { store.validateBackup(invalidBackup, store.backupRootUri()) }
    store.clearAllForFactoryReset()
    assertEquals(56, store.selected().sizeDp)
  }

  @Test
  fun `each skin keeps independent size across selection edits and backup restore`() {
    val store = store()
    val first = importSvg(store)
    val second = importSvg(store)
    store.setSizeDp(first.id, 43)
    store.setSizeDp(second.id, 87)
    store.setSizeDp(BubbleSkinStore.DEFAULT_SKIN_ID, 64)
    assertEquals(43, store.select(first.id).sizeDp)
    assertEquals(87, store.select(second.id).sizeDp)
    assertEquals(64, store.select(BubbleSkinStore.DEFAULT_SKIN_ID).sizeDp)
    assertEquals(43, store().select(first.id).sizeDp)
    assertEquals(43, store.rename(first.id, "独立大小").sizeDp)
    val replacement = File(context.cacheDir, "replacement.svg").apply { writeText(VALID_SVG) }
    assertEquals(43, store.updateImage(first.id, "normal", Uri.fromFile(replacement).toString(), replacement.name, "image/svg+xml").sizeDp)
    val encoded = store.exportBackupStrict()
    preferences().edit().clear().commit()
    store.restoreBackup(encoded)
    assertEquals(43, store.selected().sizeDp)
    assertEquals(87, store.select(second.id).sizeDp)
    assertEquals(64, store.select(BubbleSkinStore.DEFAULT_SKIN_ID).sizeDp)
    store.delete(first.id)
    assertFalse(JSONObject(store.exportBackupStrict()).getJSONObject("skinSizes").has(first.id))
  }

  @Test
  fun `old global size migrates once and newly imported skins start with default`() {
    val first = importSvg(store())
    preferences().edit().putInt("size_dp", 72).commit()
    val migrated = store()
    assertEquals(72, migrated.select(first.id).sizeDp)
    assertEquals(72, migrated.select(BubbleSkinStore.DEFAULT_SKIN_ID).sizeDp)
    assertFalse(preferences().contains("size_dp"))
    val second = importSvg(migrated)
    assertEquals(56, second.sizeDp)
    migrated.setSizeDp(first.id, 39)
    assertEquals(72, migrated.select(BubbleSkinStore.DEFAULT_SKIN_ID).sizeDp)
    val oldBackup = JSONObject().put("schemaVersion", 1).put("selectedId", second.id).put("sizeDp", 80)
      .put("items", JSONObject(migrated.exportBackupStrict()).getJSONArray("items")).toString()
    migrated.restoreBackup(oldBackup)
    assertEquals(80, migrated.select(first.id).sizeDp)
    assertEquals(80, migrated.select(second.id).sizeDp)
    assertEquals(80, migrated.select(BubbleSkinStore.DEFAULT_SKIN_ID).sizeDp)
  }

  @Test
  fun `builtin is one png image and backup rejects unknown skin size`() {
    val store = store()
    val builtin = store.list().single()
    assertEquals("image/png", builtin.mimeType)
    assertFalse(builtin.hasDockedAsset)
    val image = store.drawableFor(builtin, true, 96) as BitmapDrawable
    assertTrue(image.bitmap.width in 96 until 192)
    val invalid = JSONObject(store.exportBackupStrict()).apply { getJSONObject("skinSizes").put("user-gone", 64) }.toString()
    org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { store.validateBackup(invalid, store.backupRootUri()) }
  }

  private fun importSvg(store: BubbleSkinStore): BubbleSkin {
    // Windows 模拟环境中的临时 PNG 在 native 解码后无法 rename；
    // 文件导入/替换行为使用 SVG，PNG 的真实解码和尺寸采样由上面的独立场景验证。
    val file = File(context.cacheDir, "front.svg").apply { writeText(VALID_SVG) }
    return store.import(Uri.fromFile(file).toString(), file.name, "image/svg+xml", "我的形象")
  }

  private companion object {
    const val SKIN_DIRECTORY = "ravencat/bubble-skins"
    const val VALID_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>"
  }
}
