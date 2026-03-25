/**
 * Options 页 — 账号管理、导入/导出、安全设置、主题
 */

const $ = (id) => document.getElementById(id);

// === 工具函数 (sendMessage / escapeHtml / escapeAttr 已移至 ../lib/utils.js) ===

function showMsg(elId, text, type = 'error') {
  const el = $(elId);
  if (!el) return;
  el.textContent = text;
  el.className = type === 'success' ? 'success-msg' : 'error-msg';
  if (type !== 'persist') {
    setTimeout(() => { el.textContent = ''; }, 4000);
  }
}

function showResult(elId, text, success) {
  const el = $(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'import-result ' + (success ? 'success' : 'error');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// === Tab 导航 ===
function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  const tab = $(`tab-${tabName}`);
  if (nav) nav.classList.add('active');
  if (tab) tab.classList.add('active');
}

document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});

// === 主题 ===
async function loadTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  updateThemeSelection(theme || 'dark');
}

function updateThemeSelection(value) {
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.themeValue === value);
  });
}

document.querySelectorAll('.theme-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const value = opt.dataset.themeValue;
    document.documentElement.setAttribute('data-theme', value === 'light' ? 'light' : '');
    chrome.storage.local.set({ theme: value });
    updateThemeSelection(value);
  });
});

// === 解锁 ===
async function checkLockState() {
  try {
    const hasPassword = await sendMessage({ action: 'hasMasterPassword' });
    if (!hasPassword) {
      // 没有主密码 → 跳到安全设置让用户先设置
      $('unlock-overlay').classList.add('hidden');
      switchTab('security');
      return;
    }
    const unlocked = await sendMessage({ action: 'isUnlocked' });
    if (unlocked) {
      $('unlock-overlay').classList.add('hidden');
      refreshAccounts();
    }
  } catch {
    // 保持锁定状态
  }
}

$('btn-options-unlock').addEventListener('click', async () => {
  const pw = $('options-unlock-pw').value;
  if (!pw) return;
  try {
    await sendMessage({ action: 'unlock', password: pw });
    $('unlock-overlay').classList.add('hidden');
    refreshAccounts();
  } catch (e) {
    showMsg('options-unlock-error', '密码错误');
  }
});

$('options-unlock-pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-options-unlock').click();
});

// === 账号列表 ===
async function refreshAccounts() {
  const tbody = $('accounts-tbody');
  try {
    const accounts = await sendMessage({ action: 'getAccounts' });
    if (!accounts || accounts.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">暂无账号，请前往「批量导入」添加</td></tr>';
      return;
    }
    tbody.innerHTML = accounts.map(acc => {
      const avatar = acc.profile?.avatar_url
        ? `<img src="${escapeAttr(acc.profile.avatar_url)}" class="table-avatar" alt="">`
        : `<div class="table-avatar-placeholder">${escapeHtml((acc.username || '?')[0].toUpperCase())}</div>`;
      const statusBadge = getStatusBadge(acc.status);
      const has2FA = acc.totpSecret ? '✓' : '—';
      const lastLogin = acc.lastLogin ? formatTime(acc.lastLogin) : '—';
      return `
        <tr data-id="${escapeAttr(acc.id)}">
          <td><div class="table-user">${avatar}<span class="table-username">${escapeHtml(acc.username)}</span></div></td>
          <td>${statusBadge}</td>
          <td>${has2FA}</td>
          <td style="color:var(--text-secondary);font-size:12px">${lastLogin}</td>
          <td>
            <div class="table-actions">
              <button class="table-btn delete" data-action="delete" data-id="${escapeAttr(acc.id)}" title="删除">
                <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19a1.75 1.75 0 001.741-1.575l.66-6.6a.75.75 0 00-1.492-.15l-.66 6.6a.25.25 0 01-.249.225h-5.19a.25.25 0 01-.249-.225l-.66-6.6z"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">加载失败，请刷新页面</td></tr>';
  }
}

function getStatusBadge(status) {
  switch (status) {
    case 'active': return '<span class="badge badge-active">活跃</span>';
    case 'ready': return '<span class="badge badge-ready">就绪</span>';
    case 'expired': return '<span class="badge badge-expired">过期</span>';
    default: return '<span class="badge badge-new">新增</span>';
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 事件委托 — 删除
$('accounts-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (!confirm('确定删除该账号？此操作不可撤销。')) return;
  try {
    await sendMessage({ action: 'deleteAccount', id });
    refreshAccounts();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
});

// === 批量导入 ===
$('btn-import').addEventListener('click', async () => {
  const text = $('import-text').value.trim();
  if (!text) return;
  try {
    const result = await sendMessage({ action: 'importFromText', text });
    showResult('import-result', `成功导入 ${result.imported} 个账号` +
      (result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ''), true);
    $('import-text').value = '';
    refreshAccounts();
  } catch (err) {
    showResult('import-result', '导入失败: ' + err.message, false);
  }
});

$('btn-import-clear').addEventListener('click', () => {
  $('import-text').value = '';
});

// === JSON 导出 ===
$('btn-export').addEventListener('click', async () => {
  try {
    const data = await sendMessage({ action: 'exportToJSON' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `github-multilogin-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('导出失败: ' + err.message);
  }
});

// === JSON 导入 ===
$('btn-import-json').addEventListener('click', async () => {
  const file = $('import-file').files[0];
  if (!file) {
    showResult('json-import-result', '请先选择文件', false);
    return;
  }
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const result = await sendMessage({ action: 'importFromJSON', json });
    showResult('json-import-result', `成功导入 ${result.imported} 个账号`, true);
    refreshAccounts();
  } catch (err) {
    showResult('json-import-result', '导入失败: ' + err.message, false);
  }
});

// === 修改密码 ===
$('btn-change-pw').addEventListener('click', async () => {
  const oldPw = $('old-password').value;
  const newPw = $('new-password').value;
  const confirmPw = $('new-password-confirm').value;

  if (!oldPw || !newPw) {
    showMsg('change-pw-msg', '请填写所有字段');
    return;
  }
  if (newPw !== confirmPw) {
    showMsg('change-pw-msg', '两次输入的新密码不一致');
    return;
  }
  if (newPw.length < 8) {
    showMsg('change-pw-msg', '新密码至少 8 个字符');
    return;
  }
  try {
    await sendMessage({ action: 'changeMasterPassword', oldPassword: oldPw, newPassword: newPw });
    showMsg('change-pw-msg', '密码已更新', 'success');
    $('old-password').value = '';
    $('new-password').value = '';
    $('new-password-confirm').value = '';
  } catch (err) {
    showMsg('change-pw-msg', '修改失败: ' + err.message);
  }
});

// === 清除数据 ===
$('btn-clear-all').addEventListener('click', async () => {
  if (!confirm('⚠️ 确定清除所有数据？\n\n包括所有账号、Cookie 和主密码。此操作不可撤销！')) return;
  if (!confirm('再次确认：真的要删除所有数据吗？')) return;
  try {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    alert('已清除所有数据。页面将刷新。');
    location.reload();
  } catch (err) {
    alert('清除失败: ' + err.message);
  }
});

// === XSS 防护 (escapeHtml / escapeAttr 已移至 ../lib/utils.js) ===

// === 初始化 ===
loadTheme();
checkLockState();
