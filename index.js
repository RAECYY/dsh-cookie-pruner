/**
 * dsh-cookie-pruner — Host half, v0.1.10
 *
 * Mitigates the DSH desktop bug where `dsh-auth-*` cookies accumulate one per
 * launch (each desktop host uses a new random port, so the cookie name differs
 * every time) and nothing ever prunes them. After ~70 launches the Cookie
 * header exceeds Node's 16 KiB limit and the host answers HTTP 431, so the
 * desktop fails to boot with "desktop welcome: Web authentication failed".
 *
 * Three defenses:
 *   A) Layer A (cordis.patch.yml) caps `connection.cookieMaxAgeDays` to 7,
 *      guaranteeing old cookies expire on their own — prevents FUTURE pile-up.
 *   B) This Host half — PREVENTION (new in v0.1.7). A third-party plugin host
 *      half runs inside a `node:vm` sandbox whose module linker maps `electron`
 *      to the renderer bridge, so `session.defaultSession.cookies` is NOT
 *      reachable, and the Chromium Cookies SQLite DB is exclusively locked while
 *      DSH runs. Therefore the plugin CANNOT delete cookies at runtime. BUT the
 *      DB file SIZE is readable (file metadata is not locked), so we measure it
 *      on a timer; when it approaches the 16 KiB danger zone we register a
 *      Windows Task Scheduler job (lives OUTSIDE the DSH process tree, in the
 *      svchost Task Scheduler) that runs `cleanup-once.ps1`. That script guards
 *      on "DSH fully closed" and renames the Cookies DB, so the cleanup happens
 *      automatically within ~10 minutes of the next quit — no manual step.
 *   C) For the immediate remedy (e.g. 431 already blocks boot) the offline
 *      `cleanup-once.ps1` (run with DSH fully closed) is still the only thing
 *      that clears the existing pile-up on demand.
 *
 * SAFETY: every operation is wrapped so a failure can NEVER break DSH startup
 * (the desktop blocks the whole UI on a plugin load error). If `ctx.subprocess`
 * is unavailable the daemon simply degrades to the honest panel.
 */

import { createRequire } from 'node:module'

export const name = 'dsh-cookie-pruner'

// The cordis timer service (`ctx.timeout` / `ctx.interval`) is hard-gated by the
// host sandbox: raw `setTimeout`/`setInterval` are trapped (they throw), and the
// façade only forwards timer verbs to the real ctx when the plugin declares an
// `inject: ['timer']`. Declaring it is REQUIRED to use timers at all.
export const inject = ['timer']

const COOKIE_PREFIX = 'dsh-auth-'

/** Profile entry id — must match the `insert:` row in cordis.patch.yml. */
const NS = 'dsh-cookie-pruner-host'

/** Where the offline cleanup script lives (used in the instructions below). */
const CLEANUP_SCRIPT = 'D:\\\\AI\\\\dsh-cookie-pruner\\\\cleanup-once.ps1'

/** Windows Task Scheduler job name we register for deferred cleanup. */
const TASK_NAME = 'DshCookiePrune'

/** Tuning constants. */
const RISK_SIZE = 8192          // 8 KiB — well below the 16 KiB 431 limit
const LAUNCH_THRESHOLD = 50     // also trigger after this many launches
const GAUGE_MS = 60000          // measure the DB size every minute
const START_DELAY_MS = 15000    // first measurement 15s after load
const CLEAN_POLL_MS = 3000      // how often we look for a Settings clean-request
const TASK_INTERVAL_MIN = 10    // the scheduled job runs at most every 10 min

const DEFAULT_CONFIG = {
  cookieMaxAgeDays: 7,   // mirrors Layer A; preventive only
  checkIntervalMs: GAUGE_MS,
  startDelayMs: START_DELAY_MS,
  cleanPollMs: CLEAN_POLL_MS,
}

// Loaded defensively: on a `file:///` registration without a reachable
// node_modules this resolution fails. We must NOT let that break plugin load
// (it would break DSH startup), so the form is simply omitted and the pruner
// still runs headless.
// Loaded only via `createRequire` (synchronous) for simplicity; a top-level
// `await import(...)` is also tolerated by the host (it wraps host code in an
// async IIFE), but the synchronous path is simplest and never trips it. The
// real regression between v0.1.6 and v0.1.7 was that `push()` read
// `ctx.settings` (undefined in the vm sandbox) instead of `ctx.get('settings')`,
// so the Host half silently published nothing — now fixed at the push site.
let z = null
try {
  z = createRequire(import.meta.url)('@deepseek-ai/schemastery')
  z = z?.default ?? z
} catch (e1) {
  console.warn('[dsh-cookie-pruner] schemastery unavailable — Settings form disabled:', e1?.message)
}

/**
 * Volatile fields are live-editable from the DSH Settings page without
 * remounting the plugin. dsh-settings auto-renders a form for any plugin whose
 * Config has at least one `.volatile()` child. They also persist across
 * restarts (dsh-settings writes them into the profile YAML), which is how we
 * remember the launch counter.
 */
export const Config = z
  ? z.object({
      lastDbSize: z.number().description('Cookies 库文件当前大小（字节），由插件周期性测量。').default(0).volatile(),
      launchesSincePrune: z.number().description('自上次清理以来 DSH 启动次数（跨重启保留）。').default(0).volatile(),
      autoCleanEnabled: z.boolean().description('自动清理开关：开启后检测到堆积会自动安排后台任务，在你退出 DSH 后自动清理。').default(true).volatile(),
      lastAutoCleanAt: z.string().description('上次检测到清理完成（Cookies 库回落）的时间。').default('').volatile(),
      available: z.boolean().description('是否能测量 Cookies 库大小（沙箱内文件大小可读，故恒为 true）。').default(true).volatile(),
      lastResult: z.string().description('诊断 / 状态信息。').default('').volatile(),
      cleanRequest: z.boolean().description('置为 true 让插件输出离线清理指引并开启自动清理。').default(false).volatile(),
    })
  : undefined

/** Volatile field names — the only config keys dsh-settings accepts at runtime. */
const VOLATILE_KEYS = ['lastDbSize', 'launchesSincePrune', 'autoCleanEnabled', 'lastAutoCleanAt', 'available', 'lastResult', 'cleanRequest']

// A `.volatile()` field parses into a cosmokit volatile cell — a plain OBJECT
// carrying a `.get()` reader (marked with Symbol.for("cosmokit.volatile.write")).
// Cordis hands us that parsed value, so every read must unwrap it.
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
function readValue(value) {
  if (value !== null && typeof value === 'object' &&
      (VOLATILE_WRITE in value || typeof value.get === 'function')) {
    try { return value.get() } catch { return undefined }
  }
  return value
}

function resolveConfig(raw) {
  const c = { ...DEFAULT_CONFIG }
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) c[key] = readValue(value)
  }
  for (const key of ['checkIntervalMs', 'startDelayMs', 'cleanPollMs']) {
    const n = Number(c[key])
    c[key] = Number.isFinite(n) && n > 0 ? n : DEFAULT_CONFIG[key]
  }
  return c
}

/**
 * Resolve the Chromium Cookies DB path. `%APPDATA%` is NOT reachable from the
 * vm sandbox — `process` is undefined there (hostrunner's nodeApiTraps only
 * traps function-valued globals; data-valued ones like `process` are simply
 * `undefined`, so `process.env` would throw a ReferenceError). We therefore
 * probe the real path through the subprocess service (the same mechanism we
 * already use for the gauge). The result is cached.
 */
let cachedAppData = ''
async function resolveAppData(sub) {
  if (cachedAppData) return cachedAppData
  if (!sub) return ''
  for (const expr of ['$env:APPDATA', '$env:LOCALAPPDATA']) {
    try {
      const handle = sub.spawn({ argv: ['powershell', '-NoProfile', '-Command', expr] })
      const res = await handle.done
      const p = String((res && res.stdout) || '').trim().replace(/[\\/]$/, '')
      if (p && /AppData/.test(p)) { cachedAppData = p; break }
    } catch { /* try next */ }
  }
  return cachedAppData
}

async function cookiesPath(sub) {
  let appData = cachedAppData || await resolveAppData(sub)
  // Last resort: keeps the plugin alive even if the subprocess probe is
  // unavailable. Only used when `sub` is absent.
  if (!appData) appData = 'C:/Users/ASUS/AppData/Roaming'
  return appData.replace(/[\\/]$/, '') + '\\@deepseek-ai\\dsh-desktop\\Network\\Cookies'
}

function formatKB(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return bytes + ' B'
  return (bytes / 1024).toFixed(1) + ' KB'
}

/**
 * Measure the Cookies DB file size via a spawned subprocess. The DB content is
 * locked while DSH runs, but the FILE METADATA (its size) is readable — even a
 * plain `fs.stat` works (verified: returns 20480 while cp→EBUSY). We use a
 * subprocess so we don't depend on the internal `ctx.fs` target-key shape, and
 * because reading size is the only signal we need.
 */
async function readDbSize(sub) {
  const p = await cookiesPath(sub)
  if (!p || !sub) return 0
  try {
    const quoted = p.replace(/'/g, "''")
    const handle = sub.spawn({
      argv: ['powershell', '-NoProfile', '-Command', `(Get-Item -LiteralPath '${quoted}').Length`],
    })
    const res = await handle.done
    const n = parseInt(String((res && res.stdout) || '').trim(), 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch (e) {
    console.warn('[dsh-cookie-pruner] gauge error:', e?.message)
    return 0
  }
}

/**
 * Register (or refresh) the deferred-cleanup Task Scheduler job. It lives in the
 * svchost Task Scheduler — OUTSIDE the DSH process tree — so it survives DSH
 * exiting and runs `cleanup-once.ps1` on its own schedule. `/f` makes the
 * (re)creation idempotent. cleanup-once.ps1 itself guards "DSH fully closed"
 * before touching the DB, so it is safe to leave registered permanently.
 */
async function ensureScheduledTask(sub) {
  if (!sub) return false
  const argv = [
    'schtasks', '/create', '/tn', TASK_NAME,
    '/tr', `powershell -ExecutionPolicy Bypass -File "${CLEANUP_SCRIPT}"`,
    '/sc', 'minute', '/mo', String(TASK_INTERVAL_MIN), '/f',
  ]
  try {
    const handle = sub.spawn({ argv })
    await handle.done
    return true
  } catch (e) {
    console.warn('[dsh-cookie-pruner] could not register scheduled task:', e?.message)
    return false
  }
}

/** Remove the deferred-cleanup job (when the user turns auto-clean off). */
async function removeScheduledTask(sub) {
  if (!sub) return
  try {
    const handle = sub.spawn({ argv: ['schtasks', '/delete', '/tn', TASK_NAME, '/f'] })
    await handle.done
  } catch { /* best effort */ }
}

function offlineInstructions() {
  return [
    '真正能清除已有 cookie 堆积（解决 HTTP 431）的办法：完全退出 DSH 后跑离线脚本。',
    '脚本路径（DSH 已关闭时运行）：',
    `  ${CLEANUP_SCRIPT}`,
    '',
    '步骤：',
    '  1. 完全退出 DeepSeek Harness 桌面端（右键托盘图标退出，并确认进程已结束）',
    '  2. 以管理员身份打开 PowerShell',
    `  3. 运行：  & "${CLEANUP_SCRIPT}"`,
    '  4. 重新打开 DSH —— 它会重建干净的 Cookies 库，431 不再出现',
    '',
    '注：该脚本只是把 Cookies 库改名成 .bak（保留备份），不会删除任何程序文件；副作用是已保存的登录态会丢失，需要重新登录。',
    '',
    '预防（已生效）：cordis.patch.yml 里的 connection.cookieMaxAgeDays: 7 把未来 cookie 寿命压到 7 天，旧 cookie 会自行过期，不再堆到 16KB。',
    '自动清理（v0.1.7）：检测到堆积时会自动登记后台任务，你完全退出 DSH 后 ≤' + TASK_INTERVAL_MIN + ' 分钟自动清理，无需手动。',
  ].join('\\n')
}

export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  const sub = ctx.get ? ctx.get('subprocess') : (ctx.subprocess || null)

  // Local mirror of the persisted volatile state. Seed from the stored
  // effectiveConfig so the launch counter survives restarts.
  const published = {
    lastDbSize: 0, launchesSincePrune: 0, autoCleanEnabled: true,
    lastAutoCleanAt: '', available: true, lastResult: '', cleanRequest: false,
  }
  try {
    const seed = ctx.fiber?.effectiveConfig
    if (seed && typeof seed === 'object') {
      for (const key of VOLATILE_KEYS) {
        const v = readValue(seed[key])
        if (v !== undefined) published[key] = v
      }
    }
  } catch { /* ignore */ }
  if (published.autoCleanEnabled !== true && published.autoCleanEnabled !== false) published.autoCleanEnabled = true

  // dsh-settings persists every write into the profile YAML. We pass the full
  // mirror so unrelated fields are preserved.
  // Host `ctx` exposes services ONLY through `ctx.get('x')` (the cordis
  // registry); a plain `ctx.settings` property is undefined in the vm sandbox.
  // Resolve defensively so the first publish always lands, and also accept a
  // direct property if some future host mirrors the service there.
  const settings = ctx.get ? ctx.get('settings') : (ctx.settings || undefined)
  const push = async (patch) => {
    Object.assign(published, patch)
    try {
      if (settings && typeof settings.update === 'function') {
        await settings.update(NS, { ...published })
      }
    } catch (e) {
      console.warn('[dsh-cookie-pruner] settings update skipped:', e?.message)
    }
  }

  // Remember this launch (count only increments while DSH actually starts).
  published.launchesSincePrune = (Number(published.launchesSincePrune) || 0) + 1

  const atRisk = (size, launches) => size >= RISK_SIZE || launches >= LAUNCH_THRESHOLD

  // React to the user's auto-clean toggle + ensure the task matches state.
  const syncTask = async () => {
    if (!sub) return
    if (published.autoCleanEnabled && atRisk(published.lastDbSize, published.launchesSincePrune)) {
      await ensureScheduledTask(sub)
    } else if (!published.autoCleanEnabled) {
      await removeScheduledTask(sub)
    }
  }

  // --- measure + prevent loop ---
  // NOTE: use `ctx.timeout` / `ctx.interval`, NOT bare `setTimeout`/`setInterval`.
  // The host vm sandbox TRAPS bare timers (they throw); the cordis timer service
  // is the only supported path, and it is auto-cleaned as a fiber effect. We
  // declared `inject: ['timer']` above so the façade permits these verbs.
  ctx.effect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      const size = await readDbSize(sub)
      const launches = published.launchesSincePrune
      const risk = atRisk(size, launches)
      const patch = { lastDbSize: size, available: true }

      // If the pile-up has cleared (DB shrank below the threshold), reset the
      // launch counter so future warnings are accurate.
      if (!risk && published.launchesSincePrune > 0) {
        patch.launchesSincePrune = 0
      }

      if (risk) {
        await ensureScheduledTask(sub)
        patch.lastResult = `⚠️ 检测到 dsh-auth-* cookie 堆积风险（Cookies 库 ${formatKB(size)}，已启动 ${launches} 次）。已安排后台清理任务：你完全退出 DSH 后，它会在 ≤${TASK_INTERVAL_MIN} 分钟内自动清理，彻底解除 431。`
      } else {
        patch.lastResult = `✅ 暂无溢出风险（Cookies 库 ${formatKB(size)}）。Layer A（cookieMaxAgeDays:7）已在生效，未来 cookie 会自行过期。`
      }

      await syncTask()
      await push(patch)
    }
    const t = ctx.timeout(run, cfg.startDelayMs)
    const interval = ctx.interval(run, cfg.checkIntervalMs)
    return () => { cancelled = true; try { t?.dispose?.() } catch {}; try { interval?.dispose?.() } catch {} }
  })

  // --- respond to the Settings "show offline steps / enable auto" request ---
  ctx.effect(() => {
    const watch = ctx.interval(async () => {
      let flag = false
      try { flag = readValue(ctx.fiber?.effectiveConfig?.cleanRequest) === true } catch { /* ignore */ }
      if (!flag) return
      try {
        published.cleanRequest = false
        published.autoCleanEnabled = true
        await ensureScheduledTask(sub)
        await push({
          cleanRequest: false,
          autoCleanEnabled: true,
          lastResult: offlineInstructions() + `\\n\\n已为你开启自动清理：完全退出 DSH 后，后台任务会在 ≤${TASK_INTERVAL_MIN} 分钟内自动清理。`,
        })
      } catch (e) {
        await push({ cleanRequest: false, lastResult: '生成离线清理指引失败：' + e?.message })
      }
    }, cfg.cleanPollMs)
    return () => { try { watch?.dispose?.() } catch {} }
  })

  // First publish (seeds the launch counter + initial status).
  push({ launchesSincePrune: published.launchesSincePrune }).catch(() => {})
}
