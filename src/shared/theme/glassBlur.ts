/** 玻璃模糊度的设置范围；滑杆保证内部数值，存储入口负责校验外部数据。 */
export const GLASS_BLUR_RANGE = { min: 0, max: 30, step: 1 } as const;

export function parseGlassBlurRadius(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) ||
    value < GLASS_BLUR_RANGE.min || value > GLASS_BLUR_RANGE.max) {
    throw new Error('玻璃模糊度必须是 0–30 之间的整数');
  }
  return value;
}
