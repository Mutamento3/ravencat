import { randomUUID } from 'expo-crypto';

/** 平台提供的安全 UUID；业务层只负责添加自己的稳定 ID 前缀。 */
export function createRandomUUID(): string {
  return randomUUID();
}
