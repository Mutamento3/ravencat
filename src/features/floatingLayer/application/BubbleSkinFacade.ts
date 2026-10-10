/** 向设置页暴露悬浮球装扮用例，并维护内置装扮不可改名、不可删除的边界。 */

import type {
  BubbleSkin,
  ImportBubbleSkinInput,
  UpdateBubbleSkinImageInput,
} from '../domain/BubbleSkin';
import { getFloatingLayerRuntimeDependencies } from './FloatingLayerRuntimeDependencies';

export function listBubbleSkins(): Promise<BubbleSkin[]> {
  return getFloatingLayerRuntimeDependencies().repositories.bubbleSkins.list();
}

export function importBubbleSkin(
  input: ImportBubbleSkinInput,
): Promise<BubbleSkin> {
  return getFloatingLayerRuntimeDependencies().repositories.bubbleSkins.import(input);
}

export function renameBubbleSkin(
  skin: BubbleSkin,
  name: string,
): Promise<BubbleSkin> {
  assertUserSkin(skin, '重命名');
  return getFloatingLayerRuntimeDependencies().repositories.bubbleSkins.rename(skin.id, name);
}

export function deleteBubbleSkin(skin: BubbleSkin): Promise<void> {
  assertUserSkin(skin, '删除');
  return getFloatingLayerRuntimeDependencies().repositories.bubbleSkins.delete(skin.id);
}

export function selectBubbleSkin(id: string): Promise<BubbleSkin> {
  return getFloatingLayerRuntimeDependencies().repositories.bubbleSkins.select(id);
}

export function updateBubbleSkinImage(input: UpdateBubbleSkinImageInput): Promise<BubbleSkin> {
  return getFloatingLayerRuntimeDependencies().repositories.bubbleSkins.updateImage(input);
}

function assertUserSkin(skin: BubbleSkin, action: string): void {
  if (skin.source !== 'user') {
    throw new Error(`内置装扮不能${action}`);
  }
}

export function setBubbleSize(id: string, sizeDp: number): Promise<BubbleSkin> {
  return getFloatingLayerRuntimeDependencies().repositories.bubbleSkins.setSize(id, sizeDp);
}
