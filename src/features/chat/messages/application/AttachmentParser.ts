/** 解析聊天文本附件并生成受长度限制的 AI 上下文与预览。 */
import { persistentMediaStore } from '@platform/device';

const MAX_PARSED_TEXT_LENGTH = 6000;
const MAX_PREVIEW_LENGTH = 240;
const SUPPORTED_TEXT_FILE_EXTENSIONS = new Set(['txt', 'md', 'json', 'csv']);
const SUPPORTED_TEXT_FILE_LABEL = 'TXT、MD、JSON 和 CSV';

export interface ParseAttachmentResult {
  parseStatus: 'success' | 'failed' | 'skipped';
  parsedText: string | null;
  previewText: string | null;
  parserName: string | null;
  parseError: string | null;
}

export interface AttachmentParserService {
  parseFile(input: {
    localUri: string;
    fileName: string;
    mimeType?: string | null;
  }): Promise<ParseAttachmentResult>;
}

export function isChatAttachmentFileSupported(input: {
  fileName: string;
}): boolean {
  return SUPPORTED_TEXT_FILE_EXTENSIONS.has(getExtension(input.fileName));
}

export function assertChatAttachmentFileSupported(input: {
  fileName: string;
}): void {
  if (!isChatAttachmentFileSupported(input)) {
    throw new Error(`此文件无法解析，无法发送。当前支持 ${SUPPORTED_TEXT_FILE_LABEL} 文件`);
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

function getExtension(fileName: string): string {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] || '';
}

function normalizeTextContent(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

class AttachmentParser implements AttachmentParserService {
  async parseFile(input: {
    localUri: string;
    fileName: string;
    mimeType?: string | null;
  }): Promise<ParseAttachmentResult> {
    const extension = getExtension(input.fileName);
    const parserName = extension || input.mimeType || 'unknown';

    if (!isChatAttachmentFileSupported(input)) {
      return {
        parseStatus: 'skipped',
        parsedText: null,
        previewText: null,
        parserName: null,
        parseError: null,
      };
    }

    try {
      const rawText = await persistentMediaStore.readAsText(input.localUri);
      let normalized = normalizeTextContent(rawText);

      if (extension === 'json') {
        try {
          normalized = JSON.stringify(JSON.parse(normalized), null, 2);
        } catch {
          // 保持原文本
        }
      }

      if (extension === 'csv') {
        normalized = normalized
          .split('\n')
          .slice(0, 12)
          .join('\n');
      }

      const parsedText = truncateText(normalized, MAX_PARSED_TEXT_LENGTH);
      return {
        parseStatus: 'success',
        parsedText,
        previewText: truncateText(parsedText.replace(/\n+/g, ' '), MAX_PREVIEW_LENGTH),
        parserName,
        parseError: null,
      };
    } catch (error) {
      return {
        parseStatus: 'failed',
        parsedText: null,
        previewText: null,
        parserName,
        parseError: error instanceof Error ? error.message : '文件解析失败',
      };
    }
  }
}

export const attachmentParser = new AttachmentParser();
