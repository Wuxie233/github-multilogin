# Plan: GitHub MultiLogin 浏览器扩展

> Spec: docs/specs/2026-03-22-github-multilogin.spec.md

## Phase 1: 项目骨架 + 加密模块

### 1.1 Manifest + 项目结构
- manifest.json (V3, permissions: cookies, storage, activeTab, scripting, host_permissions: github.com)
- 目录：src/, src/popup/, src/options/, src/background/, src/content/, src/lib/, icons/

### 1.2 加密模块 (src/lib/crypto.js)
- PBKDF2 派生密钥（主密码 + 随机 salt, 100K iterations）
- AES-256-GCM 加密/解密
- 主密码验证（加密一个已知标记值）
- Session 缓存（chrome.storage.session）

### 1.3 存储模块 (src/lib/storage.js)
- 账号 CRUD（chrome.storage.local）
- 加密写入/解密读取
- 导入/导出 JSON

## Phase 2: TOTP + Content Script 登录

### 2.1 TOTP 生成 (src/lib/totp.js)
- HMAC-SHA1 实现（Web Crypto API）
- Base32 解码
- 6 位 TOTP，30s 周期

### 2.2 Content Script (src/content/login.js)
- 匹配 github.com/login 和 github.com/sessions/two-factor*
- 自动填写用户名/密码
- 检测 2FA 页面 → 生成 TOTP → 填写
- 检测风控页面 → 通知放弃
- 登录成功检测 → 通知 Background

## Phase 3: Background + Cookie 管理

### 3.1 Background Service Worker (src/background/background.js)
- 消息路由（popup ↔ content ↔ background）
- 登录流程状态机
- Cookie 读取/注入/清除

### 3.2 Cookie 管理 (src/lib/cookies.js)
- 读取 .github.com 所有 Cookie
- 注入 Cookie Set
- 有效性检测
- Cookie 快照保存

## Phase 4: Profile 提取 + Popup + Options

### 4.1 Profile 提取 (src/lib/profile.js)
- 请求 github.com API 获取用户信息
- 提取组织列表

### 4.2 Popup (src/popup/)
- 主密码解锁
- 账号列表 + 切换
- 保存当前账号
- 状态指示

### 4.3 Options Page (src/options/)
- 账号管理
- 批量导入
- 导入/导出
- 主密码修改
- 主题切换

## Phase 5: Demo + 验收
- Popup 和 Options 的 HTML Demo 审核
- 功能端到端测试
