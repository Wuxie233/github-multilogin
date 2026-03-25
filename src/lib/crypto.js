/**
 * 加密模块 — AES-256-GCM + PBKDF2
 * 主密码 → PBKDF2 派生 256-bit 密钥 → AES-GCM 加密/解密
 */

const PBKDF2_ITERATIONS = 310000;
const LEGACY_PBKDF2_ITERATIONS = [100000];
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const MASTER_CHECK_MARKER = 'github-multilogin-ok';

/** 将字符串编码为 Uint8Array */
function encode(str) {
  return new TextEncoder().encode(str);
}

/** 将 Uint8Array 解码为字符串 */
function decode(buf) {
  return new TextDecoder().decode(buf);
}

/** 将 ArrayBuffer 转为 Base64 */
function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/** 将 Base64 转为 Uint8Array */
function base64ToBuf(b64) {
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

/** 从主密码 + salt 派生 AES 密钥 */
async function deriveKey(password, salt, iterations = PBKDF2_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * AES-GCM 加密
 * @returns {string} base64(salt + iv + ciphertext)
 */
async function encrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encode(plaintext)
  );
  // 拼接 salt(16) + iv(12) + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return bufToBase64(combined.buffer);
}

/**
 * AES-GCM 解密
 * @param {string} encrypted base64 编码的密文
 * @returns {string} 明文
 */
async function decrypt(encrypted, password, iterations = PBKDF2_ITERATIONS) {
  const combined = base64ToBuf(encrypted);
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt, iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return decode(plaintext);
}

/**
 * 带降级的解密 — 先用当前迭代次数，失败后尝试旧版本
 * @returns {{ text: string, legacy: boolean }}
 */
async function decryptWithFallback(encrypted, password) {
  try {
    const text = await decrypt(encrypted, password, PBKDF2_ITERATIONS);
    return { text, legacy: false };
  } catch {
    // 尝试旧版本迭代次数
    for (const legacyIter of LEGACY_PBKDF2_ITERATIONS) {
      try {
        const text = await decrypt(encrypted, password, legacyIter);
        return { text, legacy: true };
      } catch { /* 继续尝试下一个 */ }
    }
    throw new Error('解密失败');
  }
}

/** 设置主密码 — 加密一个标记值用于后续验证 */
async function setMasterPassword(password) {
  const marker = await encrypt(MASTER_CHECK_MARKER, password);
  await chrome.storage.local.set({ masterMarker: marker });
  // 缓存到 session（关闭浏览器自动清除）
  await chrome.storage.session.set({ masterPassword: password });
}

/** 验证主密码（支持旧版迁移） */
async function verifyMasterPassword(password) {
  const { masterMarker } = await chrome.storage.local.get('masterMarker');
  if (!masterMarker) return false;
  try {
    const { text, legacy } = await decryptWithFallback(masterMarker, password);
    return text === MASTER_CHECK_MARKER ? { valid: true, needsMigration: legacy } : { valid: false };
  } catch {
    return { valid: false };
  }
}

/** 迁移旧版加密数据到新迭代次数 */
async function migrateEncryption(password) {
  // 重新加密 masterMarker
  const marker = await encrypt(MASTER_CHECK_MARKER, password);

  // 重新加密所有账号
  const { accounts = [] } = await chrome.storage.local.get('accounts');
  const migrated = [];
  for (const acc of accounts) {
    try {
      const { text } = await decryptWithFallback(acc.encrypted, password);
      const newEnc = await encrypt(text, password);
      migrated.push({ ...acc, encrypted: newEnc });
    } catch {
      migrated.push(acc); // 解密失败的保持原样
    }
  }

  await chrome.storage.local.set({ accounts: migrated, masterMarker: marker });
  console.log(`[Crypto] 已迁移 ${migrated.length} 个账号到 PBKDF2 ${PBKDF2_ITERATIONS} 迭代`);
}

/** 解锁（验证并缓存主密码到 session，自动迁移旧版数据） */
async function unlock(password) {
  const result = await verifyMasterPassword(password);
  if (!result.valid) throw new Error('主密码错误');

  await chrome.storage.session.set({ masterPassword: password });

  // 自动迁移旧版加密数据
  if (result.needsMigration) {
    try {
      await migrateEncryption(password);
    } catch (e) {
      console.warn('[Crypto] 迁移失败:', e);
    }
  }

  return true;
}

/** 检查是否已解锁 */
async function isUnlocked() {
  const { masterPassword } = await chrome.storage.session.get('masterPassword');
  return !!masterPassword;
}

/** 获取缓存的主密码 */
async function getMasterPassword() {
  const { masterPassword } = await chrome.storage.session.get('masterPassword');
  if (!masterPassword) throw new Error('未解锁，请先输入主密码');
  return masterPassword;
}

/** 检查是否已设置主密码 */
async function hasMasterPassword() {
  const { masterMarker } = await chrome.storage.local.get('masterMarker');
  return !!masterMarker;
}

/** 修改主密码 — 需要重新加密所有数据 */
async function changeMasterPassword(oldPassword, newPassword) {
  const result = await verifyMasterPassword(oldPassword);
  if (!result.valid) throw new Error('旧密码错误');

  // 读取所有账号并重新加密
  const { accounts = [] } = await chrome.storage.local.get('accounts');
  const reEncrypted = [];
  for (const acc of accounts) {
    const { text } = await decryptWithFallback(acc.encrypted, oldPassword);
    const newEnc = await encrypt(text, newPassword);
    reEncrypted.push({ ...acc, encrypted: newEnc });
  }

  // 新标记
  const marker = await encrypt(MASTER_CHECK_MARKER, newPassword);
  await chrome.storage.local.set({ accounts: reEncrypted, masterMarker: marker });
  await chrome.storage.session.set({ masterPassword: newPassword });
}

// 模块导出（供其他脚本 import 或全局使用）
if (typeof globalThis !== 'undefined') {
  globalThis.Crypto = {
    encrypt, decrypt, decryptWithFallback, setMasterPassword, verifyMasterPassword,
    unlock, isUnlocked, getMasterPassword, hasMasterPassword,
    changeMasterPassword, migrateEncryption, bufToBase64, base64ToBuf
  };
}
