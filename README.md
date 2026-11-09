# dsh-cookie-pruner v0.1.5

![version](https://img.shields.io/badge/version-v0.1.5-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-DSH%20desktop-orange)

---

## 简介 / Introduction

**中文：** 一个 DSH（DeepSeek Harness）桌面端插件，用来绕开已知的 `dsh-auth-*` cookie 累积 bug——也就是那个大约启动 70 次后导致 **HTTP 431 / "Web authentication failed"、桌面直接打不开** 的问题。它会限制认证 cookie 生命周期、自动清理最旧的 `dsh-auth-*` cookie（保留最近 10 条），并在 **DSH 左下角账户头像 → 设置（Settings）对话框里新增一个「Cookie 清理」分区**，显示当前条数、运行时状态与一个**真正的「一键清理」按钮**（保留最近 5 条）。纯 JavaScript，无需构建，不改 asar。

**English:** A DSH (DeepSeek Harness) desktop plugin that works around the known `dsh-auth-*` cookie pile-up bug — the one that causes **HTTP 431 / "Web authentication failed"** and makes the desktop fail to boot after ~70 launches. It caps the auth-cookie lifetime, automatically prunes the oldest `dsh-auth-*` cookies (keeping the newest 10), and adds a **"Cookie 清理" section to the bottom-left account avatar → Settings dialog** showing the live count, runtime status and a **real one-click clean button** (keep newest 5). Pure JavaScript, no build step, no asar edits.

## 背景 / Background

**中文：** 对应视频：【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness"。根因：桌面端每次启动用一个随机端口，`dsh-auth-` cookie 名里绑了端口，所以**每次启动都多一条、且从不清理**；约 70 次启动后 Cookie 头超过 Node 16KB 上限，Host 直接回 431，桌面打不开。已测版本 `44.7.0`（nightly，2026/11/04 构建）**仍未修复**，所以本插件用"绕开官方补丁"的方式解决。

**English:** Related video: 【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness". Root cause: the desktop host uses a random port on every launch, and the `dsh-auth-` cookie name is bound to that port, so **one new cookie is added each launch and never cleaned up**. After ~70 launches the Cookie header exceeds Node's 16 KiB limit, the host answers HTTP 431, and the desktop won't open. The tested build `44.7.0` (nightly, built 2026/11/04) is **not yet fixed**, so this plugin works around the official patch.

## 仓库文件说明 / What each file does

| 文件 / File | 作用（中文） | Purpose (English) |
|---|---|---|
| `index.js` | **插件主体（Host 半边）**：运行时自动清理 + 把条数/状态写进 `settings` 服务 + 响应一键清理，含全部可调参数（`DEFAULT_CONFIG`） | **Main plugin (Host half)**: runtime auto-prune + writes count/status into the `settings` service + reacts to the clean button; all tunables in `DEFAULT_CONFIG` |
| `client.js` | **浏览器（Client）半边**：用 `settings.section` 插槽把「Cookie 清理」分区注册进「账户 → 设置」对话框，读取并回写表单 | **Browser (Client) half**: registers the "Cookie 清理" section into the account → Settings dialog via the `settings.section` slot, reads and writes the form |
| `cordis.patch.yml` | 声明式补丁：限制 `connection.cookieMaxAgeDays: 7`（Layer A 兜底）+ 注册插件本体 | Declarative patch: caps `connection.cookieMaxAgeDays: 7` (Layer A) + registers the plugin entry |
| `package.json` | 插件元数据：`exports`（含 `./client`）、`dsh.bundle.platforms/patch`、`dsh.client`、`@deepseek-ai/schemastery` 依赖 | Plugin metadata: `exports` (incl. `./client`), `dsh.bundle.platforms/patch`, `dsh.client`, the `@deepseek-ai/schemastery` dependency |
| `cleanup-once.ps1` | **一次性离线清理脚本**：完全退出 DSH 后运行，把 Chromium Cookies 库改名 `.bak`，重启即重建干净库（Layer C） | One-shot offline cleanup: run with DSH fully closed; renames the Chromium Cookies DB so DSH rebuilds a clean one (Layer C) |
| `README.md` | 本说明文档 | This documentation |
| `LICENSE` | MIT 开源许可证 | MIT license |
| `.gitignore` | Git 忽略清单 | Git ignore list |

## 三重防护 / Three layers of defense

1. **声明式兜底（必定生效）/ Declarative cap (always on):** 把 `connection.cookieMaxAgeDays` 从默认 30 天压到 **7 天**，旧 cookie 自己会过期，根本堆不到 16KB。 / Caps `connection.cookieMaxAgeDays` from the default 30 days down to **7 days**, so old cookies expire on their own and can never pile up to 16 KiB.
2. **运行时自动清理 / Runtime auto-prune:** DSH 活着时，插件读取 Electron Chromium cookie 库，检测 `dsh-auth-*` 数量，超过阈值就删最旧的、只留最近 10 条；同时把**当前总条数**推送到「账户 → 设置」里的「Cookie 清理」分区，并提供一键清理按钮（保留最近 5 条）。 / While DSH is live, the plugin reads the Electron Chromium cookie store, counts `dsh-auth-*` cookies, and when over the threshold removes the oldest ones keeping the newest 10; it also pushes the **live count** into the "Cookie 清理" section of account → Settings and offers a one-click clean button (keep newest 5).
3. **一次性离线清理 / One-shot offline cleanup:** 极端情况（运行时库读不到）下，完全退出 DSH 后跑 `cleanup-once.ps1`，把 Cookies 库重命名重建。 / For the worst case where the runtime store is unreachable, run `cleanup-once.ps1` with DSH fully closed to rename and rebuild the Cookies DB.

## 安装 / Installation

> ⚠️ **桌面端不能用 CLI 装插件。** `dsh plugin --profile desktop add ...` 会报错 `profile "desktop" is managed exclusively by the Electron application`。桌面端的插件只能通过应用内的「插件」页安装。
>
> ⚠️ **The desktop profile cannot be managed from the CLI.** `dsh plugin --profile desktop add ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. Install desktop plugins only through the in-app Plugins page.

**方式一 / Option 1（推荐，联网，GitHub 仓库）：**
- **中文：** 打开 DSH 桌面端 GUI → 左侧「插件 / Plugins」→ **Install a third-party plugin** → 在弹窗里粘贴仓库地址 `https://github.com/RAECYY/dsh-cookie-pruner.git`（或 `github:RAECYY/dsh-cookie-pruner`）→ 确认安装。安装器会自动 `pnpm add` 依赖（`@deepseek-ai/schemastery`），并按 `package.json` 的 `dsh.bundle` 字段注册成桌面 bundle；`dsh.client` + `exports["./client"]` 会让浏览器半边一起被加载。
- **English:** Open the DSH desktop GUI → left sidebar **Plugins** → **Install a third-party plugin** → paste the repo URL `https://github.com/RAECYY/dsh-cookie-pruner.git` (or `github:RAECYY/dsh-cookie-pruner`) → confirm. The installer runs `pnpm add` for dependencies (`@deepseek-ai/schemastery`) and registers it as a desktop bundle via `dsh.bundle`; `dsh.client` + `exports["./client"]` make the browser half load too.

**方式二 / Option 2（无需联网，本地目录）：**
- **中文：** 同样在「插件」页 → **Install a third-party plugin** → 选择本地目录 `D:\\AI\\dsh-cookie-pruner`。若走 `file:///` 手动注册（方式三），请先在该目录执行一次 `pnpm add @deepseek-ai/schemastery`（本仓库已内置 `node_modules` 时无需再跑）。
- **English:** Same Plugins page → **Install a third-party plugin** → pick the local directory `D:\\AI\\dsh-cookie-pruner`. If you register manually via `file:///` (Option 3), run `pnpm add @deepseek-ai/schemastery` once in that directory first (skip it if `node_modules` already exists).

**方式三 / Option 3（手动兜底 / manual fallback）：** 若弹窗两种方式都失败，手动在 `C:\\Users\\ASUS\\.dsh\\profiles\\desktop\\cordis.patch.yml` 末尾追加（注意用 `file:///` 而非裸 `C:/`）：

```yaml
- insert:
  - id: dsh-cookie-pruner-host
    name: 'file:///D:/AI/dsh-cookie-pruner/index.js'
```

> **中文：** `file:///` 指向单个 JS 文件也能被识别：DSH 的 client-modules 会从该文件向上找到最近的 `package.json`（即本仓库的 `package.json`），据此发现 `dsh.client` 声明并加载 `client.js`。所以**不必改注册行**，只要 `package.json` 里的 `exports["./client"]` 与同目录的 `client.js` 存在即可。
>
> **English:** A `file:///` URL pointing at a single JS file still works: DSH's client-modules walks up from that file to the nearest `package.json` (this repo's), discovers the `dsh.client` declaration and loads `client.js`. So **no need to change the registration row** — just keep `exports["./client"]` in `package.json` and `client.js` next to it.

**中文：** 装完请**完全退出并重启** DSH 桌面端（不是关掉这个聊天窗口，是把整个 DSH 应用退出再打开）。 / **English:** After installing, **fully quit and restart** the DSH desktop app (quit the whole app, not just this chat window, then reopen it).

## 验证 / Verification

> **中文：** ✅ 面板现在就在**左下角账户头像 → 设置**里。v0.1.4 起，插件带一个浏览器半边（`client.js`），通过 `settings.section` 插槽向「设置」对话框贡献了一个真正的导航项「**Cookie 清理**」和一个带按钮的面板。这和之前 v0.1.2/v0.1.3 的自动表单不同——那个只在「插件」侧边栏的详情页里、很难找到，现已不再依赖它。
>
> **English:** ✅ The panel now lives in **bottom-left account avatar → Settings**. Since v0.1.4 the plugin ships a browser half (`client.js`) that contributes a real nav entry "**Cookie 清理**" plus a button panel to the Settings dialog via the `settings.section` slot. This is different from the v0.1.2/v0.1.3 auto-form, which only appeared on the plugin's detail page in the Plugins sidebar and was hard to find — it is no longer relied upon.

1. **中文：** 装完重启后，点 **左下角账户头像 → 设置（Ctrl+,）**，在左侧导航里找到「**Cookie 清理**」（排在「通用设置」和「模型」之间）。 / **English:** After restarting, click **bottom-left account avatar → Settings (Ctrl+,)** and find "**Cookie 清理**" in the left nav (between 通用设置 and 模型).
2. **中文：** 面板会显示：`当前认证 Cookie 条数`、`运行时存储`（可用/不可用）、`模式`（干跑 / 生效）、`上次清理结果`，以及一个「**一键清理（保留最近 5 条）**」按钮。 / **English:** The panel shows the live count, runtime-store status, mode (dry-run / active), last result, and a "**一键清理（保留最近 5 条）**" button.
3. **中文：** **首装默认 `dryRun: true`（只统计、不删）**。先确认条数合理、`运行时存储 = 可用`，再把 `index.js` 里 `DEFAULT_CONFIG.dryRun` 改为 `false` 并重启 DSH。 / **English:** **On first install `dryRun: true` (count only, no deletion).** Confirm the count looks right and `运行时存储 = 可用`, then set `DEFAULT_CONFIG.dryRun` to `false` in `index.js` and restart DSH.

> **中文（v0.1.5 修复「显示零个」）：** 之前启动后「Cookie 清理」分区会显示 **当前条数 = 0 / 运行时存储 = 不可用**。这不是真正的空库，而是刚启动时 Electron cookie 库尚未就绪，首次读取返回空或抛错，而当时没有重试、也没有周期刷新，于是这个失败值被冻结了。v0.1.5 做了三处修复：① 读取前先 `await session.defaultSession.cookies.ready`（带 5 秒超时兜底）；② `readAuthCookiesWithRetry()` 连续重试 5 次、每次间隔 1 秒；③ 新增每 15 秒的 `countPollMs` 周期发布，让任何早期的瞬时失败都能自愈，条数也会持续保持最新。若仍显示「不可用」，面板会直接在「上次结果」里给出读取出错原因（例如 `electron not importable` 或 `cookies.get failed: ...`），便于排查。
>
> **English (v0.1.5 fixes the "shows zero" issue):** Earlier, right after launch the "Cookie 清理" section showed **count = 0 / store = unavailable**. That was not an empty store — it was the Electron cookie store not being ready yet on a fresh launch, so the first read returned empty or threw, and because there was no retry and no periodic refresh the failed value got frozen. v0.1.5 fixes this three ways: ① `await session.defaultSession.cookies.ready` (with a 5 s timeout fallback) before reading; ② `readAuthCookiesWithRetry()` retries up to 5 times, 1 s apart; ③ a new `countPollMs` (15 s) periodic publisher so any early transient failure self-heals and the count stays fresh. If it still says "unavailable", the panel now surfaces the read error directly in "lastResult" (e.g. `electron not importable` or `cookies.get failed: ...`) for easy diagnosis.
4. **中文：** 点「一键清理」→ 几秒内插件会清理到只剩最近 5 条，条数随之下降，结果框显示"已删除 N 条，保留 M 条"。 / **English:** Click the clean button → within seconds the plugin prunes down to the newest 5, the count drops and the result box reports "removed N, kept M".
5. **中文：** 确认桌面能正常启动（不再 431）。 / **English:** Confirm the desktop boots normally (no more 431).

> **中文：** Host 与 Client 之间的 5 个字段（`lastCount` / `available` / `dryRun` / `cleanRequest` / `lastResult`）是**运行时状态**（volatile），只写进当前 profile 的内存配置、不持久化到 YAML；插件每次启动都会重新计算 `lastCount`。真正需要持久的开关是 `autoPrune` / `dryRun` 等，改 `index.js` 的 `DEFAULT_CONFIG` 或在 `cordis.patch.yml` 的 `config:` 里配置。
>
> **English:** The 5 fields bridging Host and Client (`lastCount` / `available` / `dryRun` / `cleanRequest` / `lastResult`) are **runtime state** (volatile) — they only update the in-memory profile config, not the YAML. The plugin recomputes `lastCount` on every launch. Persistent switches (`autoPrune`, `dryRun`, …) are edited in `DEFAULT_CONFIG` in `index.js` or the `config:` block of `cordis.patch.yml`.

## 可调参数 / Configurable parameters (edit `DEFAULT_CONFIG` at the top of `index.js`)

| 参数 / Parameter | 默认 / Default | 说明 / Description |
|---|---|---|
| `cookieMaxAgeDays` | 7 | Layer A 兜底天数 / Layer A fallback days |
| `autoPrune` | true | 是否运行时自动清理 / Enable runtime auto-prune |
| `pruneThreshold` | 12 | 数量超过此值才自动清理 / Auto-prune when count exceeds this |
| `keepLatest` | 10 | 自动清理保留最近 N 条 / Keep newest N on auto-prune |
| `manualKeepLatest` | 5 | 一键清理保留最近 N 条 / Keep newest N on one-click clean |
| `dryRun` | true | **true=只统计不删**，确认无误后改 false / **true=count only, no delete**; set false after verifying |
| `checkIntervalMs` | 300000 | 自动清理间隔（5 分钟）/ Auto-prune interval (5 min) |
| `startDelayMs` | 30000 | 启动后延迟首次检查（30 秒）/ Delay before first check after startup (30 s) |
| `cleanPollMs` | 3000 | 轮询「一键清理」请求的间隔（3 秒）/ Poll interval for the clean request (3 s) |
| `countPollMs` | 15000 | 重新发布实时条数的间隔（15 秒），让启动早期的读取失败自愈 / Re-publish the live count every 15 s so an early read failure self-heals |

## 安全说明 / Safety

- **中文：** 所有清理只针对 **名称以 `dsh-auth-` 开头、且属于 `127.0.0.1` 本地** 的 cookie；绝不碰其它 cookie。 / **English:** All cleanup only touches cookies whose **name starts with `dsh-auth-` and belong to the local `127.0.0.1`** host; no other cookies are ever touched.
- **中文：** 当前会话那条永远是最新的，一定被保留。 / **English:** The current session's cookie is always the newest and is always kept.
- **中文：** 插件代码全部 `try/catch` 包裹，**加载失败也不会拖垮 DSH 桌面端**（否则整页打不开）。`@deepseek-ai/schemastery` 用动态 `import()` 加载，缺失时只是没有自动表单（但 v0.1.4 的「Cookie 清理」分区由 `client.js` 提供，仍会显示）。 / **English:** All plugin code is wrapped in `try/catch`; **even a load failure cannot break the DSH desktop** (otherwise the whole UI fails to open). `@deepseek-ai/schemastery` is loaded through a dynamic `import()`, so a missing dependency only disables the auto-form — the v0.1.4 "Cookie 清理" section comes from `client.js` and still shows.
- **中文：** 不修改任何 asar / 程序文件；离线脚本只做重命名且保留 `.bak` 备份。 / **English:** No asar / program files are modified; the offline script only renames and keeps a `.bak` backup.

## 关于「账户 → 设置」里的分区 / About the account → Settings section

**中文：** v0.1.4 采用 DSH 官方的双半边（Host + Client）插件结构：Host 半边 `index.js` 负责读写 cookie 和推送状态；浏览器半边 `client.js` 用 `window.__ModuleLoader__.load({ id: 'dsh-cookie-pruner', factory(require){ ... } })` 注册，通过 `ctx.slots.inject('settings.section', ...)` 向「设置」对话框贡献一个导航项与 React 面板。面板通过 `ctx.configForms.get('dsh-cookie-pruner-host')` 读取 Host 发布的 5 个 volatile 字段，用 `form.set('cleanRequest', true)` 触发清理（Host 每 `cleanPollMs` 轮询一次，处理完把标志复位）。React 由浏览器模块表提供（`require('react')`），不引入任何 Harness Client 包、不打包重复 React、不用 iframe，因此能跟随宿主的明暗主题。

**English:** v0.1.4 uses DSH's official dual-half (Host + Client) plugin structure: the Host half `index.js` handles cookie read/write and state publishing; the browser half `client.js` registers via `window.__ModuleLoader__.load({ id: 'dsh-cookie-pruner', factory(require){ ... } })` and contributes a nav entry + React panel to the Settings dialog through `ctx.slots.inject('settings.section', ...)`. The panel reads the 5 volatile fields published by the Host via `ctx.configForms.get('dsh-cookie-pruner-host')` and triggers pruning with `form.set('cleanRequest', true)` (the Host polls every `cleanPollMs` and resets the flag). React comes from the browser module table (`require('react')`) — no Harness Client package import, no duplicate React bundle, no iframe, so it follows the host's light/dark theme.

## License / 许可证

**MIT** — see [LICENSE](./LICENSE).
