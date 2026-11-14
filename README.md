# dsh-cookie-pruner v0.1.14

![version](https://img.shields.io/badge/version-v0.1.14-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-DSH%20desktop-orange)

---

## 简介 / Introduction

**中文：** 一个 DSH（DeepSeek Harness）桌面端插件，用来缓解已知的 `dsh-auth-*` cookie 累积 bug——也就是那个大约启动 70 次后导致 **HTTP 431 / "Web authentication failed"、桌面直接打不开** 的问题。它在 **DSH 左下角账户头像 → 设置（Settings）对话框里新增一个「Cookie 清理」分区**，并且在插件宿主里**周期性读取 Cookies 库文件大小**（沙箱内文件大小元数据可读，即使库内容被锁），把实时测量结果写进 `.runtime-diag.json`。**由于 DSH 桌面插件沙箱的真实限制，插件无法在运行时把数据推到面板、也无法直接删 cookie、更无法登记后台计划任务**——这些在 v0.1.7–v0.1.13 反复尝试过、都被沙箱架构否决了。所以 v0.1.14 改为**诚实版**：面板如实说明情况 + 给出唯一能解除 431 的离线做法；真正的防护靠 Layer A（`cookieMaxAgeDays:7`，已生效）和一次性离线脚本。实时库大小由**助手读取 `.runtime-diag.json` 后转述给你**（聊天里）。纯 JavaScript，无需构建，不改 asar。

**English:** A DSH (DeepSeek Harness) desktop plugin that mitigates the known `dsh-auth-*` cookie pile-up bug — the one that causes **HTTP 431 / "Web authentication failed"** and makes the desktop fail to boot after ~70 launches. It adds a **"Cookie 清理" section to the bottom-left account avatar → Settings dialog**, and from inside the plugin host it **periodically reads the Cookies DB file size** (file-size metadata is readable inside the sandbox even while the DB content is locked) and writes the live measurement to `.runtime-diag.json`. **Because of hard limits in the DSH desktop plugin sandbox, the plugin cannot push data into the panel at runtime, cannot delete cookies directly, and cannot register a background scheduled task** — all of those were attempted in v0.1.7–v0.1.13 and each was vetoed by the sandbox architecture. So v0.1.14 is the **honest version**: the panel tells the truth + gives the only offline fix that actually clears 431; the real defense is Layer A (`cookieMaxAgeDays:7`, already on) plus a one-shot offline script. The live DB size is **read by the assistant from `.runtime-diag.json` and relayed to you in chat**. Pure JavaScript, no build step, no asar edits.

## 背景 / Background

**中文：** 对应视频：【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness"。根因：桌面端每次启动用一个随机端口，`dsh-auth-` cookie 名里绑了端口，所以**每次启动都多一条、且从不清理**；约 70 次启动后 Cookie 头超过 Node 16KB 上限，Host 直接回 431，桌面打不开。已测版本 `44.7.0`（nightly，2026/11/04 构建）**仍未修复**。本插件**不**声称能在运行时清理——那是 DSH 插件架构做不到的；它做的是：限制未来寿命（Layer A）+ 诚实探测堆积并转述结果（Host 半边 + 助手）+ 指出离线解法（Layer C）。

**English:** Related video: 【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness". Root cause: the desktop host uses a random port on every launch, and the `dsh-auth-` cookie name is bound to that port, so **one new cookie is added each launch and never cleaned up**. After ~70 launches the Cookie header exceeds Node's 16 KiB limit, the host answers HTTP 431, and the desktop won't open. The tested build `44.7.0` (nightly, built 2026/11/04) is **not yet fixed**. This plugin does **not** claim to clean at runtime — that's impossible under the plugin architecture — it caps future lifetime (Layer A) + honestly probes pile-up and relays the result (Host half + assistant) + points to the offline fix (Layer C).

## 仓库文件说明 / What each file does

| 文件 / File | 作用（中文） | Purpose (English) |
|---|---|---|
| `index.js` | **插件主体（Host 半边）**：**不声明任何 `inject`**（桌面宿主只给 host 半边 `CTX_VERBS`，声明它不提供的服务会让插件永久 pending），周期用 `node:fs.statSync` 读 Cookies 库文件大小、把实时结果写进 `.runtime-diag.json` 供助手读取 | **Main plugin (Host half)**: declares **NO `inject`** (the desktop host only gives host halves `CTX_VERBS`; declaring a service it doesn't provide parks the plugin forever), periodically reads the Cookies DB file size via `node:fs.statSync`, and writes the live result to `.runtime-diag.json` for the assistant to read |
| `client.js` | **浏览器（Client）半边**：用 `settings.section` 插槽把「Cookie 清理」分区注册进「账户 → 设置」对话框，**诚实的静态面板**（说明真实情况 + 离线步骤 + Layer A 提示），不假装显示实时数字 | **Browser (Client) half**: registers the "Cookie 清理" section into the account → Settings dialog via the `settings.section` slot — an **honest static panel** (explains the real situation + offline steps + Layer A note), does NOT pretend to show live numbers |
| `cordis.patch.yml` | 声明式补丁：限制 `connection.cookieMaxAgeDays: 7`（Layer A 兜底）+ 注册插件本体 | Declarative patch: caps `connection.cookieMaxAgeDays: 7` (Layer A) + registers the plugin entry |
| `package.json` | 插件元数据：`exports`（含 `./client`）、`dsh.bundle.platforms/patch`、`dsh.client`、`@deepseek-ai/schemastery` 依赖 | Plugin metadata: `exports` (incl. `./client`), `dsh.bundle.platforms/patch`, `dsh.client`, the `@deepseek-ai/schemastery` dependency |
| `cleanup-once.ps1` | **一次性离线清理脚本**：完全退出 DSH 后运行，把 Chromium Cookies 库改名 `.bak`，重启即重建干净库（Layer C，真正解除 431） | One-shot offline cleanup: run with DSH fully closed; renames the Chromium Cookies DB so DSH rebuilds a clean one (Layer C — the real 431 fix) |
| `README.md` | 本说明文档 | This documentation |
| `LICENSE` | MIT 开源许可证 | MIT license |
| `.gitignore` | Git 忽略清单 | Git ignore list |

## 为什么"面板 + 一键清理"在 DSH 插件里做不到 / Why a Settings panel can't actually clean

**中文（划重点）：** 我（作者）在 v0.1.4 / v0.1.5 里**错误地承诺了"实时条数 + 一键清理"**，之后 v0.1.7–v0.1.13 又反复尝试"运行时检测 + 退出后自动清理"（后台计划任务）。经逐一核对 DSH 44.7.0 的 asar 与插件宿主运行器（`dsh-cordis-host-runner`）源码、并做了**真实重启诊断**（`.runtime-diag.json`）后，结论是：

1. 插件 Host 半边在 `node:vm` 沙箱里求值；沙箱 linker 把 `import('electron')` 解析到**渲染进程桥接对象**——它有 `ipcRenderer` 之类，但**没有 `.session.defaultSession.cookies`**。这正是用户看到的 `session.defaultSession.cookies missing`。
2. DSH **没有**向插件暴露任何 `ctx.cookies` / `ctx.session` 服务（已扫描 `super(ctx,"…")` 注册表确认）。
3. Chromium 的 Cookies SQLite 库在 DSH 运行时被**独占锁定**（`node:sqlite` 只读打开 → `unable to open database file`，`cp` → EBUSY），所以连 SQLite 直读都做不到。
4. DSH 自己的 cookie 读取在 Electron **主进程**里（`welcomeBackend` 的 `session.defaultSession.cookies.get(...)`），而插件不在那个进程/领域里。
5. **Host 沙箱的 `ctx` 只暴露 `CTX_VERBS`（`effect`/`on`/`provide`/`timeout`/`interval`/…）和宿主**实际提供**的服务。它不提供 `settings` / `bash` / `subprocess` / `timer` / `config` / `fiber`**。因此 Host 半边**没有任何受支持的通道把实时数据推到面板**（v0.1.12 真实诊断：`hasSettings:false`、`pushCount:0`；而试图声明 `inject:{optional:['settings',…]}` 反而让桌面宿主一直等一个叫 `optional` 的服务、插件永久 `pending` 不激活——见下方 v0.1.14 更正）。
6. 浏览器（Client）半边的 `require` 只能解析 DSH 的图模块，**不能 `require('node:fs')`**，且 Electron webview 是 `contextIsolation + sandbox + webSecurity`，**不能 `fetch('file://')`**。所以「Host 写文件 → Client 读文件」这条通道也走不通。

⇒ 结论：**第三方插件在 DSH 运行时既读不到、也删不掉 `dsh-auth-*` cookie，也无法把实时数据塞进设置面板，也无法在后台登记清理任务。** 这不是本插件 bug，也不是用户操作问题，是 DSH 桌面端插件架构的硬限制。所以 v0.1.14 不再假装能做这些——改为诚实展示情况 + 把**唯一真正能解除 431 的离线做法**讲清楚，并把"实时库大小"交给**助手读 `.runtime-diag.json` 后转述**这条人类在环通道。

**English (key point):** In v0.1.4 / v0.1.5 I **wrongly promised a live count + one-click clean**, and v0.1.7–v0.1.13 kept trying "detect at runtime + auto-clean after quit" (a background scheduled task). After checking the DSH 44.7.0 asar and the plugin host-runner (`dsh-cordis-host-runner`) source, plus a **real-restart diagnostic** (`.runtime-diag.json`), the conclusion is:

1. The plugin Host half is evaluated inside a `node:vm` sandbox whose module linker resolves `import('electron')` to the **renderer bridge object** — it has `ipcRenderer` etc. but **no `.session.defaultSession.cookies`**. That is exactly the user's `session.defaultSession.cookies missing`.
2. DSH exposes **no** `ctx.cookies` / `ctx.session` service to plugins (verified by scanning the `super(ctx,"…")` registry).
3. The Chromium Cookies SQLite DB is **exclusively locked** while DSH runs (`node:sqlite` read-only open → `unable to open database file`, `cp` → EBUSY), so even direct SQLite read is impossible.
4. DSH's own cookie read lives in the Electron **main process** (`welcomeBackend`'s `session.defaultSession.cookies.get(...)`), which the plugin is not part of.
5. **The Host sandbox `ctx` only exposes `CTX_VERBS` (`effect`/`on`/`provide`/`timeout`/`interval`/…) and the services the host ACTUALLY provides. It does NOT provide `settings` / `bash` / `subprocess` / `timer` / `config` / `fiber`.** So the Host half has **no supported channel to push live data into the panel** (v0.1.12 real diagnostic: `hasSettings:false`, `pushCount:0`; and trying to declare `inject:{optional:['settings',…]}` made the desktop host wait forever for a service literally named `optional`, leaving the plugin permanently `pending` — see the v0.1.14 correction below).
6. The browser (Client) half's `require` only resolves DSH graph modules — it **cannot `require('node:fs')`**, and the Electron webview is `contextIsolation + sandbox + webSecurity`, so it **cannot `fetch('file://')`**. Thus the "Host writes a file → Client reads it" path is also blocked.

⇒ Conclusion: **a third-party plugin cannot read or delete `dsh-auth-*` cookies while DSH runs, cannot push live data into the Settings panel, and cannot register a background cleanup task.** This is not a plugin bug and not a user mistake — it's a hard limit of the DSH desktop plugin architecture. So v0.1.14 stops pretending: it shows the truth + explains the **only offline fix that actually clears 431**, and hands "live DB size" to the **human-in-the-loop: the assistant reads `.runtime-diag.json` and relays it in chat**.

## 真正能解除 431 的是什么 / What actually clears 431

1. **声明式兜底（必定生效）/ Declarative cap (always on):** 把 `connection.cookieMaxAgeDays` 从默认 30 天压到 **7 天**，旧 cookie 自己会过期，根本堆不到 16KB。这是"防未来"的真正手段。 / Caps `connection.cookieMaxAgeDays` from the default 30 days down to **7 days**, so old cookies expire on their own and can never pile up to 16 KiB. This is the real "prevent future pile-up" measure.
2. **一次性离线清理（真正解除 431）/ One-shot offline cleanup (the real 431 fix):** 完全退出 DSH 后跑 `cleanup-once.ps1`，把 Cookies 库重命名重建。这一步**只能由你在 DSH 关闭后手动运行**（插件无法代替做）。 / With DSH fully closed, run `cleanup-once.ps1` to rename and rebuild the Cookies DB. This step **must be run by you, manually, after DSH is closed** (the plugin cannot do it for you).
3. **诚实探测 + 转述（本插件实际做的事）/ Honest probe + relay (what this plugin actually does):** Host 半边周期读 Cookies 库大小，写进 `.runtime-diag.json`；**助手**读这个文件，在聊天里告诉你当前库大小 / 是否超阈值 / 该不该跑离线脚本。面板（client.js）如实说明以上两点，不显示它拿不到的"实时数字"。 / The Host half periodically reads the Cookies DB size and writes it to `.runtime-diag.json`; the **assistant** reads that file and tells you in chat the current size / whether it's over threshold / whether to run the offline script. The panel (client.js) honestly explains the above and does NOT show "live numbers" it can't receive.

## 安装 / Installation

> ⚠️ **桌面端不能用 CLI 装插件。** `dsh plugin --profile desktop add ...` 会报错 `profile "desktop" is managed exclusively by the Electron application`。桌面端的插件只能通过应用内的「插件」页安装。
>
> ⚠️ **The desktop profile cannot be managed from the CLI.** `dsh plugin --profile desktop add ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. Install desktop plugins only through the in-app Plugins page.

**方式一 / Option 1（推荐，联网，GitHub 仓库）：**
- **中文：** 打开 DSH 桌面端 GUI → 左侧「插件 / Plugins」→ **Install a third-party plugin** → 在弹窗里粘贴仓库地址 `https://github.com/RAECYY/dsh-cookie-pruner.git`（或 `github:RAECYY/dsh-cookie-pruner`）→ 确认安装。安装器会自动 `pnpm add` 依赖（`@deepseek-ai/schemastery`），并按 `package.json` 的 `dsh.bundle` 字段注册成桌面 bundle；`dsh.client` + `exports["./client"]` 会让浏览器半边一起被加载。
- **English:** Open the DSH desktop GUI → left sidebar **Plugins** → **Install a third-party plugin** → paste the repo URL `https://github.com/RAECYY/dsh-cookie-pruner.git` (or `github:RAECYY/dsh-cookie-pruner`) → confirm. The installer runs `pnpm add` for dependencies (`@deepseek-ai/schemastery`) and registers it as a desktop bundle via `dsh.bundle`; `dsh.client` + `exports["./client"]` make the browser half load too.

**方式二 / Option 2（无需联网，本地目录）：**
- **中文：** 同样在「插件」页 → **Install a third-party plugin** → 选择本地目录 `D:\\AI\\dsh-cookie-pruner`。若走 `file:///` 手动注册（方式三），请先在该目录执行一次 `pnpm add @deepseek-ai/schemastery`。
- **English:** Same Plugins page → **Install a third-party plugin** → pick the local directory `D:\\AI\\dsh-cookie-pruner`. If you register manually via `file:///` (Option 3), run `pnpm add @deepseek-ai/schemastery` once in that directory first.

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

> **中文：** ✅ 面板在**左下角账户头像 → 设置**里。v0.1.4 起插件带一个浏览器半边（`client.js`），通过 `settings.section` 插槽向「设置」对话框贡献了一个导航项「**Cookie 清理**」和一个**诚实的静态面板**。v0.1.14 的面板**不再假装显示实时库大小**，而是如实说明：实时探测由 Host 半边写入 `.runtime-diag.json`、由助手在聊天里转述；真正解除 431 的是 Layer A（已生效）+ 一次性离线脚本。
>
> **English:** ✅ The panel lives in **bottom-left account avatar → Settings**. Since v0.1.4 the plugin ships a browser half (`client.js`) that contributes a real nav entry "**Cookie 清理**" plus an **honest static panel** to the Settings dialog via the `settings.section` slot. v0.1.14's panel **no longer pretends to show a live DB size**; it honestly states: live probing is written to `.runtime-diag.json` by the Host half and relayed by the assistant in chat; the real 431 fix is Layer A (already on) + the one-shot offline script.

1. **中文：** 装完重启后，点 **左下角账户头像 → 设置（Ctrl+,）**，在左侧导航里找到「**Cookie 清理**」。 / **English:** After restarting, click **bottom-left account avatar → Settings (Ctrl+,)** and find "**Cookie 清理**" in the left nav.
2. **中文：** 面板会显示「插件状态：已加载」、"实时数据：由助手读取后转述"、以及 ① Layer A 预防说明 + ② 一次性离线清理的完整步骤（脚本路径 + 运行方式）。**不会**显示"库大小 20KB / 风险徽章"这类它需要但拿不到的实时数字。 / **English:** The panel shows "插件状态：已加载" (plugin status: loaded), "实时数据：由助手读取后转述" (live data: relayed by assistant), and ① the Layer A prevention note + ② the full one-shot offline-cleanup steps (script path + how to run). It does **NOT** show "DB size 20KB / risk badge" — those are live numbers it cannot receive.
3. **中文：** 想知道当前库大小和是否超阈值，**看聊天里助手的转述**（助手会读 `.runtime-diag.json`）。若你的机器已堆积（约 28 KB，远超 8 KiB 阈值），按面板/助手给的离线步骤跑一次 `cleanup-once.ps1` 即可解除 431。 / **English:** To know the current DB size and whether it's over threshold, **watch the assistant's relay in chat** (the assistant reads `.runtime-diag.json`). If your machine has already piled up (~28 KB, far above the 8 KiB threshold), run `cleanup-once.ps1` once per the offline steps from the panel/assistant to clear 431.

## 可调参数 / Configurable parameters (edit `DEFAULT_CONFIG` / the constants at the top of `index.js`)

| 参数 / Parameter | 默认 / Default | 说明 / Description |
|---|---|---|
| `RISK_SIZE` | 8192 | Cookies 库大小风险阈值（字节，8 KiB）；≥ 即认为有溢出风险，并在诊断里标记 / DB size risk threshold (bytes); ≥ means risk, flagged in the diagnostic |
| `LAUNCH_THRESHOLD` | 50 | 自上次清理的启动次数阈值；≥ 即认为有溢出风险 / Launches-since-cleanup threshold; ≥ means risk |
| `cookieMaxAgeDays` | 7 | 仅作记录用的 Config 字段，与 Layer A 对应 / A Config field kept for reference only, matches Layer A |

> 注：v0.1.13 及更早的 `checkIntervalMs` / `startDelayMs` / `cleanPollMs` / `GRACE_MS` / `TASK_INTERVAL_MIN` 等参数，对应的"周期发布 / 轮询 cleanRequest / schtasks 计划任务"功能在沙箱里**根本无法运行**（没有 `settings`、`subprocess`、`timer` 服务），已在 v0.1.14 移除。

## 安全说明 / Safety

- **中文：** 所有清理逻辑只针对 Chromium Cookies 库整体（离线脚本侧重命名备份），运行时面板**不做任何删除**——它只说明情况与离线指引，因此**绝不会**误删其它 cookie 或破坏登录态。 / **English:** All cleanup targets the whole Chromium Cookies DB (renamed-and-backed-up on the offline-script side); the runtime panel **performs no deletion** — it only explains and gives offline guidance, so it can **never** accidentally remove other cookies or break logins.
- **中文：** 离线脚本 `cleanup-once.ps1` 带进程守卫：若检测到 DSH 仍在运行则直接退出，绝不在库被锁时动它；清理只做重命名且保留 `.bak` 备份。副作用是已保存登录态会丢失，需重新登录。 / **English:** The offline script `cleanup-once.ps1` has a process guard: if it detects DSH is still running it exits immediately, never touching the locked DB; cleanup only renames and keeps a `.bak` backup. Side effect: saved logins are lost and must be re-authenticated.
- **中文：** 插件代码全部 `try/catch` 包裹，**加载失败也不会拖垮 DSH 桌面端**（否则整页打不开）。`@deepseek-ai/schemastery` 用同步 `createRequire` 加载，缺失时只是没有自动表单（但「Cookie 清理」分区由 `client.js` 提供，仍会显示）。Host 半边**不声明任何 `inject`**，因此一定会被宿主激活、不会出现 v0.1.13 那种"永久 pending"卡死。 / **English:** All plugin code is wrapped in `try/catch`; **even a load failure cannot break the DSH desktop** (otherwise the whole UI fails to open). `@deepseek-ai/schemastery` is loaded synchronously via `createRequire`, so a missing dependency only disables the auto-form — the "Cookie 清理" section comes from `client.js` and still shows. The Host half declares **no `inject`**, so it is always activated by the host and can never hit v0.1.13's "permanently pending" deadlock.
- **中文：** 不修改任何 asar / 程序文件。 / **English:** No asar / program files are modified.

## 关于「账户 → 设置」里的分区 / About the account → Settings section

**中文：** 插件采用 DSH 官方的双半边（Host + Client）结构：Host 半边 `index.js` **不声明任何 `inject`**，周期用 `node:fs.statSync` 读 Cookies 库大小、把结果写进 `.runtime-diag.json`；浏览器半边 `client.js` 用 `window.__ModuleLoader__.load({ id: 'dsh-cookie-pruner', factory(require){ ... } })` 注册，通过 `ctx.slots.inject('settings.section', ...)` 向「设置」对话框贡献一个导航项与**诚实的静态 React 面板**（说明真实限制 + 离线步骤 + Layer A 提示）。面板**不依赖任何 Host 实时推送的字段**，所以永远不会因为"插件尚未就绪"而空白。React 由浏览器模块表提供（`require('react')`），不引入任何 Harness Client 包、不打包重复 React、不用 iframe，因此能跟随宿主的明暗主题。

**English:** The plugin uses DSH's official dual-half (Host + Client) structure: the Host half `index.js` **declares no `inject`**, periodically reads the Cookies DB size via `node:fs.statSync` and writes the result to `.runtime-diag.json`; the browser half `client.js` registers via `window.__ModuleLoader__.load({ id: 'dsh-cookie-pruner', factory(require){ ... } })` and contributes a nav entry + an **honest static React panel** to the Settings dialog through `ctx.slots.inject('settings.section', ...)` (explains the real limit + offline steps + Layer A note). The panel **does not depend on any live field pushed by the Host**, so it can never go blank from "插件尚未就绪". React comes from the browser module table (`require('react')`) — no Harness Client package import, no duplicate React bundle, no iframe, so it follows the host's light/dark theme.

## License / 许可证

**MIT** — see [LICENSE](./LICENSE).

## 版本历史 / Changelog（关键修正）

- **v0.1.14（本版）— 诚实版，移除所有沙箱里跑不起来的功能：** v0.1.13 的真实重启诊断发现 Host 半边 `hasSettings:false`、`pushCount:0`——沙箱根本不提供 `settings` 服务，于是数据从未发布到面板。但我当时误判，把 `inject` 改成了 `inject:{optional:['settings','timer','bash','subprocess']}`，**结果更糟**：桌面宿主不认识 `inject` 的 `{optional:[...]}` 对象形式，把它当成"在等一个名为 `optional` 的服务"，插件永久 `pending (waiting for service: optional)`、**永不激活**、`apply()` 从不执行、面板永远空白。v0.1.14 的结论是：Host 半边**老老实实声明 NO inject**（桌面宿主只给 `CTX_VERBS`），用 `node:fs.statSync` 读库大小（v0.1.12 真实诊断已证明 28672 字节可读），把结果写进 `.runtime-diag.json`，由**助手读文件后在聊天里转述**；浏览器半边改成**诚实静态面板**，不再假装显示实时数字、也不再依赖任何 Host 推送。同时删掉了所有"周期发布 / 轮询 cleanRequest / schtasks 计划任务"的死代码（沙箱里没有 `settings`/`subprocess`/`timer`，跑不起来）。
- **v0.1.13 — 发布 + 服务声明（错误方向）：** 试图用 `inject:{optional:[...]}` 拿 `settings`/`bash`/`subprocess`/`timer` 服务并直接属性访问，反而让插件永久 pending。已被 v0.1.14 推翻。
- **v0.1.12 — 结构性根因修复：** 之前的 v0.1.7–v0.1.11 反复"退出重进后还是没用"的根因是 Host 沙箱的 `require` 桥：`import.meta.url` 在 vm 沙箱里通常为 `undefined`，导致 `createRequire(import.meta.url)` 抛错，进而 `Config` 解析为 `undefined`、node:fs 也取不到。本版改用硬编码插件基路径调用 `createRequire`、把 `node:fs` 改为顶层静态 import、`statSync` 直接读文件大小。真实重启诊断确认 `node:fs.statSync` 可用（库大小 28672 字节）、`Config` 正常、`apply()` 执行了——但**数据没能发布到面板**（`hasSettings:false`、`pushCount:0`），暴露了"Host 半边无法把数据推到面板"这一硬限制，直接催生了 v0.1.14 的诚实设计。
- **v0.1.11：** 修正 `handle.done` 不含 `.stdout` 的 bug（改用 node:fs 直接读大小）。
- **v0.1.10：** 修复沙箱两处硬限制（`process` 在 vm 沙箱为 undefined；裸 `setTimeout`/`setInterval` 被拦截 → 须用 `inject:['timer']` + `ctx.timeout`/`ctx.interval`）。
- **v0.1.9：** 修复真正的回归 —— `push()` 直接读 `ctx.settings`（vm 沙箱里为 undefined）导致 Host 半边从未发布数据；改为 `ctx.get('settings')`。
- **v0.1.8：** 移除顶层 await（`esbuild` 打包 `iife`/`cjs` 拒绝顶层 await，导致 Host 半边整段未注册）。
- **v0.1.7：** 初版"运行时检测 + 退出后自动清理"（后台计划任务），但后续版本证明沙箱不提供 `subprocess`，该路径从未真正工作。
- **v0.1.6：** 诚实版面板 + 离线 `cleanup-once.ps1`，首次正视沙箱限制。
- **v0.1.4：** 双半边结构，面板进入「设置」而非侧边栏。
