/**
 * Background Service Worker
 * 协调 Content Script、Popup、Options 之间的消息
 * 管理自动登录流程
 */

// 加载库模块
importScripts(
  '../lib/crypto.js',
  '../lib/totp.js',
  '../lib/storage.js',
  '../lib/cookies.js',
  '../lib/profile.js'
);

// 登录状态机
const loginSessions = new Map(); // tabId -> { accountId, step, username }

// === 消息路由 ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content Script 消息
  if (msg.source === 'content-login') {
    handleContentMessage(msg, sender);
    return;
  }

  // Popup / Options 消息
  handleUIMessage(msg, sender, sendResponse);
  return true; // 保持异步 sendResponse
});

// === UI 消息处理 ===
async function handleUIMessage(msg, sender, sendResponse) {
  try {
    switch (msg.action) {
      // 主密码
      case 'hasMasterPassword':
        sendResponse({ result: await Crypto.hasMasterPassword() });
        break;
      case 'setMasterPassword':
        await Crypto.setMasterPassword(msg.password);
        sendResponse({ result: true });
        break;
      case 'unlock':
        await Crypto.unlock(msg.password);
        sendResponse({ result: true });
        break;
      case 'isUnlocked':
        sendResponse({ result: await Crypto.isUnlocked() });
        break;
      case 'changeMasterPassword':
        await Crypto.changeMasterPassword(msg.oldPassword, msg.newPassword);
        sendResponse({ result: true });
        break;

      // 账号管理
      case 'getAccounts':
        sendResponse({ result: await Storage.getAccounts() });
        break;
      case 'saveAccount':
        sendResponse({ result: await Storage.saveAccount(msg.account) });
        break;
      case 'deleteAccount':
        await Storage.deleteAccount(msg.id);
        sendResponse({ result: true });
        break;
      case 'importFromText':
        sendResponse({ result: await Storage.importFromText(msg.text) });
        break;
      case 'exportToJSON':
        sendResponse({ result: await Storage.exportToJSON() });
        break;
      case 'importFromJSON':
        sendResponse({ result: await Storage.importFromJSON(msg.json) });
        break;

      // 登录/切换
      case 'switchAccount':
        sendResponse(await switchAccount(msg.accountId));
        break;
      case 'loginAccount':
        sendResponse(await startLogin(msg.accountId));
        break;

      // 保存当前账号
      case 'saveCurrentAccount':
        sendResponse(await saveCurrentAccount());
        break;

      // 退出 GitHub 登录
      case 'logoutGitHub':
        sendResponse(await logoutGitHub());
        break;

      // 获取当前登录状态
      case 'getCurrentStatus':
        sendResponse(await getCurrentStatus());
        break;

      default:
        sendResponse({ error: '未知操作: ' + msg.action });
    }
  } catch (e) {
    sendResponse({ error: e.message });
  }
}

// === Content Script 消息 ===
function handleContentMessage(msg, sender) {
  if (msg.action === 'pageReady') {
    const tabId = sender.tab?.id;
    if (!tabId) return;

    const session = loginSessions.get(tabId);
    if (!session) return;

    // 页面加载完成，继续自动登录流程
    continueLoginFlow(tabId, msg);
  }
}

// === 核心功能 ===

/** 切换到指定账号（Cookie 注入方式） */
async function switchAccount(accountId) {
  const accounts = await Storage.getAccounts();
  const account = accounts.find(a => a.id === accountId);
  if (!account) return { error: '账号不存在' };

  if (!account.cookies || account.cookies.length === 0) {
    // 没有保存的 Cookie，需要走登录流程
    return startLogin(accountId);
  }

  // 保存当前活跃账号的 Cookie（如果有的话）
  await saveCurrentCookies();

  // 注入目标 Cookie
  await Cookies.switchToAccount(account.cookies);

  // 验证 Cookie 有效性
  const validity = await Cookies.checkCookieValidity();
  if (!validity.valid) {
    // Cookie 失效，走重新登录
    await Storage.updateAccountState(accountId, { status: 'cookie_expired' });
    return startLogin(accountId);
  }

  // 更新状态
  await Storage.updateAccountState(accountId, { status: 'active' });

  // 刷新当前 GitHub 标签页
  await refreshGitHubTabs();

  return { success: true, username: validity.username };
}

/** 启动自动登录流程 */
async function startLogin(accountId) {
  const accounts = await Storage.getAccounts();
  const account = accounts.find(a => a.id === accountId);
  if (!account) return { error: '账号不存在' };
  if (!account.password) return { error: '账号无密码信息' };

  // 保存当前 Cookie
  await saveCurrentCookies();

  // 清除当前 Cookie
  await Cookies.clearGitHubCookies();

  // 打开 GitHub 登录页
  const tab = await chrome.tabs.create({ url: 'https://github.com/login', active: true });

  // 注册登录会话
  loginSessions.set(tab.id, {
    accountId,
    username: account.username,
    password: account.password,
    totpSecret: account.totpSecret,
    step: 'waiting_login_page'
  });

  // 设置超时
  setTimeout(() => {
    if (loginSessions.has(tab.id)) {
      loginSessions.delete(tab.id);
    }
  }, 60000);

  return { success: true, message: '正在自动登录...', tabId: tab.id };
}

/** 继续自动登录流程（由 Content Script pageReady 触发） */
async function continueLoginFlow(tabId, pageInfo) {
  const session = loginSessions.get(tabId);
  if (!session) return;

  try {
    if (pageInfo.page === 'login' && session.step === 'waiting_login_page') {
      // 填写用户名密码
      session.step = 'filling_login';
      await chrome.tabs.sendMessage(tabId, {
        target: 'content-login',
        action: 'fillLogin',
        username: session.username,
        password: session.password
      });
      session.step = 'waiting_2fa_or_success';
    }
    else if (pageInfo.page === '2fa') {
      // 生成 TOTP 并填写
      if (!session.totpSecret) {
        loginSessions.delete(tabId);
        return; // 没有 2FA 密钥，用户手动处理
      }
      session.step = 'filling_2fa';
      const totpCode = await TOTP.generateTOTP(session.totpSecret);
      await chrome.tabs.sendMessage(tabId, {
        target: 'content-login',
        action: 'fill2FA',
        totpCode
      });
      session.step = 'waiting_login_result';
    }
    else if (pageInfo.page === 'device-verify') {
      // 风控页面，停止自动化
      loginSessions.delete(tabId);
      // 通知 Popup（如果在线）
      chrome.runtime.sendMessage({
        action: 'loginStatus',
        accountId: session.accountId,
        status: 'device_verify_required',
        message: '需要设备验证，请手动完成'
      }).catch(() => {});
    }
    else if (pageInfo.loggedIn) {
      // 登录成功
      const accountId = session.accountId;
      loginSessions.delete(tabId);

      // 保存 Cookie
      const cookies = Cookies.serializeCookies(await Cookies.getGitHubCookies());

      // 获取 Profile
      const profile = await Profile.fetchCurrentProfile();

      // 更新账号状态
      await Storage.updateAccountState(accountId, {
        cookies,
        profile,
        status: 'active'
      });

      // 通知 Popup
      chrome.runtime.sendMessage({
        action: 'loginStatus',
        accountId,
        status: 'success',
        message: `${session.username} 登录成功`
      }).catch(() => {});
    }
  } catch (e) {
    console.error('登录流程出错:', e);
    loginSessions.delete(tabId);
  }
}

/** 保存当前活跃账号的 Cookie */
async function saveCurrentCookies() {
  try {
    const validity = await Cookies.checkCookieValidity();
    if (!validity.valid || !validity.username) return;

    const accounts = await Storage.getAccounts();
    const current = accounts.find(a => a.username === validity.username);
    if (!current) return;

    const cookies = Cookies.serializeCookies(await Cookies.getGitHubCookies());
    await Storage.updateAccountState(current.id, { cookies, status: 'active' });
  } catch { /* 静默失败 */ }
}

/** 保存当前登录账号为新账号 */
async function saveCurrentAccount() {
  // 获取当前 Cookie 和 Profile 
  const cookies = Cookies.serializeCookies(await Cookies.getGitHubCookies());
  const profile = await Profile.fetchCurrentProfile();

  if (!profile) {
    return { error: '未检测到 GitHub 登录状态' };
  }

  // 检查是否已存在
  const accounts = await Storage.getAccounts();
  const existing = accounts.find(a => a.username === profile.username);
  if (existing) {
    // 更新已有账号的 Cookie 和 Profile
    await Storage.updateAccountState(existing.id, { cookies, profile, status: 'active' });
    return { success: true, username: profile.username, updated: true };
  }

  // 创建新账号（无密码和 2FA，仅 Cookie 方式切换）
  const id = await Storage.saveAccount({
    username: profile.username,
    password: '',
    totpSecret: '',
    cookies,
    profile,
    lastLogin: new Date().toISOString(),
    status: 'active'
  });

  return { success: true, username: profile.username, id, updated: false };
}

/** 获取当前 GitHub 登录状态 */
async function getCurrentStatus() {
  const validity = await Cookies.checkCookieValidity();
  return {
    loggedIn: validity.valid,
    username: validity.username || null
  };
}

/** 刷新所有 GitHub 标签页 — 导航到 github.com 首页以重新建立 session */
async function refreshGitHubTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  if (tabs.length > 0) {
    // 第一个标签页导航到首页（触发新 session），其余直接刷新
    await chrome.tabs.update(tabs[0].id, { url: 'https://github.com/' });
    for (let i = 1; i < tabs.length; i++) {
      chrome.tabs.reload(tabs[i].id);
    }
  }
}

/** 退出 GitHub 登录（清除所有 Cookie，导航到登录页） */
async function logoutGitHub() {
  try {
    // 先保存当前账号的 Cookie（如果能识别的话）
    await saveCurrentCookies();
  } catch { /* 静默 */ }

  // 清除所有 GitHub Cookie
  await Cookies.clearGitHubCookies();

  // 将所有 GitHub 标签页导航到 login 页（避免 CSRF 错误）
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  for (const tab of tabs) {
    await chrome.tabs.update(tab.id, { url: 'https://github.com/login' });
  }

  return { success: true };
}

// 监听标签页更新（用于跟踪登录流程）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!loginSessions.has(tabId)) return;
  if (!tab.url?.startsWith('https://github.com')) return;

  // 注入 Content Script 检测页面状态
  chrome.tabs.sendMessage(tabId, {
    target: 'content-login',
    action: 'detectPage'
  }).then(response => {
    if (response) {
      continueLoginFlow(tabId, response);
    }
  }).catch(() => {
    // Content Script 可能还没加载
  });
});

// 标签页关闭时清理 session
chrome.tabs.onRemoved.addListener((tabId) => {
  loginSessions.delete(tabId);
});
