import { NativeModule, requireNativeModule } from 'expo-modules-core';

declare class CallRingtoneNative extends NativeModule {
  inspect(uri: string): Promise<{ durationMs: number }>;
  preview(owner: string, uri: string | null, direction: 'incoming' | 'outgoing'): Promise<void>;
  stopPreview(owner: string): Promise<void>;
}

export const nativeCallRingtone = requireNativeModule<CallRingtoneNative>('CallRingtone');
