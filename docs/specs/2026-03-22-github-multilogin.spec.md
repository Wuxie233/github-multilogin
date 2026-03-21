# Spec: GitHub MultiLogin — 浏览器扩展

## 做什么
- 开发 Chrome/Edge Manifest V3 浏览器扩展，支持在多个 GitHub 账号之间快速切换登录态
- 支持通过 `账号----密码----2FA密钥` 格式批量导入账号，自动完成 GitHub 登录流程
- 支持一键提取当前已登录 GitHub 账号的完整信息（用户名、头像、邮箱、组织列表、Cookie）并保存

## 不做什么
- 不做多账号并行登录（同一时刻只有一个 GitHub 账号活跃）
- 不做自动化风控验证码处理（遇到验证码/设备验证时提示用户手动处理）
- 不做服务器端同步（纯浏览器本地存储）
- 不做 Firefox 适配（仅 Manifest V3，Chrome + Edge）
- 不做 GitHub Enterprise 支持（仅 github.com）

## 技术栈
- 纯 HTML/CSS/JS，无构建工具
- Manifest V3（Service Worker + Content Scripts）
- chrome.storage.local 加密存储
- chrome.cookies API 管理 Cookie
- TOTP 生成（otpauth 或手写 HMAC-SHA1）

## 核心模块

### 1. 加密存储模块 (crypto.js)
- AES-GCM 加密，密钥由主密码 + PBKDF2 派生
- 主密码解锁后缓存到 chrome.storage.session（关闭浏览器自动清除）
- 加密对象：密码、2FA 密钥、Cookie

### 2. 账号管理 (accounts.js)
- 数据结构：`{ id, username, password(加密), totpSecret(加密), cookies(加密), profile, lastLogin, status }`
- profile：`{ avatar_url, email, name, orgs: [{login, avatar_url}] }`
- 批量导入：多行文本，每行 `账号----密码----2FA密钥`
- 导入/导出：JSON 格式，导出时仍为加密态

### 3. 自动登录 Content Script (login.js)
- 监听 github.com/login 页面
- 流程：填写用户名 → 填写密码 → 提交 → 检测 2FA 页面 → 生成 TOTP → 填写 → 提交
- 遇到风控页面（验证码、设备验证）时停止自动化，发消息通知 Popup 提示用户
- 登录成功后通知 Background 保存 Cookie

### 4. Cookie 管理 (cookies.js)
- 读取 `.github.com` 域下所有 Cookie
- 切换账号时：清除当前 GitHub Cookie → 注入目标账号的已保存 Cookie → 导航到 github.com 首页（重建 session）
- Cookie 有效性检测：通过 `chrome.cookies.get()` 读取 `dotcom_user` 和 `logged_in` Cookie 判断
  - **注意**：Service Worker 的 `fetch()` 不携带浏览器 Cookie，不能用 API 请求判断

### 5. Profile 提取 (profile.js)
- 从 `dotcom_user` Cookie 读取用户名
- 头像 URL 直接构造：`github.com/{username}.png?size=128`
  - **注意**：不从 DOM 提取，避免在他人仓库页面误取仓库作者头像

### 6. Background Service Worker (background.js)
- 协调 Content Script、Popup、Options 之间的消息
- 管理自动登录流程状态机
- Cookie 读写操作

### 7. Popup 弹窗 (popup.html/js)
- 主密码解锁界面
- 账号列表（头像 + 用户名 + 状态标签）
- 一键切换按钮
- 「保存当前账号」按钮
- 「退出 GitHub 登录」按钮（清除 Cookie + 导航到 /login，绕过 CSRF 表单）
- 当前活跃账号高亮

### 8. Options 管理页 (options.html/js)
- 账号增删改查
- 批量导入（文本框粘贴）
- 导入/导出 JSON
- 主密码修改
- 深色/浅色主题切换

## 边界条件
- 主密码为空时：禁止操作，强制引导设置
- Cookie 过期/失效时：标记账号状态为 "Cookie 失效"，点击切换时自动重新登录
- 2FA 密钥无效时：登录卡在 2FA 页面，提示用户检查密钥
- 无网络时：所有登录/提取操作提示错误
- GitHub 页面结构变更时：Content Script 选择器失效，提示用户更新扩展
- 导入格式错误时：逐行解析，跳过格式错误行并报告

## 错误处理
- 自动登录超时（30s 无响应）→ 终止并提示
- Cookie 注入失败 → 提示并建议重新登录
- 加密/解密失败 → 提示主密码错误
- GitHub API 限流 → 提示等待重试
- Content Script 注入失败 → 检查权限并提示

## 验收标准
1. 加载扩展到 Chrome，Popup 弹出正常，设置主密码流程完整
2. 粘贴 `user----pass----TOTP_SECRET` 格式文本，成功导入并加密存储
3. 点击账号「登录」→ 自动跳转 github.com/login → 自动填写并完成登录（含 2FA）
4. 登录成功后 Cookie 自动保存，头像/用户名/组织显示正确
5. 点击另一个账号「切换」→ Cookie 替换 → 页面刷新 → 新账号已登录
6. Cookie 失效时点击切换 → 自动走重新登录流程
7. 「保存当前账号」→ 成功提取并保存当前登录账号的完整信息
8. 导出 JSON → 数据加密态 → 导入到另一个浏览器 → 输入主密码后可用
9. 深色/浅色主题切换正常
10. 关闭浏览器重开 → 需要重新输入主密码
