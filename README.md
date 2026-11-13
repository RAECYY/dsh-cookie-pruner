# dsh-cookie-pruner v0.1.10

![version](https://img.shields.io/badge/version-v0.1.10-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-DSH%20desktop-orange)

---

## 简介 / Introduction

**中文：** 一个 DSH（DeepSeek Harness）桌面端插件，用来缓解已知的 `dsh-auth-*` cookie 累积 bug——也就是那个大约启动 70 次后导致 **HTTP 431 / "Web authentication failed"、桌面直接打不开** 的问题。它在 **DSH 左下角账户头像 → 设置（Settings）对话框里新增一个「Cookie 清理」分区**，**周期性读 Cookies 库文件大小**（沙箱内文件大小元数据可读，即使库内容被锁），**检测到堆积时自动登记一个 Windows 计划任务**，在你完全退出 DSH 后 ≤10 分钟自动运行 `cleanup-once.ps1`——**无需手动**。同时诚实地说明：第三方插件运行在 DSH 的插件沙箱（`node:vm`）里，**没有 `session.defaultSession.cookies`，也没有 `ctx.cookies`/`ctx.session` 服务**，而 Chromium 的 Cookies 库在 DSH 运行时被独占锁定——所以**插件无法在运行时直接删除这些 cookie**（真正的删除发生在你退出 DSH、库解锁之后，由计划任务触发）。真正的防护靠 Layer A（`cookieMaxAgeDays:7`，已生效）和 Layer C（离线清理）。纯 JavaScript，无需构建，不改 asar。

**English:** A DSH (DeepSeek Harness) desktop plugin that mitigates the known `dsh-auth-*` cookie pile-up bug — the one that causes **HTTP 431 / "Web authentication failed"** and makes the desktop fail to boot after ~70 launches. It adds a **"Cookie 清理" section to the bottom-left account avatar → Settings dialog**, **periodically reads the Cookies DB file size** (file-size metadata is readable inside the sandbox even while the DB content is locked), and **when it detects pile-up it auto-registers a Windows Task Scheduler job** that runs `cleanup-once.ps1` within ≤10 minutes after you fully quit DSH — **no manual step needed**. It also honestly states the limit: a third-party plugin runs inside DSH's plugin sandbox (`node:vm`), so there is **no `session.defaultSession.cookies`, no `ctx.cookies`/`ctx.session` service**, and the Chromium Cookies DB is exclusively locked while DSH runs — meaning the plugin **cannot delete those cookies at runtime** (the real deletion happens after you quit DSH and the DB unlocks, triggered by the scheduled task). The real defense is Layer A (`cookieMaxAgeDays:7`, already on) plus Layer C (offline cleanup). Pure JavaScript, no build step, no asar edits.

## 背景 / Background

**中文：** 对应视频：【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness"。根因：桌面端每次启动用一个随机端口，`dsh-auth-` cookie 名里绑了端口，所以**每次启动都多一条、且从不清理**；约 70 次启动后 Cookie 头超过 Node 16KB 上限，Host 直接回 431，桌面打不开。已测版本 `44.7.0`（nightly，2026/11/04 构建）**仍未修复**。本插件**不**声称能在运行时清理——那是 DSH 插件架构做不到的；它做的是：限制未来寿命（Layer A）+ 自动检测并在退出后自动清理（Layer B）+ 指出离线解法（Layer C）。

**English:** Related video: 【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness". Root cause: the desktop host uses a random port on every launch, and the `dsh-auth-` cookie name is bound to that port, so **one new cookie is added each launch and never cleaned up**. After ~70 launches the Cookie header exceeds Node's 16 KiB limit, the host answers HTTP 431, and the desktop won't open. The tested build `44.7.0` (nightly, built 2026/11/04) is **not yet fixed**. This plugin does **not** claim to clean at runtime — that's impossible under the plugin architecture — it caps future lifetime (Layer A) + auto-detects and auto-cleans after quit (Layer B) + points to the offline fix (Layer C).

## 仓库文件说明 / What each file does

| 文件 / File | 作用（中文） | Purpose (English) |
|---|---|---|
| `index.js` | **插件主体（Host 半边）**：周期读 Cookies 库文件大小、检测堆积、自动登记计划任务（退出后清理），并把诊断/证明写进 `settings` 服务 | **Main plugin (Host half)**: periodically reads the Cookies DB file size, detects pile-up, auto-registers a scheduled task (cleanup after quit), and publishes diagnostics/proof into the `settings` service |
| `client.js` | **浏览器（Client）半边**：用 `settings.section` 插槽把「Cookie 清理」分区注册进「账户 → 设置」对话框，读取 Host 发布的字段、开关自动清理、触发离线步骤 | **Browser (Client) half**: registers the "Cookie 清理" section into the account → Settings dialog via the `settings.section` slot, reads the fields published by the Host, toggles auto-clean, and triggers offline steps |
| `cordis.patch.yml` | 声明式补丁：限制 `connection.cookieMaxAgeDays: 7`（Layer A 兜底）+ 注册插件本体 | Declarative patch: caps `connection.cookieMaxAgeDays: 7` (Layer A) + registers the plugin entry |
| `package.json` | 插件元数据：`exports`（含 `./client`）、`dsh.bundle.platforms/patch`、`dsh.client`、`@deepseek-ai/schemastery` 依赖 | Plugin metadata: `exports` (incl. `./client`), `dsh.bundle.platforms/patch`, `dsh.client`, the `@deepseek-ai/schemastery` dependency |
| `cleanup-once.ps1` | **一次性离线清理脚本**：完全退出 DSH 后运行，把 Chromium Cookies 库改名 `.bak`，重启即重建干净库（Layer C，真正解除 431） | One-shot offline cleanup: run with DSH fully closed; renames the Chromium Cookies DB so DSH rebuilds a clean one (Layer C — the real 431 fix) |
| `README.md` | 本说明文档 | This documentation |
| `LICENSE` | MIT 开源许可证 | MIT license |
| `.gitignore` | Git 忽略清单 | Git ignore list |

## 为什么"面板 + 一键清理"在 DSH 插件里做不到 / Why a Settings panel can't actually clean

**中文（划重点）：** 我（作者）在 v0.1.4 / v0.1.5 里**错误地承诺了"实时条数 + 一键清理"**。经核对 DSH 44.7.0 的 asar 与插件宿主运行器源码，结论是：

1. 插件 Host 半边在 `node:vm` 沙箱里求值；沙箱的模 linker 把 `import('electron')` 解析到**渲染进程桥接对象**——它有 `ipcRenderer` 之类，但**没有 `.session.defaultSession.cookies`**。这正是用户看到的 `session.defaultSession.cookies missing`。
2. DSH **没有**向插件暴露任何 `ctx.cookies` / `ctx.session` 服务（已扫描 `super(ctx,"…")` 注册表确认）。
3. Chromium 的 Cookies SQLite 库在 DSH 运行时被**独占锁定**（`node:sqlite` 只读打开 → `unable to open database file`，`cp` → EBUSY），所以连 SQLite 直读都做不到。
4. DSH 自己的 cookie 读取在 Electron **主进程**里（`welcomeBackend` 的 `session.defaultSession.cookies.get(...)`），而插件不在那个进程/领域里。

⇒ 结论：**第三方插件在 DSH 运行时既读不到、也删不掉 `dsh-auth-*` cookie。** 这不是本插件 bug，也不是用户操作问题，是 DSH 桌面端插件架构的硬限制。所以 v0.1.6 不再假装能清——改为诚实地展示探测证明 + 给出离线解法；v0.1.7 进一步做到：**运行时检测堆积 + 退出后自动清理**（清理发生在 DSH 关闭、库解锁之后，由系统计划任务执行）。

**English (key point):** In v0.1.4 / v0.1.5 I **wrongly promised a live count + one-click clean**. After checking the DSH 44.7.0 asar and the plugin host-runner source, the conclusion is:

1. The plugin Host half is evaluated inside a `node:vm` sandbox whose module linker resolves `import('electron')` to the **renderer bridge object** — it has `ipcRenderer` etc. but **no `.session.defaultSession.cookies`**. That is exactly the user's `session.defaultSession.cookies missing`.
2. DSH exposes **no** `ctx.cookies` / `ctx.session` service to plugins (verified by scanning the `super(ctx,"…")` registry).
3. The Chromium Cookies SQLite DB is **exclusively locked** while DSH runs (`node:sqlite` read-only open → `unable to open database file`, `cp` → EBUSY), so even direct SQLite read is impossible.
4. DSH's own cookie read lives in the Electron **main process** (`welcomeBackend`'s `session.defaultSession.cookies.get(...)`), which the plugin is not part of.

⇒ Conclusion: **a third-party plugin cannot read or delete `dsh-auth-*` cookies while DSH is running.** This is not a plugin bug and not a user mistake — it's a hard limit of the DSH desktop plugin architecture. So v0.1.6 stops pretending and honestly shows the proof + the offline fix; v0.1.7 goes further: **detect pile-up at runtime + auto-clean after quit** (the cleanup happens after DSH closes and the DB unlocks, run by a system scheduled task).

## 三重防护（v0.1.7 起四重）/ Three layers of defense (four from v0.1.7)

1. **声明式兜底（必定生效）/ Declarative cap (always on):** 把 `connection.cookieMaxAgeDays` 从默认 30 天压到 **7 天**，旧 cookie 自己会过期，根本堆不到 16KB。这是"防未来"的真正手段。 / Caps `connection.cookieMaxAgeDays` from the default 30 days down to **7 days**, so old cookies expire on their own and can never pile up to 16 KiB. This is the real "prevent future pile-up" measure.
2. **自动检测 + 退出后自动清理（v0.1.7 新增，无需手动）/ Auto-detect + deferred auto-cleanup (v0.1.7, no manual step):** 周期读 Cookies 库文件大小（沙箱内文件大小可读），一旦检测到堆积（库 ≥ 8KB 或自上次清理启动 ≥ 50 次）就自动登记 Windows 计划任务 `DshCookiePrune`，在你完全退出 DSH 后 ≤10 分钟自动运行 `cleanup-once.ps1`。清理在 DSH 关闭、库解锁之后才发生，所以安全。 / Periodically reads the Cookies DB file size (file size is readable in the sandbox); once pile-up is detected (DB ≥ 8 KiB or ≥ 50 launches since last cleanup) it auto-registers a Windows Task Scheduler job `DshCookiePrune` that runs `cleanup-once.ps1` within ≤10 minutes after you fully quit DSH. Cleanup happens only after DSH closes and the DB unlocks, so it's safe.
3. **诊断 + 指引（本面板）/ Diagnostics + guidance (this panel):** 面板展示实时 Cookies 库大小、启动次数、溢出风险徽章、自动清理开关，以及**离线清理脚本的路径与步骤**。 / The panel shows the live Cookies DB size, launch count, an overflow-risk badge, an auto-clean toggle, and the **offline cleanup script path + steps**.
4. **一次性离线清理（真正解除 431）/ One-shot offline cleanup (the real 431 fix):** 完全退出 DSH 后跑 `cleanup-once.ps1`，把 Cookies 库重命名重建。 / With DSH fully closed, run `cleanup-once.ps1` to rename and rebuild the Cookies DB.

## 安装 / Installation

> ⚠️ **桌面端不能用 CLI 装插件。** `dsh plugin --profile desktop add ...` 会报错 `profile "desktop" is managed exclusively by the Electron application`。桌面端的插件只能通过应用内的「插件」页安装。
>
> ⚠️ **The desktop profile cannot be managed from the CLI.** `dsh plugin --profile desktop add ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. Install desktop plugins only through the in-app Plugins page.

**方式一 / Option 1（推荐，联网，GitHub 仓库）：**
- **中文：** 打开 DSH 桌面端 GUI → 左侧「插件 / Plugins」→ **Install a third-party plugin** → 在弹窗里粘贴仓库地址 `https://github.com/RAECYY/dsh-cookie-pruner.git`（或 `github:RAECYY/dsh-cookie-pruner`）→ 确认安装。安装器会自动 `pnpm add` 依赖（`@deepseek-ai/schemastery`），并按 `package.json` 的 `dsh.bundle` 字段注册成桌面 bundle；`dsh.client` + `exports["./client"]` 会让浏览器半边一起被加载。
- **English:** Open the DSH desktop GUI → left sidebar **Plugins** → **Install a third-party plugin** → paste the repo URL `https://github.com/RAECYY/dsh-cookie-pruner.git` (or `github:RAECYY/dsh-cookie-pruner`) → confirm. The installer runs `pnpm add` for dependencies (`@deepseek-ai/schemastery`) and registers it as a desktop bundle via `dsh.bundle`; `dsh.client` + `exports["./client"]` make the browser half load too.

**方式二 / Option 2（无需联网，本地目录）：**
- **中文：** 同样在「插件」页 → **Install a third-party plugin** → 选择本地目录 `D:\AI\dsh-cookie-pruner`。若走 `file:///` 手动注册（方式三），请先在该目录执行一次 `pnpm add @deepseek-ai/schemastery`。
- **English:** Same Plugins page → **Install a third-party plugin** → pick the local directory `D:\AI\dsh-cookie-pruner`. If you register manually via `file:///` (Option 3), run `pnpm add @deepseek-ai/schemastery` once in that directory first.

**方式三 / Option 3（手动兜底 / manual fallback）：** 若弹窗两种方式都失败，手动在 `C:\Users\ASUS\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加（注意用 `file:///` 而非裸 `C:/`）：

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

> **中文：** ✅ 面板现在就在**左下角账户头像 → 设置**里。v0.1.4 起，插件带一个浏览器半边（`client.js`），通过 `settings.section` 插槽向「设置」对话框贡献了一个真正的导航项「**Cookie 清理**」和一个面板。v0.1.7 起该面板显示：Cookies 库大小（实时）、自上次清理的启动次数、溢出风险徽章、自动清理开关，以及"显示离线清理步骤"按钮。Host 半边周期性读 Cookies 库大小检测堆积，并在需要时自动登记计划任务——**不再需要你手动跑脚本**。
>
> **English:** ✅ The panel now lives in **bottom-left account avatar → Settings**. Since v0.1.4 the plugin ships a browser half (`client.js`) that contributes a real nav entry "**Cookie 清理**" plus a panel to the Settings dialog via the `settings.section` slot. Since v0.1.7 the panel shows: Cookies DB size (live), launches since last cleanup, an overflow-risk badge, an auto-clean toggle, and a "show offline steps" button. The Host half periodically reads the Cookies DB size to detect pile-up and auto-registers a scheduled task when needed — **no manual script run required**.

1. **中文：** 装完重启后，点 **左下角账户头像 → 设置（Ctrl+,）**，在左侧导航里找到「**Cookie 清理**」（排在「通用设置」和「模型」之间）。 / **English:** After restarting, click **bottom-left account avatar → Settings (Ctrl+,)** and find "**Cookie 清理**" in the left nav (between 通用设置 and 模型).
2. **中文：** 面板会显示：`Cookies 库大小`（如 `20.0 KB`）、`自上次清理启动次数`、`溢出风险` 徽章（库 ≥ 8KB 或启动 ≥ 50 次 → 红色「有溢出风险」，否则绿色「安全」）、`自动清理` 开关，以及一段说明。 / **English:** The panel shows `Cookies DB size` (e.g. `20.0 KB`), `launches since last cleanup`, an `overflow risk` badge (DB ≥ 8 KiB or launches ≥ 50 → red "有溢出风险", otherwise green "安全"), an `auto-clean` toggle, and a note.
3. **中文：** 当风险徽章变红时，插件**已经**自动登记了计划任务 `DshCookiePrune`。你只需要在方便时**完全退出 DSH**，它会在 ≤10 分钟内自动清理并解除 431。点「显示离线清理步骤」可查看完整路径与手动步骤（保底方案）。 / **English:** When the risk badge turns red, the plugin has **already** auto-registered the `DshCookiePrune` task. You only need to **fully quit DSH** when convenient — it will auto-clean within ≤10 minutes and clear 431. Click "show offline steps" for the full path + manual steps (the fallback).

> **中文（v0.1.5 → v0.1.6 的更正）：** v0.1.5 以为"显示零个"是启动早期 cookie 库未就绪的时序竞态，于是加了 `cookies.ready` 等待 + 重试 + 15 秒周期发布。但这个假设是**错的**——用户机器上重启后仍显示 0，说明不是时序问题。真正的根因是插件沙箱拿不到 `session.defaultSession.cookies`（架构限制）。v0.1.6 不再假装能读/删，改为诚实展示探测证明 + 离线解法；v0.1.7 在诚实地基上追加了"运行时检测 + 退出后自动清理"。
>
> **English (v0.1.5 → v0.1.6 correction):** v0.1.5 assumed the "shows zero" was a startup timing race (cookie store not ready), so it added `cookies.ready` wait + retry + 15 s periodic publish. That assumption was **wrong** — the user still saw 0 after restart, proving it wasn't a timing issue. The real root cause is the plugin sandbox cannot reach `session.defaultSession.cookies` (an architecture limit). v0.1.6 stops pretending to read/delete and instead shows the proof + the offline fix honestly; v0.1.7 builds on that honesty by adding "detect at runtime + auto-clean after quit".

> **中文（v0.1.7 → v0.1.8 的更正）：** v0.1.7 在 `index.js` 顶部用了 `await import('@deepseek-ai/schemastery')`（顶层 await）。DSH 的插件宿主用 esbuild 把 Host 半边打包成 `iife`/`cjs`，**顶层 await 在打包阶段就被拒绝**，导致整个 Host 半边根本没注册——于是面板能渲染（client 半边没有顶层 await），但永远显示「插件尚未就绪」和默认值（0 KB / 0 次）。v0.1.8 改用同步的 `createRequire` 加载 schemastery（从插件自带 node_modules 解析），去掉了顶层 await。

> **English (v0.1.7 → v0.1.8 correction):** v0.1.7 used a top-level `await import('@deepseek-ai/schemastery')` at the top of `index.js`. The DSH plugin host bundles the Host half with esbuild in `iife`/`cjs` mode, which **rejects top-level await at bundle time**, so the entire Host half was never registered — the panel still rendered (the client half has no top-level await) but always showed "插件尚未就绪" and default values (0 KB / 0 launches). v0.1.8 loads schemastery synchronously via `createRequire` (resolved from the plugin's own node_modules), removing the top-level await.

> **中文（v0.1.8 → v0.1.9 的更正，真正的修复）：** v0.1.8 装上去后仍然「插件尚未就绪、0 KB / 0 次」。**真因不是顶层 await**——v0.1.4 同样有顶部 `node:module` import + 顶层 await，面板却正常。真正的问题是 `push()` 里写成 `if (ctx.settings && ...)`：在 `node:vm` 沙箱里，插件服务**只**通过 `ctx.get('x')` 暴露，`ctx.settings` 这个直接属性是 `undefined`，于是发布逻辑静默跳过、`settings.update` 从未被调用，面板永远拿不到数据。v0.1.9 改为 `const settings = ctx.get ? ctx.get('settings') : (ctx.settings || undefined)`，并对 `subprocess` 同样走 `ctx.get('subprocess')`——首条数据必定落地。重新完整重启 DSH 后即可看到真实的库大小与风险徽章。

> **English (v0.1.8 → v0.1.9 correction — the real fix):** v0.1.8 still showed "插件尚未就绪" with 0 KB / 0 launches. The cause was **not** top-level await — v0.1.4 had the same top-of-file `node:module` import plus a top-level await and its panel worked fine. The real bug was in `push()`: it tested `if (ctx.settings && ...)`. Inside the `node:vm` sandbox, plugin services are exposed **only** via `ctx.get('x')`; the direct `ctx.settings` property is `undefined`, so the publish logic silently no-op'd and `settings.update` was never called — the panel never received data. v0.1.9 uses `const settings = ctx.get ? ctx.get('settings') : (ctx.settings || undefined)` and applies the same `ctx.get('subprocess')` pattern, so the first publish always lands. After a full DSH restart you'll see the real DB size and risk badge.

> **中文（v0.1.9 → v0.1.10 的更正，沙箱两处硬限制）：** v0.1.9 装上去后，面板「活」了（不再显示「插件尚未就绪」），但仍显示 `0 KB`、`安全`。两个根因都在 DSH 的 `node:vm` 沙箱里，已对照 `dsh-cordis-host-runner` 源码确认：
> 1. **`process` 在沙箱里是 `undefined`。** v0.1.9 的 `cookiesPath()` 写了 `process.env.APPDATA || process.env.LOCALAPPDATA`，会抛 `ReferenceError` → 路径返回空 → 测出来的库大小恒为 0，风险徽章永远绿。v0.1.10 改用子进程探测 `$env:APPDATA`（与测大小时的 `powershell` 用的是同一条路），不再碰 `process`。
> 2. **裸 `setTimeout` / `setInterval` 被沙箱拦截。** `hostrunner` 的 `NODE_API_REDIRECTS` 把裸定时器映射成抛 `TIMER_REDIRECT`；且只有在插件声明 `inject: ['timer']` 后，宿主门面才放行 `ctx.timeout` / `ctx.interval`。v0.1.9 的几处裸定时器在函数体里直接抛错，导致「检测循环」和「清理请求轮询」从未真正跑起来——只有同步首推落地。v0.1.10 改为 `ctx.timeout` / `ctx.interval`，并新增 `export const inject = ['timer']`，定时器句柄在 `ctx.effect` 清理时 `dispose()`。
> 已用模拟沙箱的宿主测试证实：v0.1.10 能拿到真实的 `20480` 字节（不再是 0）、能注册 3 个计时器、风险徽章正确变红并登记计划任务。完整重启 DSH 后生效。

> **English (v0.1.9 → v0.1.10 correction — two sandbox hard-limits):** v0.1.9 made the panel "alive" (no more "插件尚未就绪") but it still showed `0 KB` and "safe". Both root causes live in DSH's `node:vm` sandbox, confirmed against the `dsh-cordis-host-runner` source:
> 1. **`process` is `undefined` in the sandbox.** v0.1.9's `cookiesPath()` read `process.env.APPDATA || process.env.LOCALAPPDATA`, which threw `ReferenceError` → empty path → DB size always measured as 0, risk badge always green. v0.1.10 resolves `APPDATA` via a subprocess probe (`$env:APPDATA` — the same channel used to read the DB size) and never touches `process`.
> 2. **Bare `setTimeout` / `setInterval` are trapped by the sandbox.** `hostrunner`'s `NODE_API_REDIRECTS` maps bare timers to a thrown `TIMER_REDIRECT`, and the host façade only permits `ctx.timeout` / `ctx.interval` after the plugin declares `inject: ['timer']`. v0.1.9's bare timers threw inside the effect bodies, so the "measure loop" and "clean-request poll" never actually ran — only the synchronous first publish landed. v0.1.10 uses `ctx.timeout` / `ctx.interval` and adds `export const inject = ['timer']`; timer handles are `dispose()`'d in the `ctx.effect` cleanup.
> A sandbox-simulating host test confirms v0.1.10 reads the real `20480` bytes (not 0), registers 3 timers, and correctly flips the risk badge red + registers the scheduled task. Takes effect after a full DSH restart.

## 可调参数 / Configurable parameters (edit `DEFAULT_CONFIG` / the constants at the top of `index.js`)

| 参数 / Parameter | 默认 / Default | 说明 / Description |
|---|---|---|
| `cookieMaxAgeDays` | 7 | Layer A 兜底天数 / Layer A fallback days |
| `checkIntervalMs` | 60000 | 读 Cookies 库大小 + 检测溢出的间隔（1 分钟）/ Interval to read DB size + detect risk (1 min) |
| `startDelayMs` | 15000 | 启动后延迟首次检测（15 秒）/ Delay before first check (15 s) |
| `cleanPollMs` | 3000 | 轮询 `cleanRequest`（离线步骤）的间隔（3 秒）/ Poll interval for `cleanRequest` (3 s) |
| `RISK_SIZE` | 8192 | Cookies 库大小风险阈值（字节，8 KiB）；≥ 即认为有溢出风险 / DB size risk threshold (bytes); ≥ means risk |
| `LAUNCH_THRESHOLD` | 50 | 自上次清理的启动次数阈值；≥ 即认为有溢出风险 / Launches-since-cleanup threshold; ≥ means risk |
| `TASK_INTERVAL_MIN` | 10 | 计划任务 `DshCookiePrune` 的周期（分钟）；DSH 退出后 ≤10 分钟自动清理 / Scheduled-task cadence (min); auto-cleans ≤10 min after DSH quits |

## 安全说明 / Safety

- **中文：** 所有清理逻辑只针对名称以 `dsh-auth-` 开头的 cookie（离线脚本侧）。运行时面板**不做任何删除**——它只展示信息与离线指引，因此**绝不会**误删其它 cookie 或破坏登录态。 / **English:** All cleanup targets only cookies whose name starts with `dsh-auth-` (on the offline-script side). The runtime panel **performs no deletion** — it only shows info and offline guidance, so it can **never** accidentally remove other cookies or break logins.
- **中文：** 离线脚本 `cleanup-once.ps1` 带进程守卫：若检测到 DSH 仍在运行则直接退出，绝不在库被锁时动它；清理只做重命名且保留 `.bak` 备份。副作用是已保存登录态会丢失，需重新登录。 / **English:** The offline script `cleanup-once.ps1` has a process guard: if it detects DSH is still running it exits immediately, never touching the locked DB; cleanup only renames and keeps a `.bak` backup. Side effect: saved logins are lost and must be re-authenticated.
- **中文：** 插件代码全部 `try/catch` 包裹，**加载失败也不会拖垮 DSH 桌面端**（否则整页打不开）。`@deepseek-ai/schemastery` 用同步 `createRequire` 加载，缺失时只是没有自动表单（但「Cookie 清理」分区由 `client.js` 提供，仍会显示）。`settings` / `subprocess` 在 `apply` 内通过 `ctx.get('x')` 获取（沙箱内直接属性为 `undefined`，故必须走 `ctx.get`），宿主未提供时优雅降级（只跳过自动检测，不报错）。 / **English:** All plugin code is wrapped in `try/catch`; **even a load failure cannot break the DSH desktop** (otherwise the whole UI fails to open). `@deepseek-ai/schemastery` is loaded synchronously via `createRequire`, so a missing dependency only disables the auto-form — the "Cookie 清理" section comes from `client.js` and still shows. `settings` / `subprocess` are obtained inside `apply` via `ctx.get('x')` (direct properties are `undefined` in the sandbox, so `ctx.get` is mandatory), degrading gracefully (skips auto-detection only) if the host doesn't provide them.
- **中文：** 不修改任何 asar / 程序文件。 / **English:** No asar / program files are modified.

## 关于「账户 → 设置」里的分区 / About the account → Settings section

**中文：** 插件采用 DSH 官方的双半边（Host + Client）结构：Host 半边 `index.js` 周期读 Cookies 库大小、检测堆积、自动登记计划任务，并把诊断写进 `settings` 服务；浏览器半边 `client.js` 用 `window.__ModuleLoader__.load({ id: 'dsh-cookie-pruner', factory(require){ ... } })` 注册，通过 `ctx.slots.inject('settings.section', ...)` 向「设置」对话框贡献一个导航项与 React 面板。面板通过 `ctx.configForms.get('dsh-cookie-pruner-host')` 读取 Host 发布的 volatile 字段（当前为 `lastDbSize` / `launchesSincePrune` / `autoCleanEnabled` / `lastAutoCleanAt` / `available` / `lastResult` / `cleanRequest`），用 `form.set('autoCleanEnabled', true)` 开启自动清理、用 `form.set('cleanRequest', true)` 触发离线步骤（Host 每 `cleanPollMs` 轮询一次，处理完把标志复位）。React 由浏览器模块表提供（`require('react')`），不引入任何 Harness Client 包、不打包重复 React、不用 iframe，因此能跟随宿主的明暗主题。

**English:** The plugin uses DSH's official dual-half (Host + Client) structure: the Host half `index.js` periodically reads the Cookies DB size, detects pile-up, auto-registers a scheduled task, and writes diagnostics into the `settings` service; the browser half `client.js` registers via `window.__ModuleLoader__.load({ id: 'dsh-cookie-pruner', factory(require){ ... } })` and contributes a nav entry + React panel to the Settings dialog through `ctx.slots.inject('settings.section', ...)`. The panel reads the volatile fields published by the Host via `ctx.configForms.get('dsh-cookie-pruner-host')` (currently `lastDbSize` / `launchesSincePrune` / `autoCleanEnabled` / `lastAutoCleanAt` / `available` / `lastResult` / `cleanRequest`) and turns on auto-clean with `form.set('autoCleanEnabled', true)` or triggers offline steps with `form.set('cleanRequest', true)` (the Host polls every `cleanPollMs` and resets the flag). React comes from the browser module table (`require('react')`) — no Harness Client package import, no duplicate React bundle, no iframe, so it follows the host's light/dark theme.

## License / 许可证

**MIT** — see [LICENSE](./LICENSE).
