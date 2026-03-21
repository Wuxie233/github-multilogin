# GitHub MultiLogin

Chrome/Edge 浏览器扩展 — 在多个 GitHub 账号之间快速切换登录态。

## 功能

- **批量导入账号** — 粘贴 `账号----密码----2FA密钥` 格式文本，一键导入
- **自动登录** — 自动填写用户名、密码、2FA 验证码完成 GitHub 登录
- **Cookie 切换** — 已登录账号通过 Cookie 注入秒切，无需重新登录
- **保存当前账号** — 一键提取当前已登录 GitHub 账号的 Cookie 和用户信息
- **安全存储** — AES-256-GCM 加密，主密码 PBKDF2 派生，关闭浏览器自动锁定
- **深色/浅色主题** — Popup 和 Options 页面双主题支持

## 安装

1. 下载或克隆本仓库
2. 打开 `chrome://extensions`（或 `edge://extensions`）
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择项目根目录

## 使用

### 首次使用
1. 点击扩展图标，设置主密码
2. 点击「管理」进入 Options 页面（或右键扩展 → 选项）
3. 在「批量导入」标签页粘贴账号信息：
   ```
   username1----password1----TOTP_SECRET_1
   username2----password2----TOTP_SECRET_2
   ```
4. 点击「导入」

### 切换账号
- 点击 Popup 中的账号即可切换
- 有 Cookie 的账号会直接注入并刷新页面
- 没有 Cookie 的账号会自动打开登录页完成登录

### 保存当前登录账号
- 在已登录 GitHub 的状态下，点击 Popup 中的「保存当前」按钮
- 自动提取用户名、头像和 Cookie 并保存

### 退出登录
- 点击 Popup 中的「退出登录」按钮
- 清除所有 GitHub Cookie 并导航到登录页

## 技术栈

- Manifest V3（Service Worker + Content Scripts）
- 纯 HTML/CSS/JS，无构建工具
- AES-256-GCM + PBKDF2（Web Crypto API）
- TOTP HMAC-SHA1（Web Crypto API）
- chrome.cookies / chrome.storage / chrome.scripting API

## 项目结构

```
├── manifest.json
├── icons/                        # 扩展图标
├── src/
│   ├── lib/
│   │   ├── crypto.js             # AES-GCM 加密 + 主密码管理
│   │   ├── totp.js               # TOTP 生成 + 凭证解析
│   │   ├── storage.js            # 账号 CRUD + 批量导入
│   │   ├── cookies.js            # GitHub Cookie 管理
│   │   └── profile.js            # 用户信息提取
│   ├── background/
│   │   └── background.js         # Service Worker 消息路由 + 登录状态机
│   ├── content/
│   │   └── login.js              # 登录页自动填充
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── options/
│       ├── options.html
│       ├── options.css
│       └── options.js
├── prototype/                    # HTML Demo（设计审核用）
└── docs/
    ├── specs/                    # 功能规格
    └── plans/                    # 开发计划
```

## 已知限制

- Service Worker 的 `fetch()` 不携带浏览器 Cookie，用户信息通过 `dotcom_user` Cookie 获取
- Cookie 切换后需要导航到 github.com 首页（重建 session），直接 reload 会触发 CSRF 保护
- 遇到 GitHub 风控验证码、设备验证时需要用户手动完成
- 仅支持 github.com，不支持 GitHub Enterprise
