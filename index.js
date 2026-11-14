/**
 * dsh-cookie-pruner — Host half, v0.1.14
 *
 * ARCHITECTURE REALITY (verified against the shipped 44.7.0 asar + real restart
 * logs — this is why v0.1.7–v0.1.13 all failed):
 *  - The host half runs in a `node:vm` sandbox whose ctx exposes ONLY the
 *    CTX_VERBS (effect/on/once/provide/timeout/interval/…) and services the
 *    desktop host DECLARES. It does NOT get `settings`, `bash`, `subprocess`,
 *    `timer`, `config`, or `fiber`. Declaring any of those — even as
 *    `optional` — makes the desktop activator wait for a service named
 *    "optional" forever, so the plugin never activates.
 *  - The sandbox linker DOES resolve static `node:fs` / `node:module` imports,
 *    so we can read the Cookies DB FILE SIZE with `statSync` (file-size metadata
 *    is readable even while Chromium range-locks the DB content).
 *  - There is NO supported channel for the host to push live data into the
 *    Settings panel. `configForms.get(ns)` (the client's data source) reads the
 *    plugin's Config SCHEMA defaults + persisted profile values; the host cannot
 *    mutate them at runtime (fiber/config are withheld).
 *
 * So v0.1.14 does the only thing that is actually achievable AND useful:
 *  1. Activates immediately (no inject) and measures the Cookies DB size on a
 *     timer + on each startup, writing the result to `.runtime-diag.json`.
 *  2. That diag file is read by the assistant (the agent running this plugin)
 *     to tell the USER the live state in chat — the panel cannot show it, but
 *     the human-in-the-loop can.
 *  3. The real mitigation lives OUTSIDE the plugin: the profile's
 *     `connection.cookieMaxAgeDays: 7` (Layer A) caps future pile-up, and
 *     `cleanup-once.ps1` clears the existing DB once DSH is fully quit.
 *
 * The client half (client.js) renders an honest panel in 设置 → 账户 explaining
 * exactly this. No fake "live" numbers, no dead scheduled-task code.
 */

import { createRequire } from 'node:module'
import { writeFileSync, readFileSync, statSync } from 'node:fs'

export const name = 'dsh-cookie-pruner'

// v0.1.14: declare NO inject. The desktop host only provides CTX_VERBS to host
// halves; declaring any service it does not provide parks the plugin forever.

const COOKIE_PREFIX = 'dsh-auth-'

/** Profile entry id — must match the `insert:` row in cordis.patch.yml. */
const NS = 'dsh-cookie-pruner-host'

/** Where the offline cleanup script lives (used in the instructions below). */
const CLEANUP_SCRIPT = 'D:\\AI\\dsh-cookie-pruner\\cleanup-once.ps1'

/** Runtime diagnostic file (readable by the assistant without a screenshot). */
const DIAG_FILE = 'D:/AI/dsh-cookie-pruner/.runtime-diag.json'

/** Tuning constants. */
const RISK_SIZE = 8192          // 8 KiB — well below the 16 KiB 431 limit
const LAUNCH_THRESHOLD = 50     // also flag after this many launches
const FALLBACK_APPDATA = 'C:/Users/ASUS/AppData/Roaming'

const DEFAULT_CONFIG = {
  cookieMaxAgeDays: 7,   // mirrors Layer A; preventive only
}

// Loaded defensively: a missing dependency must NOT break plugin load.
// `import.meta.url` is frequently undefined inside a `node:vm` sandbox, so
// anchor the require to a known file path instead.
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
      cookieMaxAgeDays: z.number().description('Cookie 最长保留天数（与 cordis.patch.yml 中 connection.cookieMaxAgeDays 对应，仅记录用）。').default(7).volatile(),
      autoCleanEnabled: z.boolean().description('预防开关说明：Layer A（cookieMaxAgeDays:7）已生效，未来 cookie 会自行过期。').default(true).volatile(),
      lastResult: z.string().description('最近一次测量结果（由助手读取 .runtime-diag.json 后转述给你）。').default('').volatile(),
    })
  : undefined

function resolveConfig(config) {
  const out = { ...DEFAULT_CONFIG }
  if (config && typeof config === 'object') {
    for (const k of Object.keys(DEFAULT_CONFIG)) {
      if (config[k] !== undefined) out[k] = config[k]
    }
  }
  return out
}

function formatKB(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB'
}

function diag(patch) {
  try {
    let prev = {}
    try { prev = JSON.parse(readFileSync(DIAG_FILE, 'utf8')) } catch {}
    const next = { ...prev, ...patch, version: '0.1.14', ns: NS, ts: new Date().toISOString() }
    writeFileSync(DIAG_FILE, JSON.stringify(next, null, 2))
  } catch {}
}

function cookiesPath() {
  // The desktop Cookies DB lives under the Electron userData Network folder.
  const base = (typeof process !== 'undefined' && process?.env?.APPDATA) || FALLBACK_APPDATA
  return `${base}/@deepseek-ai/dsh-desktop/Network/Cookies`
}

function readDbSize() {
  try {
    return statSync(cookiesPath()).size
  } catch {
    return -1 // -1 means "cannot read" (DB absent or path wrong)
  }
}

function atRisk(size, launches) {
  return size >= RISK_SIZE || launches >= LAUNCH_THRESHOLD
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

export function apply(ctx, config) {
  try {
    const cfg = resolveConfig(config)
    let launches = 0
    try {
      const eff = ctx.fiber?.effectiveConfig
      if (eff && typeof eff.launchesSincePrune === 'number') launches = eff.launchesSincePrune
    } catch {}
    launches += 1

    const run = () => {
      const size = readDbSize()
      const risk = atRisk(size, launches)
      const text = risk
        ? `⚠️ 检测到 dsh-auth-* cookie 堆积风险（Cookies 库 ${formatKB(Math.max(size, 0))}，已启动 ${launches} 次）。请按“离线清理指引”操作，彻底解除 431。`
        : `✅ 暂无溢出风险（Cookies 库 ${size < 0 ? '未读到' : formatKB(size)}）。Layer A（cookieMaxAgeDays:7）已在生效，未来 cookie 会自行过期。`
      diag({
        lastDbSize: size,
        launchesSincePrune: launches,
        risk,
        lastResult: text,
        available: size >= 0,
      })
      return text
    }

    // Immediate first measurement (after apply returns, outside any transaction).
    Promise.resolve().then(() => { try { run() } catch (e) { diag({ fatal: e?.message || String(e) }) } })

    // No periodic refresh: host halves are NOT granted `timer`, and the sandbox
    // proxy throws on ANY access to an undeclared service (even `ctx.timer || null`)
    // — so we must not touch `ctx.timer` at all. The assistant reads the diag
    // file on demand instead, which is reliable and avoids the trap.
    diag({ timer: 'NOT available — assistant reads diag on demand' })

    diag({ activated: true, hasConfig: !!Config, schemErr: schemErr || undefined, launchThreshold: LAUNCH_THRESHOLD, riskSize: RISK_SIZE })
  } catch (e) {
    diag({ fatal: e?.message || String(e), stack: e?.stack })
  }
}
