/**
 * Cookie 管理模块
 * 读取、注入、清除 GitHub Cookie
 */

const GITHUB_DOMAINS = ['.github.com', 'github.com'];
const GITHUB_URL = 'https://github.com';

/** 读取所有 GitHub Cookie */
async function getGitHubCookies() {
  const cookies = await chrome.cookies.getAll({ domain: '.github.com' });
  const cookies2 = await chrome.cookies.getAll({ domain: 'github.com' });
  // 去重（按 name + domain + path）
  const map = new Map();
  for (const c of [...cookies, ...cookies2]) {
    map.set(`${c.name}|${c.domain}|${c.path}`, c);
  }
  return Array.from(map.values());
}

/** 序列化 Cookie 为可存储格式 */
function serializeCookies(cookies) {
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite || 'unspecified',
    expirationDate: c.expirationDate
  }));
}

/** 清除所有 GitHub Cookie */
async function clearGitHubCookies() {
  const cookies = await getGitHubCookies();
  const promises = cookies.map(c => {
    const protocol = c.secure ? 'https' : 'http';
    const url = `${protocol}://${c.domain.replace(/^\./, '')}${c.path}`;
    return chrome.cookies.remove({ url, name: c.name });
  });
  await Promise.all(promises);
}

/** 注入一组 Cookie */
async function injectCookies(cookieList) {
  for (const c of cookieList) {
    const details = {
      url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite || 'unspecified'
    };
    if (c.expirationDate) {
      details.expirationDate = c.expirationDate;
    }
    try {
      await chrome.cookies.set(details);
    } catch (e) {
      console.warn(`注入 Cookie 失败: ${c.name}`, e);
    }
  }
}

/**
 * 检测当前 GitHub Cookie 是否有效
 * Service Worker 的 fetch 不带浏览器 Cookie，
 * 所以直接从 chrome.cookies 读 dotcom_user / logged_in 来判断。
 * @returns {{ valid: boolean, username?: string }}
 */
async function checkCookieValidity() {
  try {
    const loggedIn = await chrome.cookies.get({ url: 'https://github.com', name: 'logged_in' });
    const dotcomUser = await chrome.cookies.get({ url: 'https://github.com', name: 'dotcom_user' });
    const userSession = await chrome.cookies.get({ url: 'https://github.com', name: 'user_session' });

    if (loggedIn?.value === 'yes' && dotcomUser?.value) {
      return { valid: true, username: dotcomUser.value };
    }
    // 某些情况下只有 user_session 但没有 dotcom_user
    if (userSession?.value && loggedIn?.value === 'yes') {
      return { valid: true, username: '' };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

/**
 * 切换到目标账号
 * @param {Array} targetCookies 目标账号的 Cookie 列表
 * @returns {Promise<void>}
 */
async function switchToAccount(targetCookies) {
  // 1. 清除当前所有 GitHub Cookie
  await clearGitHubCookies();
  // 2. 注入目标账号的 Cookie
  await injectCookies(targetCookies);
}

if (typeof globalThis !== 'undefined') {
  globalThis.Cookies = {
    getGitHubCookies, serializeCookies, clearGitHubCookies,
    injectCookies, checkCookieValidity, switchToAccount
  };
}
