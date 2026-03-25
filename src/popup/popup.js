/**
 * Popup 脚本 — 与 Background Service Worker 通信
 */

// === DOM 引用 ===
const $ = (id) => document.getElementById(id);

const screens = {
  setup: $('screen-setup'),
  unlock: $('screen-unlock'),
  main: $('screen-main')
};

// === 工具函数 ===
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response?.result ?? response);
      }
    });
  });
}

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

function showLoading(text = '处理中...') {
  $('loading-text').textContent = text;
  $('loading').style.display = 'flex';
}

function hideLoading() {
  $('loading').style.display = 'none';
}

function showError(id, msg) {
  const el = $(id);
  if (el) {
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, 3000);
  }
}

// === 主题 ===
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? '' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  chrome.storage.local.set({ theme: next || 'dark' });
}

async function loadTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

// === 初始化 ===
async function init() {
  await loadTheme();

  try {
    const hasPassword = await sendMessage({ action: 'hasMasterPassword' });
    if (!hasPassword) {
      showScreen('setup');
      return;
    }

    const unlocked = await sendMessage({ action: 'isUnlocked' });
    if (!unlocked) {
      showScreen('unlock');
      return;
    }

    await showMainScreen();
  } catch (e) {
    console.error('初始化失败:', e);
    showScreen('unlock');
  }
}

// === 设置主密码 ===
async function handleSetup() {
  const password = $('setup-password').value;
  const confirm = $('setup-confirm').value;

  if (!password) { showError('setup-error', '请输入密码'); return; }
  if (password.length < 4) { showError('setup-error', '密码至少 4 位'); return; }
  if (password !== confirm) { showError('setup-error', '两次密码不一致'); return; }

  try {
    showLoading('设置密码...');
    await sendMessage({ action: 'setMasterPassword', password });
    hideLoading();
    await showMainScreen();
  } catch (e) {
    hideLoading();
    showError('setup-error', e.message);
  }
}

// === 解锁 ===
async function handleUnlock() {
  const password = $('unlock-password').value;
  if (!password) { showError('unlock-error', '请输入密码'); return; }

  try {
    showLoading('解锁中...');
    await sendMessage({ action: 'unlock', password });
    hideLoading();
    await showMainScreen();
  } catch (e) {
    hideLoading();
    showError('unlock-error', e.message);
  }
}

// === 主界面 ===
async function showMainScreen() {
  showScreen('main');
  await refreshStatus();
  await refreshAccountList();
}

async function refreshStatus() {
  try {
    const status = await sendMessage({ action: 'getCurrentStatus' });
    const bar = $('status-bar');
    const text = $('status-text');

    if (status.loggedIn) {
      bar.className = 'status-bar';
      text.innerHTML = `当前登录: <strong>${escapeHtml(status.username)}</strong>`;
    } else {
      bar.className = 'status-bar offline';
      text.textContent = '未登录 GitHub';
    }
  } catch {
    const bar = $('status-bar');
    bar.className = 'status-bar unknown';
    $('status-text').textContent = '状态检测失败';
  }
}

async function refreshAccountList() {
  try {
    const accounts = await sendMessage({ action: 'getAccounts' });
    const list = $('account-list');
    const status = await sendMessage({ action: 'getCurrentStatus' });

    $('account-count').textContent = `账号列表 (${accounts.length})`;
    $('footer-count').textContent = `${accounts.length} 个账号`;

    if (accounts.length === 0) {
      list.innerHTML = '<div class="empty-state">暂无账号，请在管理页面添加</div>';
      return;
    }

    list.innerHTML = accounts.map(acc => {
      const isActive = status.loggedIn && status.username === acc.username;
      const avatarHtml = acc.profile?.avatar_url
        ? `<img class="account-avatar" src="${escapeHtml(acc.profile.avatar_url)}" alt="">`
        : `<div class="account-avatar-placeholder">${escapeHtml(acc.username[0].toUpperCase())}</div>`;

      let statusClass, statusText;
      if (isActive) { statusClass = 'status-active'; statusText = '活跃'; }
      else if (acc.cookies && acc.status !== 'cookie_expired') { statusClass = 'status-ready'; statusText = '就绪'; }
      else if (acc.status === 'cookie_expired') { statusClass = 'status-expired'; statusText = '过期'; }
      else { statusClass = 'status-new'; statusText = '新增'; }

      const orgsCount = acc.profile?.orgs?.length || 0;
      const email = acc.profile?.email || '';
      const metaParts = [];
      if (email) metaParts.push(escapeHtml(email));
      if (orgsCount > 0) metaParts.push(`${orgsCount} orgs`);

      return `
        <div class="account-item${isActive ? ' active' : ''}" data-id="${escapeHtml(acc.id)}">
          ${avatarHtml}
          <div class="account-info">
            <div class="account-name">${escapeHtml(acc.username)}</div>
            <div class="account-meta">${metaParts.join(' · ') || '无详细信息'}</div>
          </div>
          ${acc.totpSecret ? `<button class="btn-2fa" data-id="${escapeHtml(acc.id)}" title="复制 2FA 验证码">🔑</button>` : ''}
          <span class="account-status ${statusClass}">${statusText}</span>
        </div>
      `;
    }).join('');

    // 绑定点击事件
    list.querySelectorAll('.account-item').forEach(item => {
      item.addEventListener('click', () => handleAccountClick(item.dataset.id));
    });

    // 绑定 2FA 按钮
    list.querySelectorAll('.btn-2fa').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handle2FACopy(btn.dataset.id, btn);
      });
    });
  } catch (e) {
    console.error('刷新账号列表失败:', e);
  }
}

// === 账号操作 ===
async function handleAccountClick(accountId) {
  try {
    showLoading('切换中...');
    const result = await sendMessage({ action: 'switchAccount', accountId });
    hideLoading();

    if (result.success) {
      await refreshStatus();
      await refreshAccountList();
    } else if (result.error) {
      alert(result.error);
    }
  } catch (e) {
    hideLoading();
    alert('切换失败: ' + e.message);
  }
}

async function handleSaveCurrent() {
  try {
    showLoading('保存当前账号...');
    const result = await sendMessage({ action: 'saveCurrentAccount' });
    hideLoading();

    if (result.success) {
      await refreshAccountList();
      const msg = result.updated ? `已更新 ${result.username}` : `已保存 ${result.username}`;
      alert(msg);
    } else if (result.error) {
      alert(result.error);
    }
  } catch (e) {
    hideLoading();
    alert('保存失败: ' + e.message);
  }
}

function handleLock() {
  chrome.storage.session.remove('masterPassword', () => {
    showScreen('unlock');
    $('unlock-password').value = '';
  });
}

async function handleLogoutGitHub() {
  try {
    showLoading('退出登录...');
    await sendMessage({ action: 'logoutGitHub' });
    hideLoading();
    await refreshStatus();
    await refreshAccountList();
  } catch (e) {
    hideLoading();
    alert('退出失败: ' + e.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === 2FA 快速复制 ===
async function handle2FACopy(accountId, btnEl) {
  const originalText = btnEl.textContent;
  btnEl.disabled = true;
  try {
    const result = await sendMessage({ action: 'generateTOTP', accountId });
    await navigator.clipboard.writeText(result.code);
    btnEl.textContent = `✓ ${result.code}`;
    btnEl.classList.add('btn-2fa-copied');

    // 倒计时显示剩余秒数
    let remaining = result.remaining;
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        btnEl.textContent = originalText;
        btnEl.classList.remove('btn-2fa-copied');
        btnEl.disabled = false;
        return;
      }
      btnEl.textContent = `✓ ${result.code} (${remaining}s)`;
    }, 1000);

    // 3 秒后恢复按钮（不等到 TOTP 过期）
    setTimeout(() => {
      clearInterval(timer);
      btnEl.textContent = originalText;
      btnEl.classList.remove('btn-2fa-copied');
      btnEl.disabled = false;
    }, 3000);
  } catch (e) {
    btnEl.textContent = '✗';
    setTimeout(() => {
      btnEl.textContent = originalText;
      btnEl.disabled = false;
    }, 1500);
    console.error('2FA 复制失败:', e);
  }
}

// === Copilot 测活 ===
async function handleCopilotCheck() {
  const btn = $('btn-copilot-check');
  const resultEl = $('copilot-result');
  btn.disabled = true;
  resultEl.style.display = 'block';
  resultEl.className = 'copilot-result loading';
  resultEl.textContent = '检测 Copilot 状态中...';

  try {
    const result = await sendMessage({ action: 'checkCopilotStatus' });
    if (result.available) {
      resultEl.className = 'copilot-result success';
      resultEl.innerHTML = `✓ Copilot <strong>${escapeHtml(result.plan)}</strong> — ${escapeHtml(result.details)}`;
    } else {
      resultEl.className = 'copilot-result inactive';
      resultEl.innerHTML = `✗ ${escapeHtml(result.details || 'Copilot 未激活')}`;
    }
  } catch (e) {
    resultEl.className = 'copilot-result error';
    resultEl.textContent = '检测失败: ' + e.message;
  } finally {
    btn.disabled = false;
    // 8 秒后自动隐藏
    setTimeout(() => { resultEl.style.display = 'none'; }, 8000);
  }
}

// === 事件绑定 ===
document.addEventListener('DOMContentLoaded', init);

$('btn-setup')?.addEventListener('click', handleSetup);
$('btn-unlock')?.addEventListener('click', handleUnlock);
$('btn-theme')?.addEventListener('click', toggleTheme);
$('btn-save-current')?.addEventListener('click', handleSaveCurrent);
$('btn-copilot-check')?.addEventListener('click', handleCopilotCheck);
$('btn-logout-github')?.addEventListener('click', handleLogoutGitHub);
$('btn-lock')?.addEventListener('click', handleLock);
$('btn-manage')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
$('btn-options')?.addEventListener('click', () => chrome.runtime.openOptionsPage());

// 回车键支持
$('unlock-password')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleUnlock();
});
$('setup-confirm')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSetup();
});

// 监听登录状态更新
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'loginStatus') {
    hideLoading();
    if (msg.status === 'success') {
      refreshStatus();
      refreshAccountList();
    } else if (msg.status === 'error') {
      alert(msg.message);
      refreshStatus();
    } else if (msg.status === 'device_verify_required') {
      alert(msg.message);
    }
  }
});
