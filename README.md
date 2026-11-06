# dsh-cookie-pruner v0.1.0

![version](https://img.shields.io/badge/version-v0.1.0-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-DSH%20desktop-orange)

**English:** A DSH (DeepSeek Harness) desktop plugin that works around the known `dsh-auth-*` cookie pile-up bug — the one that causes **HTTP 431 / “Web authentication failed”** and makes the desktop fail to boot after ~70 launches. It caps the auth-cookie lifetime, automatically prunes the oldest `dsh-auth-*` cookies (keeping the newest 10), and ships an in-app dashboard with a one-click clean (keeping the newest 5). Pure JavaScript, no build step, no asar edits.

**中文：** 一个 DSH（DeepSeek Harness）桌面端插件，用来绕开已知的 `dsh-auth-*` cookie 累积 bug——也就是那个大约启动 70 次后导致 **HTTP 431 / “Web authentication failed”、桌面直接打不开** 的问题。它会限制认证 cookie 生命周期、自动清理最旧的 `dsh-auth-*` cookie（保留最近 10 条），并提供应用内面板一键清理（保留最近 5 条）。纯 JavaScript，无需构建，不改 asar。

---

DSH 桌面端 `dsh-auth-*` cookie 累积导致 **HTTP 431 / “Web authentication failed” 启动崩溃** 的缓解插件（就是视频里那个 bug）。

对应视频：【十二人夬的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness"。
根因：桌面端每次启动用一个随机端口，`dsh-auth-` cookie 名里绑了端口，所以**每次启动都多一条、且从不清理**；约 70 次启动后 Cookie 头超过 Node 16KB 上限，Host 直接回 431，桌面打不开。

> 你的已装版本 `44.7.0`（nightly，2026/11/04 构建）**还未修复**，所以本插件用“绕开官方补丁”的方式解决。

## 仓库文件说明 / What each file does

| 文件 / File | 作用（中文） | Purpose (English) |
|---|---|---|
| `index.js` | **插件主体**（Host 半边）：运行时自动清理 + 应用内面板路由 `/dsh-cookie-pruner/`，含全部可调参数（`DEFAULT_CONFIG`） | **Main plugin** (Host half): runtime auto-prune + in-app dashboard route `/dsh-cookie-pruner/`, all tunables in `DEFAULT_CONFIG` |
| `cordis.patch.yml` | 声明式补丁：限制 `connection.cookieMaxAgeDays: 7`（Layer A 兜底）+ 注册插件本体 | Declarative patch: caps `connection.cookieMaxAgeDays: 7` (Layer A) + registers the plugin entry |
| `package.json` | 插件元数据（名称/版本/入口/`dsh.bundle.patch` 指向 patch 文件） | Plugin metadata (name/version/entry; `dsh.bundle.patch` points to the patch file) |
| `cleanup-once.ps1` | **一次性离线清理脚本**：完全退出 DSH 后运行，把 Chromium Cookies 库改名 `.bak`，重启即重建干净库（Layer C） | One-shot offline cleanup: run with DSH fully closed; renames the Chromium Cookies DB so DSH rebuilds a clean one (Layer C) |
| `README.md` | 本说明文档 | This documentation |
| `LICENSE` | MIT 开源许可证 | MIT license |
| `.gitignore` | Git 忽略清单 | Git ignore list |

## 三重防护

1. **声明式兜底（必定生效）**：把 `connection.cookieMaxAgeDays` 从默认 30 天压到 **7 天**，旧 cookie 自己会过期，根本堆不到 16KB。
2. **运行时自动清理**：DSH 活着时，插件读取 Electron Chromium cookie 库，检测 `dsh-auth-*` 数量，超过阈值就删最旧的、只留最近 10 条；并提供一个**应用内面板**显示当前总条数 + 一键清理（保留最近 5 条）。
3. **一次性离线清理**：极端情况（运行时库读不到）下，完全退出 DSH 后跑 `cleanup-once.ps1`，把 Cookies 库重命名重建。

## 安装

```powershell
# 方式一：本地 link（推荐，无需联网）
dsh plugin --profile desktop add link:D:\AI\dsh-cookie-pruner
```

若 CLI 不支持 `link:`，用桌面端「插件」页 → **Install a third-party plugin** → 选本地目录 `D:\AI\dsh-cookie-pruner`。
仍不行则手动在 `C:\Users\ASUS\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加（注意用 `file:///` 而非裸 `C:/`）：

```yaml
- insert:
  - id: dsh-cookie-pruner-host
    name: 'file:///D:/AI/dsh-cookie-pruner/index.js'
```

**装完请完全退出并重启 DSH 桌面端。**

## 验证

1. 打开 DSH GUI（你的是 `http://127.0.0.1:53280`）。
2. 访问 `http://127.0.0.1:53280/dsh-cookie-pruner/` —— 面板显示当前 `dsh-auth-*` 总条数。
3. 确认桌面能正常启动（不再 431）。
4. **首装默认 `dryRun: true`（只统计、不删）**，请在面板或设置确认数量读得对后，把 `dryRun` 改为 `false` 再重启。
5. 点「一键清理（保留最近 5 条）」→ 数量应降到 5；把 `pruneThreshold` 调低并重启，确认自动清理生效（保留 10）。

## 可调参数（编辑 `index.js` 顶部的 `DEFAULT_CONFIG`）

| 参数 | 默认 | 说明 |
|---|---|---|
| `cookieMaxAgeDays` | 7 | Layer A 兜底天数 |
| `autoPrune` | true | 是否运行时自动清理 |
| `pruneThreshold` | 12 | 数量超过此值才自动清理 |
| `keepLatest` | 10 | 自动清理保留最近 N 条 |
| `manualKeepLatest` | 5 | 面板按钮清理保留最近 N 条 |
| `dryRun` | true | **true=只统计不删**，确认无误后改 false |
| `checkIntervalMs` | 300000 | 自动清理间隔（5 分钟） |
| `startDelayMs` | 30000 | 启动后延迟首次检查（30 秒） |

## 安全说明

- 所有清理只针对 **名称以 `dsh-auth-` 开头、且属于 `127.0.0.1` 本地** 的 cookie；绝不碰其它 cookie。
- 当前会话那条永远是最新的，一定被保留。
- 插件代码全部 `try/catch` 包裹，**加载失败也不会拖垮 DSH 桌面端**（否则整页打不开）。
- 不修改任何 asar / 程序文件；离线脚本只做重命名且保留 `.bak` 备份。

## 关于“设置页里的卡片”

原计划想做成 DSH「设置」里内嵌的 React 卡片，但确认你这套 0.2.2-rc.1 桌面 Host 里 `installSection` / `settings.plugin.item` 客户端插槽尚未就绪，且一个坏的客户端半侧会拖垮整个 Web UI。
为安全起见，本版把“看数量 + 一键清理”做成了**同一 GUI 端口下的应用内面板页面**（`/dsh-cookie-pruner/`，也就是“在 DSH 里面看/清理”）。如果你希望进一步塞进「设置」页的卡片样式，可以再说，我再尝试客户端半侧（带 dryRun 验证）。
