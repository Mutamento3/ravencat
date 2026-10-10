/** 提供只允许配置与读取的进程内运行时依赖槽。 */
export interface RuntimeSlot<T> {
  configure(value: T): void;
  get(): T;
}

export function createRuntimeSlot<T>(name: string): RuntimeSlot<T> {
  let value: T | null = null;

  return {
    configure(nextValue: T): void {
      value = nextValue;
    },
    get(): T {
      if (value === null) {
        throw new Error(`${name} 运行时依赖尚未完成装配`);
      }
      return value;
    },
  };
}
