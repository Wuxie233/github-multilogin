/**
 * Profile 提取模块
 * 获取当前已登录 GitHub 账号的完整信息
 * 
 * 因为 Service Worker 的 fetch 不带浏览器 Cookie，
 * 优先从 Cookie（dotcom_user）+ 在 GitHub 标签页注入脚本来获取。
 */

/**
 * 通过 Cookie + scripting.executeScript 获取当前用户信息
 * 在 Background Service Worker 中调用
 */
async function fetchCurrentProfile() {
  try {
    // 1. 先从 Cookie 获取用户名
    const dotcomUser = await chrome.cookies.get({ url: 'https://github.com', name: 'dotcom_user' });
    const loggedIn = await chrome.cookies.get({ url: 'https://github.com', name: 'logged_in' });
    
    if (!dotcomUser?.value || loggedIn?.value !== 'yes') {
      return null;
    }
    
    const username = dotcomUser.value;

    // 2. 头像直接用 GitHub 公开 URL（最可靠，不依赖 DOM）
    const avatar_url = `https://github.com/${encodeURIComponent(username)}.png?size=128`;

    return {
      username,
      name: username,
      avatar_url,
      email: '',
      bio: '',
      orgs: []
    };
  } catch {
    return null;
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.Profile = { fetchCurrentProfile };
}
