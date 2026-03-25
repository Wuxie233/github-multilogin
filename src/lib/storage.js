/**
 * 账号存储管理模块
 * 所有敏感数据（密码、2FA 密钥、Cookie）加密后存储
 */

/** 生成唯一 ID */
function generateId() {
  return crypto.randomUUID();
}

/** 获取所有账号（解密） */
async function getAccounts() {
  const password = await globalThis.Crypto.getMasterPassword();
  const { accounts = [] } = await chrome.storage.local.get('accounts');
  const decrypted = [];
  for (const acc of accounts) {
    try {
      const plain = JSON.parse(await globalThis.Crypto.decrypt(acc.encrypted, password));
      decrypted.push({ id: acc.id, ...plain });
    } catch {
      // 解密失败的账号保留 ID 和 username
      decrypted.push({ id: acc.id, username: acc.username, _decryptError: true });
    }
  }
  return decrypted;
}

/** 获取原始加密账号列表（用于导出） */
async function getRawAccounts() {
  const { accounts = [] } = await chrome.storage.local.get('accounts');
  return accounts;
}

/** 保存单个账号 */
async function saveAccount(accountData) {
  const password = await globalThis.Crypto.getMasterPassword();
  const { accounts = [] } = await chrome.storage.local.get('accounts');

  const id = accountData.id || generateId();
  const { id: _, ...data } = accountData;
  const encrypted = await globalThis.Crypto.encrypt(JSON.stringify(data), password);

  const idx = accounts.findIndex(a => a.id === id);
  const entry = { id, username: accountData.username, encrypted };

  if (idx >= 0) {
    accounts[idx] = entry;
  } else {
    accounts.push(entry);
  }
  await chrome.storage.local.set({ accounts });
  return id;
}

/** 删除账号 */
async function deleteAccount(id) {
  const { accounts = [] } = await chrome.storage.local.get('accounts');
  const filtered = accounts.filter(a => a.id !== id);
  await chrome.storage.local.set({ accounts: filtered });
}

/**
 * 批量导入账号
 * @param {string} text 多行 "username----password----totpSecret"
 * @returns {{ imported: number, errors: Array }}
 */
async function importFromText(text) {
  const { success, errors } = globalThis.TOTP.parseCredentialsBatch(text);
  let imported = 0;

  // 获取已有账号，避免重复
  let existingUsernames = [];
  try {
    const existing = await getAccounts();
    existingUsernames = existing.map(a => a.username);
  } catch { /* 无已有账号 */ }

  for (const cred of success) {
    if (existingUsernames.includes(cred.username)) {
      errors.push({ line: 0, text: `${cred.username} (已存在，跳过)` });
      continue;
    }
    await saveAccount({
      username: cred.username,
      password: cred.password,
      totpSecret: cred.totpSecret,
      cookies: null,
      profile: null,
      lastLogin: null,
      status: 'new'
    });
    imported++;
  }
  return { imported, skipped: errors.length, errors };
}

/**
 * 导出为 JSON（加密态）
 * @returns {string} JSON 字符串
 */
async function exportToJSON() {
  const accounts = await getRawAccounts();
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts
  }, null, 2);
}

/**
 * 从 JSON 导入（加密态，需要相同主密码）
 * @param {string} jsonStr JSON 字符串
 * @returns {{ imported: number, skipped: number }}
 */
async function importFromJSON(jsonStr) {
  const data = JSON.parse(jsonStr);
  if (!data.version || !Array.isArray(data.accounts)) {
    throw new Error('无效的导入文件格式');
  }

  const { accounts: existing = [] } = await chrome.storage.local.get('accounts');
  const existingIds = new Set(existing.map(a => a.id));
  const existingNames = new Set(existing.map(a => a.username));

  let imported = 0;
  let skipped = 0;
  const merged = [...existing];

  for (const acc of data.accounts) {
    if (existingIds.has(acc.id) || existingNames.has(acc.username)) {
      skipped++;
      continue;
    }
    merged.push(acc);
    imported++;
  }

  await chrome.storage.local.set({ accounts: merged });
  return { imported, skipped };
}

/** 更新账号的 Cookie 和 Profile */
async function updateAccountState(id, { cookies, profile, status }) {
  const password = await globalThis.Crypto.getMasterPassword();
  const { accounts = [] } = await chrome.storage.local.get('accounts');
  const idx = accounts.findIndex(a => a.id === id);
  if (idx < 0) throw new Error('账号不存在');

  const plain = JSON.parse(await globalThis.Crypto.decrypt(accounts[idx].encrypted, password));
  if (cookies !== undefined) plain.cookies = cookies;
  if (profile !== undefined) plain.profile = profile;
  if (status !== undefined) plain.status = status;
  plain.lastLogin = new Date().toISOString();

  accounts[idx].encrypted = await globalThis.Crypto.encrypt(JSON.stringify(plain), password);
  await chrome.storage.local.set({ accounts });
}

if (typeof globalThis !== 'undefined') {
  globalThis.Storage = {
    getAccounts, getRawAccounts, saveAccount, deleteAccount,
    importFromText, exportToJSON, importFromJSON, updateAccountState, generateId
  };
}
