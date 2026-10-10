const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

// 安全存储绑定设备密钥，排除云备份与换机复制；其余数据沿用 Android 默认备份范围。
const rules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="sharedpref" path="SecureStore" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="sharedpref" path="SecureStore" />
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withMcpCredentialBackup(config) {
  config = withAndroidManifest(config, (mod) => {
    AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults).$['android:dataExtractionRules'] = '@xml/mcp_credential_backup_rules';
    return mod;
  });
  return withDangerousMod(config, ['android', (mod) => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mcp_credential_backup_rules.xml'), rules, 'utf8');
    return mod;
  }]);
};
