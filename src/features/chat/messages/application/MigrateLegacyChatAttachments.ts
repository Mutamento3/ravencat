/** 将 Chat metadata_json 中的 legacy 附件 URI 原子迁移为 MediaAsset 引用。 */

import { CHAT_ATTACHMENT_MIME_BY_EXTENSION } from './ChatAttachmentMime';
import type { MediaAsset } from '@features/media';
import type { DatabaseTransactionExecutor } from '@platform/persistence';
import type {
  ChatAttachmentMediaAssetPort,
  LegacyChatAttachmentAdoptionInput,
} from './ChatMessageRuntime';
import type { ChatAttachmentType } from '../domain/ChatAttachment';
import type {
  ChatAttachmentMetadataCandidate,
  IMessageRepository,
} from '../domain/MessageRepository';

const DEFAULT_PAGE_SIZE = 25;
const SUPPORTED_TEXT_FILE_EXTENSIONS = new Set(['txt', 'md', 'json', 'csv']);

export type LegacyChatAttachmentMigrationIssueReason =
  | 'invalid_json'
  | 'invalid_metadata'
  | 'invalid_attachment'
  | 'remote_uri'
  | 'legacy_file_unavailable'
  | 'mime_unknown'
  | 'mime_conflict'
  | 'commit_failed';

export interface LegacyChatAttachmentMigrationIssue {
  messageId: number;
  sessionId: string;
  reason: LegacyChatAttachmentMigrationIssueReason;
  detail?: string;
}

export interface MigrateLegacyChatAttachmentsOptions {
  pageSize?: number;
  afterMessageId?: number | null;
  maxMessages?: number;
}

export interface MigrateLegacyChatAttachmentsResult {
  scannedMessages: number;
  migratedMessages: number;
  skippedMessages: number;
  unresolvedMessages: number;
  migratedAttachments: number;
  adoptedAssets: number;
  sessionIds: string[];
  issues: LegacyChatAttachmentMigrationIssue[];
}

export interface MigrateLegacyChatAttachmentsDependencies {
  messages: Pick<
    IMessageRepository,
    | 'listChatAttachmentMetadataCandidates'
    | 'compareAndSwapMetadataJsonInTransaction'
  >;
  mediaAssets: ChatAttachmentMediaAssetPort;
}

interface JsonObject {
  [key: string]: unknown;
}

interface LegacyReferencePlan {
  attachmentIndex: number;
  mainInputIndex: number;
  thumbnailInputIndex: number | null;
}

interface MigrationPlan {
  metadata: JsonObject;
  attachments: JsonObject[];
  legacyReferences: LegacyReferencePlan[];
  inputs: LegacyChatAttachmentAdoptionInput[];
}

interface MigrationPreparationFailure {
  reason: Exclude<
    LegacyChatAttachmentMigrationIssueReason,
    'commit_failed'
  >;
  detail?: string;
}

type MigrationPreparation = MigrationPlan | MigrationPreparationFailure;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeMimeType(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.includes('*') || !/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function getExtension(value: string | null | undefined): string {
  const candidate = String(value || '').split(/[?#]/u, 1)[0];
  const match = candidate.toLowerCase().match(/\.([a-z0-9]{1,8})$/u);
  return match?.[1] || '';
}

function deriveReliableMimeType(
  attachment: JsonObject,
  uri: string,
  fallbackMimeType?: string | null,
): string | null {
  const explicit = normalizeMimeType(attachment.mimeType);
  if (explicit) {
    return explicit;
  }

  const fallback = normalizeMimeType(fallbackMimeType);
  if (fallback) {
    return fallback;
  }

  const fileName = typeof attachment.fileName === 'string' ? attachment.fileName : null;
  const extension = getExtension(fileName) || getExtension(uri);
  return CHAT_ATTACHMENT_MIME_BY_EXTENSION[extension] || null;
}

function deriveMimeTypeFromUri(uri: string): string | null {
  return CHAT_ATTACHMENT_MIME_BY_EXTENSION[getExtension(uri)] || null;
}

function getAttachmentType(attachment: JsonObject): ChatAttachmentType | null {
  return attachment.type === 'image' || attachment.type === 'file'
    ? attachment.type
    : null;
}

function isRemoteUri(uri: string): boolean {
  return /^(?:https?|data|blob):/iu.test(uri.trim());
}

function positiveDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function parseMetadata(candidate: ChatAttachmentMetadataCandidate):
  | { metadata: JsonObject; attachments: JsonObject[] }
  | MigrationPreparationFailure {
  let parsed: unknown;
  try {
    // migration 必须直接 JSON.parse；解析失败的消息要记录 unresolved，不能借用
    // UI parser 的“返回空 metadata”语义把坏数据静默当成无附件。
    parsed = JSON.parse(candidate.metadataJson) as unknown;
  } catch {
    return { reason: 'invalid_json' };
  }

  if (!isJsonObject(parsed) || !Array.isArray(parsed.attachments)) {
    return { reason: 'invalid_metadata' };
  }

  const attachments: JsonObject[] = [];
  for (const attachment of parsed.attachments) {
    if (!isJsonObject(attachment)) {
      return { reason: 'invalid_attachment' };
    }
    attachments.push(attachment);
  }

  return { metadata: parsed, attachments };
}

function isMediaAssetAttachment(attachment: JsonObject): boolean {
  return typeof attachment.mediaAssetId === 'string'
    && attachment.mediaAssetId.trim().length > 0;
}

function validateAssetOnlyAttachment(attachment: JsonObject): MigrationPreparationFailure | null {
  if (!isMediaAssetAttachment(attachment)) {
    return { reason: 'invalid_attachment' };
  }

  // 成功迁移的形态不允许残留任一 URI，即使值是 null 也视为不完整迁移。
  if (hasOwn(attachment, 'localUri') || hasOwn(attachment, 'thumbnailUri')) {
    return { reason: 'invalid_attachment', detail: 'asset-only attachment still contains URI' };
  }

  if (
    hasOwn(attachment, 'thumbnailMediaAssetId')
    && attachment.thumbnailMediaAssetId !== null
    && (
      typeof attachment.thumbnailMediaAssetId !== 'string'
      || attachment.thumbnailMediaAssetId.trim().length === 0
    )
  ) {
    return { reason: 'invalid_attachment', detail: 'invalid thumbnailMediaAssetId' };
  }

  return null;
}

async function prepareMigrationPlan(
  candidate: ChatAttachmentMetadataCandidate,
  mediaAssets: ChatAttachmentMediaAssetPort,
): Promise<MigrationPreparation> {
  const parsed = parseMetadata(candidate);
  if ('reason' in parsed) {
    return parsed;
  }

  const { metadata, attachments } = parsed;
  const legacyIndexes: number[] = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (!getAttachmentType(attachment)) {
      return { reason: 'invalid_attachment', detail: `attachment ${index} has invalid type` };
    }
    const hasLocalUriProperty = hasOwn(attachment, 'localUri');
    const localUri = typeof attachment.localUri === 'string'
      ? attachment.localUri.trim()
      : '';
    const hasUsableLocalUri = localUri.length > 0;

    if (hasUsableLocalUri) {
      if (hasOwn(attachment, 'mediaAssetId') || hasOwn(attachment, 'thumbnailMediaAssetId')) {
        return { reason: 'invalid_attachment', detail: 'legacy and asset references are mixed' };
      }
      legacyIndexes.push(index);
      continue;
    }

    if (hasLocalUriProperty) {
      return { reason: 'invalid_attachment', detail: 'localUri is not a non-empty string' };
    }

    const assetOnlyFailure = validateAssetOnlyAttachment(attachment);
    if (assetOnlyFailure) {
      return assetOnlyFailure;
    }
  }

  if (legacyIndexes.length === 0) {
    return {
      metadata,
      attachments,
      legacyReferences: [],
      inputs: [],
    };
  }

  const inputs: LegacyChatAttachmentAdoptionInput[] = [];
  const inputByUri = new Map<string, number>();
  const references: LegacyReferencePlan[] = [];

  for (const attachmentIndex of legacyIndexes) {
    const attachment = attachments[attachmentIndex];
    const localUri = String(attachment.localUri).trim();
    const attachmentType = getAttachmentType(attachment);
    if (!attachmentType) {
      return { reason: 'invalid_attachment', detail: `attachment ${attachmentIndex} has invalid type` };
    }
    const fileName = typeof attachment.fileName === 'string' ? attachment.fileName : null;
    const sourceExtension = getExtension(fileName) || getExtension(localUri);
    if (attachmentType === 'file' && !SUPPORTED_TEXT_FILE_EXTENSIONS.has(sourceExtension)) {
      return {
        reason: 'invalid_attachment',
        detail: `unsupported Chat file extension for attachment ${attachmentIndex}`,
      };
    }
    const thumbnailValue = attachment.thumbnailUri;
    if (
      thumbnailValue !== undefined
      && thumbnailValue !== null
      && typeof thumbnailValue !== 'string'
    ) {
      return { reason: 'invalid_attachment', detail: 'thumbnailUri is not a string' };
    }
    const thumbnailUri = typeof thumbnailValue === 'string'
      ? thumbnailValue.trim()
      : null;

    const mainMimeType = deriveReliableMimeType(attachment, localUri);
    if (!mainMimeType) {
      return { reason: 'mime_unknown', detail: `attachment ${attachmentIndex}` };
    }
    if (attachmentType === 'image' && !mainMimeType.startsWith('image/')) {
      return { reason: 'mime_unknown', detail: `image attachment ${attachmentIndex} has non-image MIME` };
    }

    const mainInputIndex = await prepareInput({
      uri: localUri,
      attachmentType,
      mimeType: mainMimeType,
      width: positiveDimension(attachment.width),
      height: positiveDimension(attachment.height),
      mediaAssets,
      inputs,
      inputByUri,
    });
    if (typeof mainInputIndex !== 'number') {
      return mainInputIndex;
    }

    let thumbnailInputIndex: number | null = null;
    if (thumbnailUri) {
      const thumbnailMimeType = thumbnailUri === localUri
        ? mainMimeType
        : deriveMimeTypeFromUri(thumbnailUri);
      if (!thumbnailMimeType) {
        return {
          reason: 'mime_unknown',
          detail: `thumbnail of attachment ${attachmentIndex}`,
        };
      }

      const preparedThumbnail = await prepareInput({
        uri: thumbnailUri,
        attachmentType,
        mimeType: thumbnailMimeType,
        width: thumbnailUri === localUri ? positiveDimension(attachment.width) : null,
        height: thumbnailUri === localUri ? positiveDimension(attachment.height) : null,
        mediaAssets,
        inputs,
        inputByUri,
      });
      if (typeof preparedThumbnail !== 'number') {
        return preparedThumbnail;
      }
      thumbnailInputIndex = preparedThumbnail;
    }

    references.push({
      attachmentIndex,
      mainInputIndex,
      thumbnailInputIndex,
    });
  }

  return {
    metadata,
    attachments,
    legacyReferences: references,
    inputs,
  };
}

async function prepareInput(params: {
  uri: string;
  attachmentType: ChatAttachmentType;
  mimeType: string;
  width: number | null;
  height: number | null;
  mediaAssets: ChatAttachmentMediaAssetPort;
  inputs: LegacyChatAttachmentAdoptionInput[];
  inputByUri: Map<string, number>;
}): Promise<number | MigrationPreparationFailure> {
  if (isRemoteUri(params.uri)) {
    return { reason: 'remote_uri', detail: params.uri };
  }

  const existingIndex = params.inputByUri.get(params.uri);
  if (existingIndex !== undefined) {
    const existing = params.inputs[existingIndex];
    if (existing.mimeType !== params.mimeType) {
      return { reason: 'mime_conflict', detail: params.uri };
    }
    return existingIndex;
  }

  let located;
  try {
    located = await params.mediaAssets.locateLegacyChatFile(
      params.uri,
      params.attachmentType,
    );
  } catch {
    return { reason: 'legacy_file_unavailable', detail: params.uri };
  }

  if (
    !located
    || !located.storageBackend.trim()
    || !located.storageKey.trim()
    || !located.localUri.trim()
    || isRemoteUri(located.localUri)
  ) {
    return { reason: 'legacy_file_unavailable', detail: params.uri };
  }

  const input: LegacyChatAttachmentAdoptionInput = {
    storageBackend: located.storageBackend,
    storageKey: located.storageKey,
    localUri: located.localUri,
    mimeType: params.mimeType,
    width: params.width,
    height: params.height,
    durationMs: null,
  };
  const index = params.inputs.length;
  params.inputs.push(input);
  params.inputByUri.set(params.uri, index);
  return index;
}

function rewriteMetadata(
  plan: MigrationPlan,
  assets: readonly MediaAsset[],
): string {
  if (assets.length !== plan.inputs.length) {
    throw new Error(
      `MediaAsset adoption 返回数量错误：期待 ${plan.inputs.length}，实际 ${assets.length}`,
    );
  }

  const assetIds = assets.map((asset) => {
    if (!asset.id || typeof asset.id !== 'string') {
      throw new Error('MediaAsset adoption 返回了无效 asset id');
    }
    return asset.id;
  });
  const referencesByIndex = new Map(
    plan.legacyReferences.map((reference) => [reference.attachmentIndex, reference]),
  );

  const rewrittenAttachments = plan.attachments.map((attachment, index) => {
    const reference = referencesByIndex.get(index);
    if (!reference) {
      return attachment;
    }

    const {
      localUri: _localUri,
      thumbnailUri: _thumbnailUri,
      mediaAssetId: _mediaAssetId,
      thumbnailMediaAssetId: _thumbnailMediaAssetId,
      ...chatFields
    } = attachment;
    return {
      ...chatFields,
      mediaAssetId: assetIds[reference.mainInputIndex],
      ...(reference.thumbnailInputIndex === null
        ? {}
        : { thumbnailMediaAssetId: assetIds[reference.thumbnailInputIndex] }),
    };
  });

  return JSON.stringify({
    ...plan.metadata,
    attachments: rewrittenAttachments,
  });
}

async function migrateCandidate(
  candidate: ChatAttachmentMetadataCandidate,
  dependencies: MigrateLegacyChatAttachmentsDependencies,
): Promise<
  | { status: 'migrated'; migratedAttachments: number; adoptedAssets: number }
  | { status: 'skipped' }
  | { status: 'unresolved'; issue: LegacyChatAttachmentMigrationIssue }
> {
  let prepared: MigrationPreparation;
  try {
    prepared = await prepareMigrationPlan(candidate, dependencies.mediaAssets);
  } catch (error) {
    return {
      status: 'unresolved',
      issue: {
        messageId: candidate.messageId,
        sessionId: candidate.sessionId,
        reason: 'legacy_file_unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if ('reason' in prepared) {
    return {
      status: 'unresolved',
      issue: {
        messageId: candidate.messageId,
        sessionId: candidate.sessionId,
        reason: prepared.reason,
        detail: prepared.detail,
      },
    };
  }

  if (prepared.legacyReferences.length === 0) {
    return { status: 'skipped' };
  }

  try {
    await dependencies.mediaAssets.adoptLegacyChatFiles(
      prepared.inputs,
      async (transaction: DatabaseTransactionExecutor, assets: readonly MediaAsset[]) => {
        const metadataJson = rewriteMetadata(prepared, assets);
        await dependencies.messages.compareAndSwapMetadataJsonInTransaction(
          transaction,
          {
            messageId: candidate.messageId,
            expectedMetadataJson: candidate.metadataJson,
            metadataJson,
          },
        );
      },
    );
  } catch (error) {
    return {
      status: 'unresolved',
      issue: {
        messageId: candidate.messageId,
        sessionId: candidate.sessionId,
        reason: 'commit_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  return {
    status: 'migrated',
    migratedAttachments: prepared.legacyReferences.length,
    adoptedAssets: prepared.inputs.length,
  };
}

export class MigrateLegacyChatAttachments {
  constructor(private readonly dependencies: MigrateLegacyChatAttachmentsDependencies) {}

  async execute(
    options: MigrateLegacyChatAttachmentsOptions = {},
  ): Promise<MigrateLegacyChatAttachmentsResult> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw new Error(`Chat attachment migration pageSize 必须为正整数：${pageSize}`);
    }

    const result: MigrateLegacyChatAttachmentsResult = {
      scannedMessages: 0,
      migratedMessages: 0,
      skippedMessages: 0,
      unresolvedMessages: 0,
      migratedAttachments: 0,
      adoptedAssets: 0,
      sessionIds: [],
      issues: [],
    };
    const sessionIds = new Set<string>();
    let afterMessageId = options.afterMessageId ?? null;

    while (options.maxMessages === undefined || result.scannedMessages < options.maxMessages) {
      const remaining = options.maxMessages === undefined
        ? pageSize
        : Math.min(pageSize, options.maxMessages - result.scannedMessages);
      if (remaining <= 0) {
        break;
      }

      const candidates = await this.dependencies.messages.listChatAttachmentMetadataCandidates({
        limit: remaining,
        afterMessageId,
      });
      if (candidates.length === 0) {
        break;
      }

      for (const candidate of candidates) {
        result.scannedMessages += 1;
        afterMessageId = candidate.messageId;
        const outcome = await migrateCandidate(candidate, this.dependencies);
        if (outcome.status === 'migrated') {
          result.migratedMessages += 1;
          result.migratedAttachments += outcome.migratedAttachments;
          result.adoptedAssets += outcome.adoptedAssets;
          sessionIds.add(candidate.sessionId);
        } else if (outcome.status === 'skipped') {
          result.skippedMessages += 1;
        } else {
          result.unresolvedMessages += 1;
          result.issues.push(outcome.issue);
        }

        if (
          options.maxMessages !== undefined
          && result.scannedMessages >= options.maxMessages
        ) {
          break;
        }
      }

      if (candidates.length < remaining) {
        break;
      }
    }

    result.sessionIds = [...sessionIds];
    return result;
  }
}

export async function migrateLegacyChatAttachments(
  dependencies: MigrateLegacyChatAttachmentsDependencies,
  options?: MigrateLegacyChatAttachmentsOptions,
): Promise<MigrateLegacyChatAttachmentsResult> {
  return new MigrateLegacyChatAttachments(dependencies).execute(options);
}
