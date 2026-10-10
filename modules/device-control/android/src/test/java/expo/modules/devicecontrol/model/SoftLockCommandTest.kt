package expo.modules.devicecontrol.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SoftLockCommandTest {
  @Test
  fun `parses single valid projection`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(
        mapOf(
          "id" to "lock-1",
          "targetPackage" to "com.example.target",
          "expiresAtEpochMs" to 2000L,
        ),
      ),
    )

    val parsed = result as SoftLockCommandParseResult.Parsed
    assertEquals(
      listOf(SoftLockProjection("lock-1", "com.example.target", 2000L)),
      parsed.command.activeLocks,
    )
  }

  @Test
  fun `parses multiple projections in order`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(
        mapOf("id" to "lock-1", "targetPackage" to "com.example.first"),
        mapOf("id" to "lock-2", "targetPackage" to "com.example.second"),
      ),
    )

    val parsed = result as SoftLockCommandParseResult.Parsed
    assertEquals(2, parsed.command.activeLocks.size)
    assertEquals("com.example.first", parsed.command.activeLocks[0].targetPackage)
    assertEquals("com.example.second", parsed.command.activeLocks[1].targetPackage)
  }

  @Test
  fun `empty payload parses into empty command`() {
    val result = SoftLockCommand.fromBridgePayload(emptyList())

    val parsed = result as SoftLockCommandParseResult.Parsed
    assertTrue(parsed.command.activeLocks.isEmpty())
  }

  @Test
  fun `expiresAtEpochMs is optional`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(mapOf("id" to "lock-1", "targetPackage" to "com.example.target")),
    )

    val parsed = result as SoftLockCommandParseResult.Parsed
    assertNull(parsed.command.activeLocks.single().expiresAtEpochMs)
  }

  @Test
  fun `double expiresAtEpochMs is accepted as long`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(
        mapOf(
          "id" to "lock-1",
          "targetPackage" to "com.example.target",
          "expiresAtEpochMs" to 2000.0,
        ),
      ),
    )

    val parsed = result as SoftLockCommandParseResult.Parsed
    assertEquals(2000L, parsed.command.activeLocks.single().expiresAtEpochMs)
  }

  @Test
  fun `integer expiresAtEpochMs is accepted as long`() {
    val parsed = parseExpiry(2000) as SoftLockCommandParseResult.Parsed

    assertEquals(2000L, parsed.command.activeLocks.single().expiresAtEpochMs)
  }

  @Test
  fun `max safe integer expiry is accepted`() {
    val parsed = parseExpiry(9_007_199_254_740_991L) as SoftLockCommandParseResult.Parsed

    assertEquals(9_007_199_254_740_991L, parsed.command.activeLocks.single().expiresAtEpochMs)
  }

  @Test
  fun `fractional expiresAtEpochMs is rejected without truncation`() {
    assertTrue(parseExpiry(2000.5) is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `NaN expiresAtEpochMs is rejected`() {
    assertTrue(parseExpiry(Double.NaN) is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `positive infinity expiresAtEpochMs is rejected`() {
    assertTrue(parseExpiry(Double.POSITIVE_INFINITY) is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `negative infinity expiresAtEpochMs is rejected`() {
    assertTrue(parseExpiry(Double.NEGATIVE_INFINITY) is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `expiresAtEpochMs beyond JS safe integer is rejected`() {
    assertTrue(parseExpiry(9_007_199_254_740_992L) is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `expiresAtEpochMs beyond Long range is rejected`() {
    assertTrue(parseExpiry(Double.MAX_VALUE) is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `non map element is invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(listOf("not-a-map"))

    val invalid = result as SoftLockCommandParseResult.Invalid
    assertEquals(SoftLockReconcileStatus.INVALID_PROJECTION, statusOfInvalid(invalid))
    assertNotNull(invalid.reason)
  }

  @Test
  fun `missing id is invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(mapOf("targetPackage" to "com.example.target")),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `blank id is invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(mapOf("id" to "  ", "targetPackage" to "com.example.target")),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `missing targetPackage is invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(listOf(mapOf("id" to "lock-1")))

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `blank targetPackage is invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(mapOf("id" to "lock-1", "targetPackage" to "")),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `targetPackage with leading whitespace is rejected without trimming`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(mapOf("id" to "lock-1", "targetPackage" to " com.example.target")),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `targetPackage with trailing whitespace is rejected without trimming`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(mapOf("id" to "lock-1", "targetPackage" to "com.example.target ")),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `targetPackage with internal whitespace is rejected`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(mapOf("id" to "lock-1", "targetPackage" to "com.example target")),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `duplicate ids are invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(
        mapOf("id" to "lock-1", "targetPackage" to "com.example.first"),
        mapOf("id" to "lock-1", "targetPackage" to "com.example.second"),
      ),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `non numeric expiresAtEpochMs is invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(
        mapOf(
          "id" to "lock-1",
          "targetPackage" to "com.example.target",
          "expiresAtEpochMs" to "soon",
        ),
      ),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `non positive expiresAtEpochMs is invalid projection`() {
    val result = SoftLockCommand.fromBridgePayload(
      listOf(
        mapOf(
          "id" to "lock-1",
          "targetPackage" to "com.example.target",
          "expiresAtEpochMs" to 0L,
        ),
      ),
    )

    assertTrue(result is SoftLockCommandParseResult.Invalid)
  }

  @Test
  fun `reconcile result maps carry typed status`() {
    assertEquals(
      mapOf("status" to "ok", "appliedCount" to 2, "reason" to null),
      SoftLockReconcileResult.ok(2).toMap(),
    )
    assertEquals(
      mapOf("status" to "runtime_unavailable", "appliedCount" to 0, "reason" to "r"),
      SoftLockReconcileResult.runtimeUnavailable("r").toMap(),
    )
    assertEquals(
      mapOf("status" to "invalid_projection", "appliedCount" to 0, "reason" to "r"),
      SoftLockReconcileResult.invalidProjection("r").toMap(),
    )
    assertEquals(
      mapOf("status" to "failed", "appliedCount" to 0, "reason" to "r"),
      SoftLockReconcileResult.failed("r").toMap(),
    )
  }

  private fun statusOfInvalid(invalid: SoftLockCommandParseResult.Invalid): SoftLockReconcileStatus {
    return SoftLockReconcileResult.invalidProjection(invalid.reason).status
  }

  private fun parseExpiry(value: Number): SoftLockCommandParseResult {
    return SoftLockCommand.fromBridgePayload(
      listOf(
        mapOf(
          "id" to "lock-1",
          "targetPackage" to "com.example.target",
          "expiresAtEpochMs" to value,
        ),
      ),
    )
  }
}
