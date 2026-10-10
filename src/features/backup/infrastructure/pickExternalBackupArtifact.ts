import * as DocumentPicker from 'expo-document-picker';

import type { BackupArtifactHandle } from '../domain/BackupTarget';

export async function pickExternalBackupArtifact(): Promise<BackupArtifactHandle | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: false,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset.name.endsWith('.ravenbackup')) throw new Error('请选择 .ravenbackup 备份包');
  return {
    artifactId: asset.uri,
    fileName: asset.name,
    byteLength: asset.size ?? 0,
    locator: asset.uri,
  };
}
