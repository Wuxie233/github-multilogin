/**
 * Cookie 管理模块
 * 读取、注入、清除 GitHub Cookie
 *
 * 关键：GitHub 使用 __Host- 前缀 Cookie（如 __Host-user_session_same_site）
 * 这类 Cookie 必须是 host-only（不带 domain 属性），否则 CSRF 校验会失败。
 */

const GITHUB_URL = 'https://github.com';

/** 读取所有 GitHub Cookie（包括子域名） */
async function getGitHubCookies() {
  // domain 过滤器会匹配 github.com 及其所有子域名（api/alive/education...）
  return chrome.cookies.getAll({ domain: 'github.com' });
}

/**
 * 序列化 Cookie 为可存储格式
 * 关键：保留 hostOnly 属性，注入时才能正确恢复 __Host- Cookie
 */
function serializeCookies(cookies) {
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    hostOnly: c.hostOnly,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite || 'unspecified',
    expirationDate: c.expirationDate
  }));
}

/** 清除所有 GitHub Cookie（包括子域名） */
async function clearGitHubCookies() {
  const cookies = await getGitHubCookies();
  const promises = cookies.map(c => {
    const protocol = c.secure ? 'https' : 'http';
    const url = `${protocol}://${c.domain.replace(/^\./, '')}${c.path}`;
    return chrome.cookies.remove({ url, name: c.name });
  });
  await Promise.all(promises);
}

/**
 * 注入一组 Cookie
 * 关键1：host-only Cookie（__Host- 前缀）不能设置 domain 参数，
 * 否则 chrome.cookies.set 会创建 domain Cookie，破坏 CSRF 保护。
 * 关键2：跳过 _gh_sess — 这是 GitHub 的加密 CSRF 状态 Cookie，
 * 注入旧值会导致 authenticity_token 与 _gh_sess 不同步，
 * 让 GitHub 在首次页面加载时自动重建才能保持一致。
 */
// 注入时跳过的 Cookie（让 GitHub 在页面加载时自动重建）
const SKIP_ON_INJECT = new Set(['_gh_sess']);

async function injectCookies(cookieList) {
  for (const c of cookieList) {
    if (SKIP_ON_INJECT.has(c.name)) continue;

    const details = {
      url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite || 'unspecified'
    };
    // host-only Cookie 不设置 domain（让浏览器自动设为 host-only）
    // __Host- 前缀 Cookie 必须是 host-only，否则浏览器会拒绝或降级
    if (!c.hostOnly) {
      details.domain = c.domain;
    }
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
