# dsh-cookie-pruner v0.1.1

![version](https://img.shields.io/badge/version-v0.1.1-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-DSH%20desktop-orange)

---

## 简介 / Introduction

**中文：** 一个 DSH（DeepSeek Harness）桌面端插件，用来绕开已知的 `dsh-auth-*` cookie 累积 bug——也就是那个大约启动 70 次后导致 **HTTP 431 / “Web authentication failed”、桌面直接打不开** 的问题。它会限制认证 cookie 生命周期、自动清理最旧的 `dsh-auth-*` cookie（保留最近 10 条），并提供应用内面板一键清理（保留最近 5 条）。纯 JavaScript，无需构建，不改 asar。

**English:** A DSH (DeepSeek Harness) desktop plugin that works around the known `dsh-auth-*` cookie pile-up bug — the one that causes **HTTP 431 / “Web authentication failed”** and makes the desktop fail to boot after ~70 launches. It caps the auth-cookie lifetime, automatically prunes the oldest `dsh-auth-*` cookies (keeping the newest 10), and ships an in-app dashboard with a one-click clean (keeping the newest 5). Pure JavaScript, no build step, no asar edits.

## 背景 / Background

**中文：** 对应视频：【十二人夬的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness"。根因：桌面端每次启动用一个随机端口，`dsh-auth-` cookie 名里绑了端口，所以**每次启动都多一条、且从不清理**；约 70 次启动后 Cookie 头超过 Node 16KB 上限，Host 直接回 431，桌面打不开。你的已装版本 `44.7.0`（nightly，2026/11/04 构建）**还未修复**，所以本插件用“绕开官方补丁”的方式解决。

**English:** Related video: 【十二人夬的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness". Root cause: the desktop host uses a random port on every launch, and the `dsh-auth-` cookie name is bound to that port, so **one new cookie is added each launch and never cleaned up**. After ~70 launches the Cookie header exceeds Node's 16 KiB limit, the host answers HTTP 431, and the desktop won't open. Your installed build `44.7.0` (nightly, built 2026/11/04) is **not yet fixed**, so this plugin works around the official patch.

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

## 三重防护 / Three layers of defense

1. **声明式兜底（必定生效）/ Declarative cap (always on):** 把 `connection.cookieMaxAgeDays` 从默认 30 天压到 **7 天**，旧 cookie 自己会过期，根本堆不到 16KB。 / Caps `connection.cookieMaxAgeDays` from the default 30 days down to **7 days**, so old cookies expire on their own and can never pile up to 16 KiB.
2. **运行时自动清理 / Runtime auto-prune:** DSH 活着时，插件读取 Electron Chromium cookie 库，检测 `dsh-auth-*` 数量，超过阈值就删最旧的、只留最近 10 条；并提供一个**应用内面板**显示当前总条数 + 一键清理（保留最近 5 条）。 / While DSH is live, the plugin reads the Electron Chromium cookie store, counts `dsh-auth-*` cookies, and when over the threshold removes the oldest ones keeping the newest 10; it also serves an **in-app dashboard** showing the total count + a one-click clean (keep newest 5).
3. **一次性离线清理 / One-shot offline cleanup:** 极端情况（运行时库读不到）下，完全退出 DSH 后跑 `cleanup-once.ps1`，把 Cookies 库重命名重建。 / For the worst case where the runtime store is unreachable, run `cleanup-once.ps1` with DSH fully closed to rename and rebuild the Cookies DB.

## 安装 / Installation

> ⚠️ **桌面端不能用 CLI 装插件。** `dsh plugin --profile desktop add ...` 会报错 `profile "desktop" is managed exclusively by the Electron application`。桌面端的插件只能通过应用内的「插件」页安装。
>
> ⚠️ **The desktop profile cannot be managed from the CLI.** `dsh plugin --profile desktop add ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. Install desktop plugins only through the in-app Plugins page.

**方式一 / Option 1（推荐，联网，GitHub 仓库）：**
- **中文：** 打开 DSH 桌面端 GUI → 左侧「插件 / Plugins」→ **Install a third-party plugin** → 在弹窗里粘贴仓库地址 `https://github.com/RAECYY/dsh-cookie-pruner.git`（或 `github:RAECYY/dsh-cookie-pruner`）→ 确认安装。仓库是纯 JavaScript（无 `dependencies`、无构建步骤），安装器会按 `package.json` 的 `dsh.bundle` 字段把它注册成桌面 bundle。
- **English:** Open the DSH desktop GUI → left sidebar **Plugins** → **Install a third-party plugin** → paste the repo URL `https://github.com/RAECYY/dsh-cookie-pruner.git` (or `github:RAECYY/dsh-cookie-pruner`) → confirm. It's pure JavaScript (no dependencies, no build); the installer registers it as a desktop bundle via the `dsh.bundle` field.

**方式二 / Option 2（无需联网，本地目录）：**
- **中文：** 同样在「插件」页 → **Install a third-party plugin** → 选择本地目录 `D:\AI\dsh-cookie-pruner`。
- **English:** Same Plugins page → **Install a third-party plugin** → pick the local directory `D:\AI\dsh-cookie-pruner`.

**方式三 / Option 3（手动兜底 / manual fallback）：** 若弹窗两种方式都失败，手动在 `C:\Users\ASUS\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加（注意用 `file:///` 而非裸 `C:/`）：

```yaml
- insert:
  - id: dsh-cookie-pruner-host
    name: 'file:///D:/AI/dsh-cookie-pruner/index.js'
```

**中文：** 装完请**完全退出并重启** DSH 桌面端（不是关掉这个聊天窗口，是把整个 DSH 应用退出再打开）。 / **English:** After installing, **fully quit and restart** the DSH desktop app (quit the whole app, not just this chat window, then reopen it).

## 验证 / Verification

1. **中文：** 打开 DSH GUI（端口每次启动可能变化；当前为 `http://127.0.0.1:41008`。在桌面端窗口标题或「设置 → 关于」里能看到真实地址，不要再照抄旧端口 53280）。 / **English:** Open the DSH GUI (the port changes between launches; currently `http://127.0.0.1:41008`. Find the real address in the window title or **Settings → About** — do not reuse the old `53280` port).
2. **中文：** 访问 `http://127.0.0.1:<你的端口>/dsh-cookie-pruner/` —— 面板显示当前 `dsh-auth-*` 总条数。 / **English:** Visit `http://127.0.0.1:<your-port>/dsh-cookie-pruner/` — the dashboard shows the current `dsh-auth-*` total count.
3. **中文：** 确认桌面能正常启动（不再 431）。 / **English:** Confirm the desktop boots normally (no more 431).
4. **中文：** **首装默认 `dryRun: true`（只统计、不删）**，请在面板确认数量读得对后，把 `dryRun` 改为 `false` 再重启。 / **English:** **On first install `dryRun: true` (count only, no deletion)** — after confirming the count is correct on the dashboard, set `dryRun` to `false` and restart.
5. **中文：** 点「一键清理（保留最近 5 条）」→ 数量应降到 5；把 `pruneThreshold` 调低并重启，确认自动清理生效（保留 10）。 / **English:** Click "One-click clean (keep newest 5)" → count should drop to 5; lower `pruneThreshold` and restart to confirm auto-prune works (keeps 10).

## 可调参数 / Configurable parameters (edit `DEFAULT_CONFIG` at the top of `index.js`)

| 参数 / Parameter | 默认 / Default | 说明 / Description |
|---|---|---|
| `cookieMaxAgeDays` | 7 | Layer A 兜底天数 / Layer A fallback days |
| `autoPrune` | true | 是否运行时自动清理 / Enable runtime auto-prune |
| `pruneThreshold` | 12 | 数量超过此值才自动清理 / Auto-prune when count exceeds this |
| `keepLatest` | 10 | 自动清理保留最近 N 条 / Keep newest N on auto-prune |
| `manualKeepLatest` | 5 | 面板按钮清理保留最近 N 条 / Keep newest N on manual clean |
| `dryRun` | true | **true=只统计不删**，确认无误后改 false / **true=count only, no delete**; set false after verifying |
| `checkIntervalMs` | 300000 | 自动清理间隔（5 分钟）/ Auto-prune interval (5 min) |
| `startDelayMs` | 30000 | 启动后延迟首次检查（30 秒）/ Delay before first check after startup (30 s) |

## 安全说明 / Safety

- **中文：** 所有清理只针对 **名称以 `dsh-auth-` 开头、且属于 `127.0.0.1` 本地** 的 cookie；绝不碰其它 cookie。 / **English:** All cleanup only touches cookies whose **name starts with `dsh-auth-` and belong to the local `127.0.0.1`** host; no other cookies are ever touched.
- **中文：** 当前会话那条永远是最新的，一定被保留。 / **English:** The current session's cookie is always the newest and is always kept.
- **中文：** 插件代码全部 `try/catch` 包裹，**加载失败也不会拖垮 DSH 桌面端**（否则整页打不开）。 / **English:** All plugin code is wrapped in `try/catch`; **even a load failure cannot break the DSH desktop** (otherwise the whole UI fails to open).
- **中文：** 不修改任何 asar / 程序文件；离线脚本只做重命名且保留 `.bak` 备份。 / **English:** No asar / program files are modified; the offline script only renames and keeps a `.bak` backup.

## 关于“设置页里的卡片” / About the "settings-page card"

**中文：** 原计划想做成 DSH「设置」里内嵌的 React 卡片，但确认你这套 0.2.2-rc.1 桌面 Host 里 `installSection` / `settings.plugin.item` 客户端插槽尚未就绪，且一个坏的客户端半侧会拖垮整个 Web UI。为安全起见，本版把“看数量 + 一键清理”做成了**同一 GUI 端口下的应用内面板页面**（`/dsh-cookie-pruner/`）。如果你希望进一步塞进「设置」页的卡片样式，可以再说。

**English:** The original plan was a React card embedded in DSH "Settings", but we confirmed that in your 0.2.2-rc.1 desktop Host the `installSection` / `settings.plugin.item` client slots are not yet ready, and a broken client half would take down the entire Web UI. For safety, this version implements "view count + one-click clean" as an **in-app dashboard page on the same GUI port** (`/dsh-cookie-pruner/`). If you'd like it moved into a Settings-page card later, just ask.

## License / 许可证

**MIT** — see [LICENSE](./LICENSE).
