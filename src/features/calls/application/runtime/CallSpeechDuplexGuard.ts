/** 在 AI 播放语音时隔离麦克风回灌，并在播放结束后等待短暂回声消退。 */

const DEFAULT_ECHO_COOLDOWN_MS = 800;

export class CallSpeechDuplexGuard {
  private readonly echoCooldownMs: number;
  private activeAIOutputCount = 0;
  private cooldownUntil = 0;
  private ignoredSegmentIndexes = new Set<number>();
  private silenceChunk: ArrayBuffer | null = null;
  private echoCancellationEnabled = false;
  private speechActivityDuringAIOutput = false;

  constructor(echoCooldownMs = DEFAULT_ECHO_COOLDOWN_MS) {
    this.echoCooldownMs = echoCooldownMs;
  }

  beginAIOutput(): void {
    if (this.activeAIOutputCount === 0) {
      this.speechActivityDuringAIOutput = false;
    }
    this.activeAIOutputCount += 1;
    this.cooldownUntil = 0;
  }

  setEchoCancellationEnabled(enabled: boolean): void {
    this.echoCancellationEnabled = enabled;
    this.speechActivityDuringAIOutput = false;
    if (enabled) {
      this.ignoredSegmentIndexes.clear();
    }
  }

  observeSpeechActivityDuringAIOutput(): void {
    if (!this.echoCancellationEnabled || this.activeAIOutputCount === 0) {
      return;
    }

    this.speechActivityDuringAIOutput = true;
    this.ignoredSegmentIndexes.clear();
  }

  endAIOutput(now = Date.now()): void {
    this.activeAIOutputCount = Math.max(0, this.activeAIOutputCount - 1);
    if (this.activeAIOutputCount === 0) {
      this.cooldownUntil = now + this.echoCooldownMs;
      this.speechActivityDuringAIOutput = false;
    }
  }

  reset(): void {
    this.activeAIOutputCount = 0;
    this.cooldownUntil = 0;
    this.ignoredSegmentIndexes.clear();
    this.silenceChunk = null;
    this.echoCancellationEnabled = false;
    this.speechActivityDuringAIOutput = false;
  }

  isMicrophoneSuppressed(now = Date.now()): boolean {
    return !this.echoCancellationEnabled &&
      (this.activeAIOutputCount > 0 || now < this.cooldownUntil);
  }

  audioChunkForASR(chunk: ArrayBuffer, now = Date.now()): ArrayBuffer {
    if (!this.isMicrophoneSuppressed(now)) {
      return chunk;
    }
    if (!this.silenceChunk || this.silenceChunk.byteLength !== chunk.byteLength) {
      this.silenceChunk = new ArrayBuffer(chunk.byteLength);
    }
    return this.silenceChunk;
  }

  shouldIgnoreTranscriptSegment(
    segmentIndex: number,
    final: boolean,
    now = Date.now()
  ): boolean {
    const ignoredEarlier = this.ignoredSegmentIndexes.has(segmentIndex);
    const awaitingSpeechActivity =
      this.echoCancellationEnabled &&
      this.activeAIOutputCount > 0 &&
      !this.speechActivityDuringAIOutput;
    const shouldIgnore =
      ignoredEarlier ||
      this.isMicrophoneSuppressed(now) ||
      awaitingSpeechActivity;
    if (!shouldIgnore) {
      return false;
    }

    if (final) {
      this.ignoredSegmentIndexes.delete(segmentIndex);
    } else {
      this.ignoredSegmentIndexes.add(segmentIndex);
    }
    return true;
  }
}
