/**
 * Content Script — GitHub 自动登录
 * 注入到 github.com/login 和 github.com/sessions/* 页面
 * 通过 message 接收 Background 的登录指令
 */

(function () {
  'use strict';

  // 与 Background 通信
  function sendMessage(action, data = {}) {
    return chrome.runtime.sendMessage({ source: 'content-login', action, ...data });
  }

  // 等待元素出现
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`元素 ${selector} 超时未出现`));
      }, timeout);
    });
  }

  // 模拟人类输入
  function simulateInput(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 延迟
  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // 随机延迟（模拟人类速度）
  function humanDelay(min = 300, max = 800) {
    return delay(min + Math.random() * (max - min));
  }

  // 检测当前页面类型
  function detectPage() {
    const path = window.location.pathname;
    if (path === '/login' || path === '/session') return 'login';
    if (path.includes('/sessions/two-factor')) return '2fa';
    if (path.includes('/sessions/verified-device') || path.includes('/sessions/recovery')) return 'device-verify';
    if (document.querySelector('[data-target="sudo-credential-options.content"]')) return 'sudo';
    return 'unknown';
  }

  // 检测是否登录成功
  function isLoggedIn() {
    return !!document.querySelector('meta[name="user-login"]')?.getAttribute('content');
  }

  // 获取当前登录用户名
  function getCurrentUsername() {
    return document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
  }

  /** 步骤 1: 填写用户名密码并提交 */
  async function fillLoginForm(username, password) {
    try {
      const loginField = await waitForElement('#login_field', 5000);
      const passwordField = await waitForElement('#password', 5000);

      await humanDelay(200, 500);
      simulateInput(loginField, username);
      await humanDelay(200, 500);
      simulateInput(passwordField, password);
      await humanDelay(300, 700);

      const submitBtn = document.querySelector('[type="submit"], .js-sign-in-button, input[name="commit"]');
      if (submitBtn) submitBtn.click();

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /** 步骤 2: 填写 2FA 验证码 */
  async function fill2FA(totpCode) {
    try {
      // GitHub 2FA 页面的输入框选择器
      const otpField = await waitForElement(
        '#app_totp, input[name="app_otp"], input[id*="totp"], input[autocomplete="one-time-code"]',
        5000
      );

      await humanDelay(300, 600);
      simulateInput(otpField, totpCode);
      await humanDelay(300, 500);

      // 点击提交
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) submitBtn.click();

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // 监听 Background 发来的指令
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== 'content-login') return;

    (async () => {
      try {
        switch (msg.action) {
          case 'detectPage':
            sendResponse({ page: detectPage(), loggedIn: isLoggedIn(), username: getCurrentUsername() });
            break;

          case 'fillLogin':
            const loginResult = await fillLoginForm(msg.username, msg.password);
            sendResponse(loginResult);
            break;

          case 'fill2FA':
            const tfaResult = await fill2FA(msg.totpCode);
            sendResponse(tfaResult);
            break;

          case 'checkLogin':
            sendResponse({ loggedIn: isLoggedIn(), username: getCurrentUsername() });
            break;

          default:
            sendResponse({ error: '未知指令: ' + msg.action });
        }
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();

    return true; // 保持 sendResponse 活跃
  });

  // 页面加载后自动通知 Background 当前状态
  if (document.readyState === 'complete') {
    sendMessage('pageReady', { page: detectPage(), loggedIn: isLoggedIn(), username: getCurrentUsername() });
  } else {
    window.addEventListener('load', () => {
      sendMessage('pageReady', { page: detectPage(), loggedIn: isLoggedIn(), username: getCurrentUsername() });
    });
  }
})();
