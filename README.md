# dsh-cookie-pruner v0.1.2

![version](https://img.shields.io/badge/version-v0.1.2-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![platform](https://img.shields.io/badge/platform-DSH%20desktop-orange)

---

## 简介 / Introduction

**中文：** 一个 DSH（DeepSeek Harness）桌面端插件，用来绕开已知的 `dsh-auth-*` cookie 累积 bug——也就是那个大约启动 70 次后导致 **HTTP 431 / “Web authentication failed”、桌面直接打不开** 的问题。它会限制认证 cookie 生命周期、自动清理最旧的 `dsh-auth-*` cookie（保留最近 10 条），并把**当前条数 + 一键清理开关直接显示在 DSH 的「设置 → 插件」里**。纯 JavaScript，无需构建，不改 asar。

**English:** A DSH (DeepSeek Harness) desktop plugin that works around the known `dsh-auth-*` cookie pile-up bug — the one that causes **HTTP 431 / “Web authentication failed”** and makes the desktop fail to boot after ~70 launches. It caps the auth-cookie lifetime, automatically prunes the oldest `dsh-auth-*` cookies (keeping the newest 10), and shows the **live count plus a one-click clean toggle right inside DSH Settings → Plugins**. Pure JavaScript, no build step, no asar edits.

## 背景 / Background

**中文：** 对应视频：【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness"。根因：桌面端每次启动用一个随机端口，`dsh-auth-` cookie 名里绑了端口，所以**每次启动都多一条、且从不清理**；约 70 次启动后 Cookie 头超过 Node 16KB 上限，Host 直接回 431，桌面打不开。已测版本 `44.7.0`（nightly，2026/11/04 构建）**仍未修复**，所以本插件用“绕开官方补丁”的方式解决。

**English:** Related video: 【十二人夋的作品】"DSH已知bug #DSH #DeepSeek #DeepSeekHarness". Root cause: the desktop host uses a random port on every launch, and the `dsh-auth-` cookie name is bound to that port, so **one new cookie is added each launch and never cleaned up**. After ~70 launches the Cookie header exceeds Node's 16 KiB limit, the host answers HTTP 431, and the desktop won't open. The tested build `44.7.0` (nightly, built 2026/11/04) is **not yet fixed**, so this plugin works around the official patch.

## 仓库文件说明 / What each file does

| 文件 / File | 作用（中文） | Purpose (English) |
|---|---|---|
| `index.js` | **插件主体**（Host 半边）：运行时自动清理 + 向「设置 → 插件」推送条数 / 响应一键清理，含全部可调参数（`DEFAULT_CONFIG`） | **Main plugin** (Host half): runtime auto-prune + pushes the count into Settings → Plugins and reacts to the clean toggle; all tunables in `DEFAULT_CONFIG` |
| `cordis.patch.yml` | 声明式补丁：限制 `connection.cookieMaxAgeDays: 7`（Layer A 兜底）+ 注册插件本体 | Declarative patch: caps `connection.cookieMaxAgeDays: 7` (Layer A) + registers the plugin entry |
| `package.json` | 插件元数据（名称/版本/入口/`dsh.bundle.patch` 指向 patch 文件/`@deepseek-ai/schemastery` 依赖） | Plugin metadata (name/version/entry; `dsh.bundle.patch`; the `@deepseek-ai/schemastery` dependency) |
| `cleanup-once.ps1` | **一次性离线清理脚本**：完全退出 DSH 后运行，把 Chromium Cookies 库改名 `.bak`，重启即重建干净库（Layer C） | One-shot offline cleanup: run with DSH fully closed; renames the Chromium Cookies DB so DSH rebuilds a clean one (Layer C) |
| `README.md` | 本说明文档 | This documentation |
| `LICENSE` | MIT 开源许可证 | MIT license |
| `.gitignore` | Git 忽略清单 | Git ignore list |

## 三重防护 / Three layers of defense

1. **声明式兜底（必定生效）/ Declarative cap (always on):** 把 `connection.cookieMaxAgeDays` 从默认 30 天压到 **7 天**，旧 cookie 自己会过期，根本堆不到 16KB。 / Caps `connection.cookieMaxAgeDays` from the default 30 days down to **7 days**, so old cookies expire on their own and can never pile up to 16 KiB.
2. **运行时自动清理 / Runtime auto-prune:** DSH 活着时，插件读取 Electron Chromium cookie 库，检测 `dsh-auth-*` 数量，超过阈值就删最旧的、只留最近 10 条；同时把**当前总条数**推送到「设置 → 插件」，并提供一键清理开关（保留最近 5 条）。 / While DSH is live, the plugin reads the Electron Chromium cookie store, counts `dsh-auth-*` cookies, and when over the threshold removes the oldest ones keeping the newest 10; it also pushes the **live count** into Settings → Plugins and offers a one-click clean toggle (keep newest 5).
3. **一次性离线清理 / One-shot offline cleanup:** 极端情况（运行时库读不到）下，完全退出 DSH 后跑 `cleanup-once.ps1`，把 Cookies 库重命名重建。 / For the worst case where the runtime store is unreachable, run `cleanup-once.ps1` with DSH fully closed to rename and rebuild the Cookies DB.

## 安装 / Installation

> ⚠️ **桌面端不能用 CLI 装插件。** `dsh plugin --profile desktop add ...` 会报错 `profile "desktop" is managed exclusively by the Electron application`。桌面端的插件只能通过应用内的「插件」页安装。
>
> ⚠️ **The desktop profile cannot be managed from the CLI.** `dsh plugin --profile desktop add ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. Install desktop plugins only through the in-app Plugins page.

**方式一 / Option 1（推荐，联网，GitHub 仓库）：**
- **中文：** 打开 DSH 桌面端 GUI → 左侧「插件 / Plugins」→ **Install a third-party plugin** → 在弹窗里粘贴仓库地址 `https://github.com/RAECYY/dsh-cookie-pruner.git`（或 `github:RAECYY/dsh-cookie-pruner`）→ 确认安装。安装器会自动 `pnpm add` 依赖（`@deepseek-ai/schemastery`），并按 `package.json` 的 `dsh.bundle` 字段注册成桌面 bundle。
- **English:** Open the DSH desktop GUI → left sidebar **Plugins** → **Install a third-party plugin** → paste the repo URL `https://github.com/RAECYY/dsh-cookie-pruner.git` (or `github:RAECYY/dsh-cookie-pruner`) → confirm. The installer runs `pnpm add` for dependencies (`@deepseek-ai/schemastery`) and registers it as a desktop bundle via the `dsh.bundle` field.

**方式二 / Option 2（无需联网，本地目录）：**
- **中文：** 同样在「插件」页 → **Install a third-party plugin** → 选择本地目录 `D:\AI\dsh-cookie-pruner`。若走 `file:///` 手动注册（方式三），请先在该目录执行一次 `pnpm add @deepseek-ai/schemastery`（本仓库已内置 `node_modules` 时无需再跑）。
- **English:** Same Plugins page → **Install a third-party plugin** → pick the local directory `D:\AI\dsh-cookie-pruner`. If you register manually via `file:///` (Option 3), run `pnpm add @deepseek-ai/schemastery` once in that directory first (skip it if `node_modules` already exists).

**方式三 / Option 3（手动兜底 / manual fallback）：** 若弹窗两种方式都失败，手动在 `C:\Users\ASUS\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加（注意用 `file:///` 而非裸 `C:/`）：

```yaml
- insert:
  - id: dsh-cookie-pruner-host
    name: 'file:///D:/AI/dsh-cookie-pruner/index.js'
```

> **中文：** 若 `@deepseek-ai/schemastery` 解析不到，「设置」里的表单不会出现（插件仍照常自动清理，只是没有面板），不会影响 DSH 启动。
>
> **English:** If `@deepseek-ai/schemastery` cannot be resolved, the Settings form simply won't appear (auto-prune still works, there's just no panel). DSH startup is never affected.

**中文：** 装完请**完全退出并重启** DSH 桌面端（不是关掉这个聊天窗口，是把整个 DSH 应用退出再打开）。 / **English:** After installing, **fully quit and restart** the DSH desktop app (quit the whole app, not just this chat window, then reopen it).

## 验证 / Verification

1. **中文：** 装完重启后，打开 **设置 → 插件**，找到 `dsh-cookie-pruner-host` 这一项。 / **English:** After restarting, open **Settings → Plugins** and find the `dsh-cookie-pruner-host` entry.
2. **中文：** 表单里会显示这些字段：`lastCount`（当前 `dsh-auth-*` 总条数）、`available`（运行时 cookie 库是否可读）、`dryRun`（干跑开关）、`cleanRequest`（一键清理触发）、`lastResult`（上次清理结果）。 / **English:** The form shows: `lastCount` (current total), `available` (whether the store is readable), `dryRun`, `cleanRequest` (one-click clean trigger), `lastResult` (last outcome).
3. **中文：** **首装默认 `dryRun: true`（只统计、不删）**。先确认 `lastCount` 数字合理、`available` 为 true，再把 `dryRun` 改成 false。 / **English:** **On first install `dryRun: true` (count only, no deletion).** Confirm `lastCount` looks right and `available` is true, then set `dryRun` to false.
4. **中文：** 把 `cleanRequest` 勾上（或者切换成 true）→ 几秒内插件会清理到只剩最近 5 条，`lastCount` 随之下降，`lastResult` 显示“已删除 N 条，保留 M 条”。 / **English:** Toggle `cleanRequest` on → within a few seconds the plugin prunes down to the newest 5, `lastCount` drops, and `lastResult` reports "removed N, kept M".
5. **中文：** 确认桌面能正常启动（不再 431）。 / **English:** Confirm the desktop boots normally (no more 431).

> **中文：** 注意：这些字段是**运行时状态**（volatile），修改它们只会写进当前 profile 的内存配置，不会持久化到 YAML；插件每次启动都会重新计算 `lastCount`。真正需要持久的开关是 `autoPrune` / `dryRun` 等，它们在 `cordis.patch.yml` 的 `config:` 里配置。
>
> **English:** Note: these fields are **runtime state** (volatile) — editing them only updates the in-memory profile config, not the YAML. The plugin recomputes `lastCount` on every launch. Persistent switches (`autoPrune`, `dryRun`, …) belong in the `config:` block of `cordis.patch.yml`.

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
| `cleanPollMs` | 3000 | 轮询「一键清理」开关的间隔（3 秒）/ Poll interval for the clean toggle (3 s) |

## 安全说明 / Safety

- **中文：** 所有清理只针对 **名称以 `dsh-auth-` 开头、且属于 `127.0.0.1` 本地** 的 cookie；绝不碰其它 cookie。 / **English:** All cleanup only touches cookies whose **name starts with `dsh-auth-` and belong to the local `127.0.0.1`** host; no other cookies are ever touched.
- **中文：** 当前会话那条永远是最新的，一定被保留。 / **English:** The current session's cookie is always the newest and is always kept.
- **中文：** 插件代码全部 `try/catch` 包裹，**加载失败也不会拖垮 DSH 桌面端**（否则整页打不开）。`@deepseek-ai/schemastery` 用动态 `import()` 加载，缺失时只是没有设置表单。 / **English:** All plugin code is wrapped in `try/catch`; **even a load failure cannot break the DSH desktop** (otherwise the whole UI fails to open). `@deepseek-ai/schemastery` is loaded through a dynamic `import()`, so a missing dependency only means "no Settings form".
- **中文：** 不修改任何 asar / 程序文件；离线脚本只做重命名且保留 `.bak` 备份。 / **English:** No asar / program files are modified; the offline script only renames and keeps a `.bak` backup.

## 关于「设置页里的卡片」/ About the Settings-page integration

**中文：** v0.1.2 已移除原来的 `/dsh-cookie-pruner/` 网页面板，改为走 DSH 自带的设置表单（`dsh-settings` 会为任何声明了 `.volatile()` 字段的插件自动渲染表单）。因此面板就是「设置 → 插件 → `dsh-cookie-pruner-host`」那一项，不再是单独网址。

**English:** v0.1.2 removes the old `/dsh-cookie-pruner/` web dashboard and uses DSH's own settings form instead (`dsh-settings` auto-renders a form for any plugin that declares `.volatile()` fields). So the panel is simply the `dsh-cookie-pruner-host` entry under **Settings → Plugins**, not a separate URL.

> **中文：** 表单里渲染的是普通控件（数字 / 布尔开关），没有真正的「按钮」。所以“一键清理”是一个 `cleanRequest` 布尔开关：打开它=触发一次清理，插件处理完会立刻把它关回去。
>
> **English:** The form renders ordinary controls (number / boolean), not real buttons. So "one-click clean" is the `cleanRequest` boolean toggle: turn it on to request a prune; the plugin resets it to false right after handling it.

## License / 许可证

**MIT** — see [LICENSE](./LICENSE).
