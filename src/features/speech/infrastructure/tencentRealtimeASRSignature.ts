/** 在设备端生成腾讯云实时语音识别 WebSocket 签名。 */

export interface TencentRealtimeASRSignatureParams {
  baseURL: string;
  appId: string;
  secretId: string;
  secretKey: string;
  engineModelType: string;
  voiceId: string;
  voiceFormat: number;
  needVad: 0 | 1;
  filterEmptyResult?: 0 | 1;
  vadSilenceTime?: number | null;
  maxSpeakTime?: number | null;
  hotwordId?: string | null;
  hotwordList?: string | null;
  timestamp?: number;
  expired?: number;
  nonce?: number;
}

function leftRotate(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function utf8Encode(value: string): number[] {
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  if (encoder) {
    return Array.from(encoder.encode(value));
  }

  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}

function sha1Bytes(input: string | number[]): number[] {
  const bytes = typeof input === 'string' ? utf8Encode(input) : [...input];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);

  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff
  );

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    const words = new Array<number>(80);
    for (let index = 0; index < 16; index += 1) {
      const offset = chunkStart + index * 4;
      words[index] = (
        (bytes[offset] << 24)
        | (bytes[offset + 1] << 16)
        | (bytes[offset + 2] << 8)
        | bytes[offset + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = leftRotate(
        words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16],
        1
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (leftRotate(a, 5) + f + e + k + words[index]) >>> 0;
      e = d;
      d = c;
      c = leftRotate(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].flatMap((word) => [
    (word >>> 24) & 0xff,
    (word >>> 16) & 0xff,
    (word >>> 8) & 0xff,
    word & 0xff,
  ]);
}

function hmacSha1Bytes(keyText: string, message: string): number[] {
  let key = utf8Encode(keyText);
  if (key.length > 64) {
    key = sha1Bytes(key);
  }
  while (key.length < 64) {
    key.push(0);
  }

  const outerKeyPad = key.map((byte) => byte ^ 0x5c);
  const innerKeyPad = key.map((byte) => byte ^ 0x36);
  const innerHash = sha1Bytes([...innerKeyPad, ...utf8Encode(message)]);
  return sha1Bytes([...outerKeyPad, ...innerHash]);
}

function bytesToBase64(bytes: number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;

    output += alphabet[(combined >>> 18) & 0x3f];
    output += alphabet[(combined >>> 12) & 0x3f];
    output += hasSecond ? alphabet[(combined >>> 6) & 0x3f] : '=';
    output += hasThird ? alphabet[combined & 0x3f] : '=';
  }
  return output;
}

function encodeQueryValue(value: string | number): string {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空`);
  }
  return normalized;
}

export function createTencentRealtimeASRSignedUrl(
  params: TencentRealtimeASRSignatureParams
): string {
  const baseURL = normalizeRequiredText(params.baseURL, '腾讯云 ASR 地址').replace(/\/+$/, '');
  if (!baseURL.startsWith('wss://')) {
    throw new Error('腾讯云 ASR 地址必须使用 wss://');
  }

  const appId = normalizeRequiredText(params.appId, '腾讯云 AppID');
  const secretId = normalizeRequiredText(params.secretId, '腾讯云 SecretID');
  const secretKey = normalizeRequiredText(params.secretKey, '腾讯云 SecretKey');
  const engineModelType = normalizeRequiredText(params.engineModelType, '腾讯云识别引擎');
  const voiceId = normalizeRequiredText(params.voiceId, '腾讯云 voice_id');
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
  const expired = params.expired ?? timestamp + 3600;
  const nonce = params.nonce ?? Math.floor(Math.random() * 1_000_000_000) + 1;
  const endpoint = `${baseURL}/${encodeQueryValue(appId)}`;

  const query: Record<string, string | number> = {
    engine_model_type: engineModelType,
    expired,
    filter_empty_result: params.filterEmptyResult ?? 1,
    needvad: params.needVad,
    nonce,
    secretid: secretId,
    timestamp,
    voice_format: params.voiceFormat,
    voice_id: voiceId,
  };

  if (params.vadSilenceTime !== null && params.vadSilenceTime !== undefined) {
    query.vad_silence_time = params.vadSilenceTime;
  }
  if (params.maxSpeakTime !== null && params.maxSpeakTime !== undefined) {
    query.max_speak_time = params.maxSpeakTime;
  }
  if (params.hotwordId) {
    query.hotword_id = params.hotwordId;
  }
  if (params.hotwordList) {
    query.hotword_list = params.hotwordList;
  }

  const queryText = Object.keys(query)
    .sort()
    .map((key) => `${key}=${encodeQueryValue(query[key])}`)
    .join('&');
  const signatureSource = `${endpoint.slice('wss://'.length)}?${queryText}`;
  const signature = bytesToBase64(hmacSha1Bytes(secretKey, signatureSource));
  return `${endpoint}?${queryText}&signature=${encodeQueryValue(signature)}`;
}
