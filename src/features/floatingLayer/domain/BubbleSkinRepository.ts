/** 定义悬浮球装扮持久化与选择能力，界面不直接接触原生文件存储。 */

import type {
  BubbleSkin,
  ImportBubbleSkinInput,
  UpdateBubbleSkinImageInput,
} from './BubbleSkin';

export interface IBubbleSkinRepository {
  list(): Promise<BubbleSkin[]>;
  import(input: ImportBubbleSkinInput): Promise<BubbleSkin>;
  updateImage(input: UpdateBubbleSkinImageInput): Promise<BubbleSkin>;
  rename(id: string, name: string): Promise<BubbleSkin>;
  delete(id: string): Promise<void>;
  select(id: string): Promise<BubbleSkin>;
  setSize(id: string, sizeDp: number): Promise<BubbleSkin>;
}
