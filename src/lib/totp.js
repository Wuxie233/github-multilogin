/**
 * TOTP 生成模块 — 纯 Web Crypto API 实现
 * RFC 6238 TOTP / RFC 4226 HOTP
 */

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 解码为 Uint8Array */
function base32Decode(input) {
  const cleaned = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = '';
  for (const c of cleaned) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) throw new Error('无效的 Base32 字符: ' + c);
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

/** HMAC-SHA1 签名 */
async function hmacSha1(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(sig);
}

/** 将数字转为 8 字节大端 ArrayBuffer */
function intToBytes(num) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // JS number 安全范围内，高 32 位用 Math.floor
  view.setUint32(0, Math.floor(num / 0x100000000), false);
  view.setUint32(4, num >>> 0, false);
  return new Uint8Array(buf);
}

/**
 * 生成 TOTP
 * @param {string} secret Base32 编码的密钥
 * @param {number} [period=30] 时间步长（秒）
 * @param {number} [digits=6] 验证码位数
 * @returns {Promise<string>} TOTP 验证码
 */
async function generateTOTP(secret, period = 30, digits = 6) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBytes = intToBytes(counter);
  const hmac = await hmacSha1(key, counterBytes);

  // Dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = code % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/** 获取当前 TOTP 剩余有效时间（秒） */
function getTimeRemaining(period = 30) {
  return period - (Math.floor(Date.now() / 1000) % period);
}

/**
 * 解析凭证字符串
 * @param {string} line "username----password----totpSecret"
 * @returns {{ username: string, password: string, totpSecret: string } | null}
 */
function parseCredentialLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('----')) return null;
  const parts = trimmed.split('----');
  if (parts.length < 3) return null;
  const username = parts[0].trim();
  const password = parts[1].trim();
  const totpSecret = parts[2].trim();
  if (!username || !password) return null;
  return { username, password, totpSecret };
}

/**
 * 批量解析凭证
 * @param {string} text 多行文本
 * @returns {{ success: Array, errors: Array<{line: number, text: string}> }}
 */
function parseCredentialsBatch(text) {
  const lines = text.split('\n');
  const success = [];
  const errors = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return; // 跳过空行
    const parsed = parseCredentialLine(line);
    if (parsed) {
      success.push(parsed);
    } else {
      errors.push({ line: i + 1, text: line.trim() });
    }
  });
  return { success, errors };
}

if (typeof globalThis !== 'undefined') {
  globalThis.TOTP = {
    generateTOTP, getTimeRemaining, parseCredentialLine, parseCredentialsBatch, base32Decode
  };
}
