/** 定义悬浮球内置装扮与用户装扮的稳定领域模型。 */

export type BubbleSkinSource = 'builtin' | 'user';
export type BubbleSkinMimeType = 'image/svg+xml' | 'image/png' | 'image/jpeg';

export interface BubbleSkin {
  id: string;
  name: string;
  source: BubbleSkinSource;
  mimeType: BubbleSkinMimeType;
  uri?: string | null;
  dockedUri?: string | null;
  dockedMimeType?: BubbleSkinMimeType | null;
  hasDockedAsset: boolean;
  selected: boolean;
  sizeDp: number;
}

export interface ImportBubbleSkinInput {
  uri: string;
  fileName: string;
  mimeType?: string | null;
  name: string;
}

export interface UpdateBubbleSkinImageInput {
  id: string;
  form: 'normal' | 'docked';
  uri: string;
  fileName: string;
  mimeType?: string | null;
}
