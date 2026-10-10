/** Chat 消息中的 Sticker 发送时快照；不拥有 Sticker 媒体或收藏库生命周期。 */

/**
 * Sticker 被发送时复制到消息中的稳定语义。
 *
 * 消息只保存 MediaAsset 身份和当时的描述快照，因此收藏项后来被重命名、
 * 移动或删除时，历史消息仍能按发送时语义显示；媒体字节的解析仍由 Media
 * Feature 负责。
 */
export interface StickerMessageSnapshot {
  /** Sticker 收藏项身份；消息不依赖它作为外键，只保留发送时的标识。 */
  stickerId: string;
  mediaAssetId: string;
  name: string;
  description: string | null;
  tags: string[];
  emotion: string | null;
  /** 导入时来源文件名的快照，便于历史语义审计。 */
  sourceFileName?: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  isAnimated: boolean;
}

export interface StickerMessageMetadata {
  kind: 'sticker';
  sticker: StickerMessageSnapshot;
}

export function buildStickerMessageMetadata(
  sticker: StickerMessageSnapshot,
): StickerMessageMetadata {
  return {
    kind: 'sticker',
    sticker: {
      ...sticker,
      tags: [...sticker.tags],
    },
  };
}

export function isStickerMessageMetadata(
  value: unknown,
): value is StickerMessageMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const metadata = value as Partial<StickerMessageMetadata>;
  if (
    metadata.kind !== 'sticker'
    || !metadata.sticker
    || typeof metadata.sticker !== 'object'
    || Array.isArray(metadata.sticker)
  ) {
    return false;
  }

  const sticker = metadata.sticker as Partial<StickerMessageSnapshot>;
  const isNullableString = (input: unknown): input is string | null => (
    input === null || typeof input === 'string'
  );
  const isNullableDimension = (input: unknown): input is number | null => (
    input === null
    || (typeof input === 'number' && Number.isFinite(input) && input > 0)
  );

  return typeof sticker.stickerId === 'string'
    && sticker.stickerId.trim().length > 0
    && typeof sticker.mediaAssetId === 'string'
    && sticker.mediaAssetId.trim().length > 0
    && typeof sticker.name === 'string'
    && sticker.name.trim().length > 0
    && isNullableString(sticker.description)
    && Array.isArray(sticker.tags)
    && sticker.tags.every((tag) => typeof tag === 'string')
    && isNullableString(sticker.emotion)
    && (sticker.sourceFileName === undefined || isNullableString(sticker.sourceFileName))
    && typeof sticker.mimeType === 'string'
    && sticker.mimeType.trim().length > 0
    && isNullableDimension(sticker.width)
    && isNullableDimension(sticker.height)
    && typeof sticker.isAnimated === 'boolean';
}

/** 将 Sticker 快照压成结构化文字，供模型理解消息语义；不读取媒体内容。 */
export function buildStickerModelText(sticker: StickerMessageSnapshot): string {
  const lines = ['发送了一个表情包。', `名称：${sticker.name}`];
  if (sticker.description) {
    lines.push(`描述：${sticker.description}`);
  }
  if (sticker.tags.length > 0) {
    lines.push(`标签：${sticker.tags.join('、')}`);
  }
  if (sticker.emotion) {
    lines.push(`情绪：${sticker.emotion}`);
  }
  return lines.join('\n');
}
