export class ApplicationSettingsAccessError extends Error {
  constructor() {
    super('普通 AI 只能修改自己的设置；全局设置与其他 AI 的设置需要当前主理 AI 身份。');
    this.name = 'ApplicationSettingsAccessError';
  }
}
