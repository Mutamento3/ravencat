/** 在辅助模型 metadata 中保存可编辑任务说明，同时保留供应商已有元数据。 */

const TASK_PROMPT_OVERRIDE_KEY = 'taskPromptOverride';

function parseMetadata(rawMetadata: string | null | undefined): Record<string, unknown> {
  if (!rawMetadata) return {};
  try {
    const parsed = JSON.parse(rawMetadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function readAuxiliaryTaskPromptOverride(
  rawMetadata: string | null | undefined
): string | null {
  const value = parseMetadata(rawMetadata)[TASK_PROMPT_OVERRIDE_KEY];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function writeAuxiliaryTaskPromptOverride(params: {
  rawMetadata: string | null | undefined;
  promptOverride: string | null;
}): string | null {
  const metadata = parseMetadata(params.rawMetadata);
  const normalized = params.promptOverride?.trim() || '';
  if (normalized) metadata[TASK_PROMPT_OVERRIDE_KEY] = normalized;
  else delete metadata[TASK_PROMPT_OVERRIDE_KEY];
  return Object.keys(metadata).length ? JSON.stringify(metadata) : null;
}
