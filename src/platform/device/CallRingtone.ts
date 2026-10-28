import { nativeCallRingtone } from '../../../modules/call-ringtone';

export const inspectCallRingtone = (uri: string) => nativeCallRingtone.inspect(uri);

export const previewCallRingtone = (owner: string, uri: string | null, direction: 'incoming' | 'outgoing') =>
  nativeCallRingtone.preview(owner, uri, direction);
export const stopCallRingtonePreview = (owner: string) => nativeCallRingtone.stopPreview(owner);
