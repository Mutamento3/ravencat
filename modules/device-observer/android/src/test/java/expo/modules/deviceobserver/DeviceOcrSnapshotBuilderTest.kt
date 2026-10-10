package expo.modules.deviceobserver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceOcrSnapshotBuilderTest {
  @Test
  fun `normalizes line endings and trims without collapsing inner whitespace`() {
    val snapshot = DeviceOcrSnapshotBuilder.build(
      listOf(
        RawOcrBlock(lines = listOf("  第一行\r\n", "   ", "hello    world  ")),
      ),
    )

    assertEquals(1, snapshot.blocks.size)
    val block = snapshot.blocks.single()
    assertEquals(listOf("第一行", "hello    world"), block.lines.map { it.text })
    assertFalse(snapshot.truncation.characterLimitReached)
  }

  @Test
  fun `empty recognition stays successful`() {
    val snapshot = DeviceOcrSnapshotBuilder.build(emptyList())

    assertTrue(snapshot.blocks.isEmpty())
    assertFalse(snapshot.truncation.blockLimitReached)
    assertFalse(snapshot.truncation.lineLimitReached)
    assertFalse(snapshot.truncation.characterLimitReached)
  }

  @Test
  fun `caps blocks before the bridge payload grows without bound`() {
    val snapshot = DeviceOcrSnapshotBuilder.build(
      List(2_048) { index -> RawOcrBlock(lines = listOf("block-$index")) },
    )

    assertEquals(1_024, snapshot.blocks.size)
    assertTrue(snapshot.truncation.blockLimitReached)
    assertFalse(snapshot.truncation.lineLimitReached)
  }

  @Test
  fun `caps lines inside a single block`() {
    val snapshot = DeviceOcrSnapshotBuilder.build(
      listOf(RawOcrBlock(lines = List(5_000) { index -> "line-$index" })),
    )

    assertEquals(1, snapshot.blocks.size)
    assertEquals(4_096, snapshot.blocks.single().lines.size)
    assertTrue(snapshot.truncation.lineLimitReached)
  }

  @Test
  fun `caps total characters and reports truncation`() {
    val snapshot = DeviceOcrSnapshotBuilder.build(
      listOf(RawOcrBlock(lines = List(50) { "x".repeat(9_000) })),
    )

    assertTrue(snapshot.truncation.characterLimitReached)
    assertTrue(snapshot.blocks.single().lines.all { it.text.length <= 8_000 })
    assertTrue(
      snapshot.blocks.single().lines.sumOf { it.text.length } <= 262_144,
    )
  }

  @Test
  fun `bridge payload keeps only line text`() {
    val snapshot = DeviceOcrSnapshotBuilder.build(
      listOf(RawOcrBlock(lines = listOf("第一行"))),
    )

    assertEquals(
      mapOf("lines" to listOf(mapOf("text" to "第一行"))),
      snapshot.blocks.single().toMap(),
    )
  }
}
