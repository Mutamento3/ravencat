/** 当前主理 AI 高权限动作与关系变更的串行裁决门。 */

export interface CurrentHostAuthorityReader {
  getCurrentHostAIId(): Promise<string | null>;
}

export type CurrentHostAuthorityResult<T> =
  | { status: 'authorized'; value: T }
  | { status: 'not_current_host' };

export class HostAuthorityCoordinator {
  private laneTail: Promise<void> = Promise.resolve();

  constructor(private readonly authorityReader: CurrentHostAuthorityReader) {}

  runAsCurrentHost<T>(
    actorAiId: string,
    action: () => Promise<T>,
  ): Promise<CurrentHostAuthorityResult<T>> {
    return this.enqueue(async () => {
      const currentHostAiId = await this.authorityReader.getCurrentHostAIId();
      if (currentHostAiId !== actorAiId) {
        return { status: 'not_current_host' };
      }

      return {
        status: 'authorized',
        value: await action(),
      };
    });
  }

  runHostMutation<T>(mutation: () => Promise<T>): Promise<T> {
    return this.enqueue(mutation);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.laneTail.then(operation);
    this.laneTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
