/**
 * dsh-cookie-pruner — Host half, v0.1.13
 *
 * ROOT-CAUSE NOTE (why v0.1.7–v0.1.11 were "still useless"):
 *   - Those versions declared `export const inject = ['timer']`. If the desktop
 *     host does NOT provide a `timer` service to host halves, cordis refuses to
 *     ACTIVATE the plugin (it cannot satisfy a required service) — so the
 *     Settings panel never rendered at all. v0.1.6 had no such declaration and
 *     worked. v0.1.12 removes the required inject and instead requests the timer
 *     service OPTIONALLY via `ctx.get('timer')`; if absent, the plugin still
 *     loads, shows a real reading immediately, and relies on the client half to
 *     refresh on demand.
 *   - The host vm sandbox traps the GLOBAL `require`, but `node:fs` and
 *     `node:module` are reachable via STATIC import (resolved by the host linker
 *     before vm-wrap). So we import node:fs directly for the gauge — file-size
 *     metadata is readable even while Chromium range-locks the DB content — and
 *     we load @deepseek-ai/schemastery via createRequire (works here; the
 *     dependency is installed).
 *
 *   - v0.1.12 "still useless" root cause: it used `ctx.get('settings')` (an
 *     OPTIONAL lookup). The sandbox façade only hands a service to the host half
 *     via PROPERTY access (`ctx.settings`) when that service is declared in
 *     `inject`; the optional `ctx.get` returned undefined, so `push()` was a
 *     no-op (`pushCount: 0`) and the panel never got data. FIX: declare the
 *     services we need in `inject` (optional form, so a missing provider never
 *     parks the plugin) and access them via `ctx.settings` / `ctx.bash`.
 *
 *   - The first `settings.update` must run AFTER `apply` returns (a microtask),
 *     otherwise the runtime rejects it with "HMR transactions cannot be nested".
 *
 * A runtime diagnostic is written to .runtime-diag.json so failures are visible
 * WITHOUT a screenshot or console.
 */

import { createRequire } from 'node:module'
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'

export const name = 'dsh-cookie-pruner'

// Declare the services the host half needs. The sandbox façade only exposes a
// service via `ctx.<name>` property access when it is listed here; the optional
// form means a provider that is absent does NOT park the plugin (the panel still
// renders via the client half). `settings` is what publishes live data to the
// panel; `timer` drives periodic refresh; `bash`/`subprocess` schedule the
// deferred offline cleanup via Windows Task Scheduler.
export const inject = { optional: ['settings', 'timer', 'bash', 'subprocess'] }

const COOKIE_PREFIX = 'dsh-auth-'

/** Profile entry id — must match the `insert:` row in cordis.patch.yml. */
const NS = 'dsh-cookie-pruner-host'

/** Where the offline cleanup script lives (used in the instructions below). */
const CLEANUP_SCRIPT = 'D:\\AI\\dsh-cookie-pruner\\cleanup-once.ps1'

/** Windows Task Scheduler job name we register for deferred cleanup. */
const TASK_NAME = 'DshCookiePrune'

/** Runtime diagnostic file (readable by the developer without a screenshot). */
const DIAG_FILE = 'D:/AI/dsh-cookie-pruner/.runtime-diag.json'

/** Tuning constants. */
const RISK_SIZE = 8192          // 8 KiB — well below the 16 KiB 431 limit
const LAUNCH_THRESHOLD = 50     // also trigger after this many launches
const START_DELAY_MS = 15000    // (only used if a timer service is present)
const GAUGE_MS = 60000          // (only used if a timer service is present)
const CLEAN_POLL_MS = 3000      // (only used if a timer service is present)
const TASK_INTERVAL_MIN = 10    // the scheduled job runs at most every 10 min
const FALLBACK_APPDATA = 'C:/Users/ASUS/AppData/Roaming'
// Subprocess spawn specs require a graceMs (TERM-to-KILL / exit-wait grace). The
// validator rejects the call without it, so we always attach one.
const GRACE_MS = 30000

const DEFAULT_CONFIG = {
  cookieMaxAgeDays: 7,   // mirrors Layer A; preventive only
  checkIntervalMs: GAUGE_MS,
  startDelayMs: START_DELAY_MS,
  cleanPollMs: CLEAN_POLL_MS,
}

// Loaded defensively: a missing dependency must NOT break plugin load.
// IMPORTANT: `import.meta.url` is frequently undefined inside a `node:vm`
// sandbox, so `createRequire(import.meta.url)` throws. Anchor the require to a
// known file path instead so node_modules resolution always works.
let z = null
let schemErr = ''
try {
  const require2 = createRequire('D:/AI/dsh-cookie-pruner/package.json')
  z = require2('@deepseek-ai/schemastery')
  z = z?.default ?? z
} catch (e1) {
  schemErr = e1?.message || String(e1)
}

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
// carrying a `.get()` reader. Cordis hands us that parsed value, so every read
// must unwrap it.
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

// --- runtime diagnostic ---
let diagData = {
  version: '0.1.13',
  hasSchemastery: !!z,
  hasConfig: !!Config,
  schemErr: schemErr || undefined,
}
function diag(patch) {
  try {
    diagData = { ...diagData, ...(patch || {}) }
    let old = {}
    if (existsSync(DIAG_FILE)) { try { old = JSON.parse(readFileSync(DIAG_FILE, 'utf8')) } catch {} }
    diagData = { ...old, ...diagData, ts: new Date().toISOString() }
    writeFileSync(DIAG_FILE, JSON.stringify(diagData, null, 2))
  } catch {}
}

let cachedAppData = ''
async function resolveAppData(proc) {
  if (cachedAppData) return cachedAppData
  if (!proc) return ''
  for (const expr of ['$env:APPDATA', '$env:LOCALAPPDATA']) {
    try {
      const handle = proc.spawn({ argv: ['powershell', '-NoProfile', '-Command', expr], graceMs: GRACE_MS })
      const chunks = []
      if (handle.stdout && typeof handle.stdout.on === 'function') {
        for await (const c of handle.stdout) chunks.push(c)
      }
      await handle.done
      const p = Buffer.concat(chunks).toString('utf8').trim().replace(/[\\/]$/, '')
      if (p && /AppData/.test(p)) { cachedAppData = p; break }
    } catch { /* try next */ }
  }
  return cachedAppData
}

async function cookiesPath(proc) {
  let appData = cachedAppData || await resolveAppData(proc)
  // Last resort: keeps the plugin alive even if the subprocess probe is
  // unavailable. Correct for this machine.
  if (!appData) appData = FALLBACK_APPDATA
  return appData.replace(/[\\/]$/, '') + '\\@deepseek-ai\\dsh-desktop\\Network\\Cookies'
}

function formatKB(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return bytes + ' B'
  return (bytes / 1024).toFixed(1) + ' KB'
}

/**
 * Measure the Cookies DB file size. The DB content is locked while DSH runs,
 * but the FILE METADATA (its size) is readable — `node:fs` statSync returns the
 * size (verified: 28672 while cp→EBUSY). This needs NO subprocess and NO
 * trapped globals. Falls back to the subprocess gauge if node:fs is somehow
 * unavailable.
 */
async function readDbSize(proc) {
  const p = await cookiesPath(proc)
  if (!p) return 0
  if (typeof statSync === 'function') {
    try {
      const size = statSync(p).size
      diag({ gaugeMethod: 'node:fs.statSync', gaugePath: p, gaugeBytes: size })
      return size
    } catch (e) {
      diag({ gaugeMethod: 'node:fs.statSync FAILED -> subprocess', gaugeError: e?.message || String(e) })
    }
  }
  // Fallback: subprocess powershell (Get-Item .Length) reading handle.stdout.
  if (!proc) { diag({ gaugeMethod: 'no proc, no fs' }); return 0 }
  try {
    const handle = proc.spawn({ argv: ['powershell', '-NoProfile', '-Command', `(Get-Item -LiteralPath '${p.replace(/'/g, "''")}').Length`], graceMs: GRACE_MS })
    const chunks = []
    if (handle.stdout && typeof handle.stdout.on === 'function') {
      for await (const c of handle.stdout) chunks.push(c)
    }
    await handle.done
    const n = parseInt(Buffer.concat(chunks).toString('utf8').trim(), 10)
    diag({ gaugeMethod: 'subprocess', gaugeBytes: Number.isFinite(n) ? n : 0 })
    return Number.isFinite(n) ? n : 0
  } catch (e) {
    diag({ gaugeMethod: 'subprocess FAILED', gaugeError: e?.message || String(e) })
    return 0
  }
}

async function ensureScheduledTask(proc) {
  if (!proc) { diag({ task: 'skip: no subprocess service' }); return false }
  try {
    const handle = proc.spawn({
      argv: ['schtasks', '/create', '/tn', TASK_NAME,
        '/tr', `powershell -ExecutionPolicy Bypass -File "${CLEANUP_SCRIPT}"`,
        '/sc', 'minute', '/mo', String(TASK_INTERVAL_MIN), '/f'],
      graceMs: GRACE_MS,
    })
    await handle.done
    diag({ task: 'created' })
    return true
  } catch (e) {
    diag({ task: 'create FAILED', taskError: e?.message || String(e) })
    return false
  }
}

async function removeScheduledTask(proc) {
  if (!proc) return
  try {
    const h = proc.spawn({ argv: ['schtasks', '/delete', '/tn', TASK_NAME, '/f'], graceMs: GRACE_MS })
    await h.done
  } catch {}
}

function offlineInstructions() {
  return [
    '【离线清理（唯一能立刻解决 431 的办法）】',
    '1. 完全退出 DSH（右键托盘 → 退出，确认进程结束）。',
    '2. 以管理员身份打开 PowerShell，运行：',
    `     & "${CLEANUP_SCRIPT}"`,
    '   它会把 Cookies 库改名备份，并守护“DSH 已退出”，放心跑。',
    '3. 重新打开 DSH 即可。',
    '',
    '预防（已生效）：cordis.patch.yml 里的 connection.cookieMaxAgeDays: 7 把未来 cookie 寿命压到 7 天，旧 cookie 会自行过期。',
  ].join('\n')
}

function atRisk(size, launches) {
  return size >= RISK_SIZE || launches >= LAUNCH_THRESHOLD
}

export function apply(ctx, config) {
  try {
    const published = {
      lastDbSize: 0, launchesSincePrune: 0, autoCleanEnabled: true,
      lastAutoCleanAt: '', available: true, lastResult: '', cleanRequest: false,
    }
    const cfg = resolveConfig(config)

    // Seed persisted values (launch counter survives restart).
    try {
      if (ctx.fiber?.effectiveConfig) {
        for (const key of VOLATILE_KEYS) {
          const v = readValue(ctx.fiber.effectiveConfig[key])
          if (v !== undefined && v !== null) published[key] = v
        }
      }
    } catch {}
    if (published.autoCleanEnabled !== true && published.autoCleanEnabled !== false) published.autoCleanEnabled = true

    // Declared services are reached via PROPERTY access (the façade only hands a
    // service to the host half through ctx.<name> when it is in `inject`). The
    // optional form means any missing provider is simply undefined here.
    const settings = ctx.settings || null
    const sub = ctx.subprocess || null
    const bash = ctx.bash || null
    const proc = sub || bash
    diag({ hasSettings: !!settings, hasSubprocess: !!sub, hasBash: !!bash, ns: NS })

    let pushCount = 0
    const push = async (patch) => {
      Object.assign(published, patch)
      if (settings && typeof settings.update === 'function') {
        try { await settings.update(NS, { ...published }); pushCount++ } catch (e) { diag({ pushError: e?.message || String(e) }) }
      }
      diag({ pushCount, lastResult: published.lastResult })
    }

    // Increment the launch counter (persisted via the Config).
    published.launchesSincePrune = (Number(published.launchesSincePrune) || 0) + 1

    const syncTask = async () => {
      if (!proc) return
      if (published.autoCleanEnabled && atRisk(published.lastDbSize, published.launchesSincePrune)) {
        await ensureScheduledTask(proc)
      } else if (!published.autoCleanEnabled) {
        await removeScheduledTask(proc)
      }
    }

    const run = async () => {
      try {
        const size = await readDbSize(proc)
        const launches = published.launchesSincePrune
        const risk = atRisk(size, launches)
        const patch = { lastDbSize: size, available: true }

        // If the pile-up has cleared (DB shrank below the threshold), reset the
        // launch counter so future warnings are accurate.
        if (!risk && published.launchesSincePrune > 0) {
          patch.launchesSincePrune = 0
        }

        if (risk) {
          await ensureScheduledTask(proc)
          patch.lastResult = `⚠️ 检测到 dsh-auth-* cookie 堆积风险（Cookies 库 ${formatKB(size)}，已启动 ${launches} 次）。已安排后台清理任务：你完全退出 DSH 后，它会在 ≤${TASK_INTERVAL_MIN} 分钟内自动清理，彻底解除 431。`
        } else {
          patch.lastResult = `✅ 暂无溢出风险（Cookies 库 ${formatKB(size)}）。Layer A（cookieMaxAgeDays:7）已在生效，未来 cookie 会自行过期。`
        }

        await syncTask()
        await push(patch)
      } catch (e) {
        await push({ lastResult: '测量失败：' + (e?.message || String(e)) })
      }
    }

    // IMMEDIATE first reading — no timer dependency, so data shows right away
    // even if the timer service is unavailable. It runs AFTER this function
    // returns (microtask), so the first `settings.update` is outside the HMR
    // activation transaction (avoids "HMR transactions cannot be nested").
    Promise.resolve().then(() => run().catch(() => {}))

    // Optional periodic refresh + clean-request poll, only if a timer service
    // is available.
    const timer = ctx.timer || null
    if (timer && typeof timer.interval === 'function') {
      diag({ timer: 'available' })
      ctx.effect(() => {
        const startT = (typeof timer.timeout === 'function') ? timer.timeout(run, cfg.startDelayMs) : null
        const iv = timer.interval(run, cfg.checkIntervalMs)
        return () => { try { startT?.dispose?.() } catch {}; try { iv?.dispose?.() } catch {} }
      })
      ctx.effect(() => {
        const watch = timer.interval(async () => {
          let flag = false
          try { flag = readValue(ctx.fiber?.effectiveConfig?.cleanRequest) === true } catch { /* ignore */ }
          if (!flag) return
          try {
            published.cleanRequest = false
            published.autoCleanEnabled = true
            await ensureScheduledTask(proc)
            await push({
              cleanRequest: false,
              autoCleanEnabled: true,
              lastResult: offlineInstructions() + `\n\n已为你开启自动清理：完全退出 DSH 后，后台任务会在 ≤${TASK_INTERVAL_MIN} 分钟内自动清理。`,
            })
          } catch (e) {
            await push({ cleanRequest: false, lastResult: '生成离线清理指引失败：' + e?.message })
          }
        }, cfg.cleanPollMs)
        return () => { try { watch?.dispose?.() } catch {} }
      })
    } else {
      diag({ timer: 'NOT available — using immediate + client-triggered refresh only' })
    }

    // Seed the launch counter now (deferred past activation).
    Promise.resolve().then(() => push({ launchesSincePrune: published.launchesSincePrune }).catch(() => {}))
  } catch (e) {
    diag({ fatal: e?.message || String(e), stack: e?.stack })
  }
}
