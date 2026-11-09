/**
 * dsh-cookie-pruner — Host half
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
 *   B) This Host half. IMPORTANT HONEST NOTE (v0.1.6): a third-party plugin
 *      host half runs inside a `node:vm` sandbox whose module linker maps
 *      `electron` to the *renderer* bridge, so `session.defaultSession.cookies`
 *      is NOT reachable from here. There is also no `ctx.cookies`/`ctx.session`
 *      service, and the Chromium Cookies SQLite DB is exclusively locked while
 *      DSH runs. Therefore the plugin CANNOT read or delete the cookies at
 *      runtime. Instead it detects the situation, publishes a precise diagnostic
 *      into the "Cookie 清理" Settings section (bottom-left account → 设置),
 *      and — when asked — prints the offline cleanup instructions.
 *   C) For the actual 431 remedy, ship the offline `cleanup-once.ps1` (run with
 *      DSH fully closed) that renames the Chromium Cookies DB so DSH rebuilds a
 *      clean one. This is the ONLY thing that clears the existing pile-up.
 *
 * SAFETY: we never read/write files outside the documented paths, and every
 * operation is wrapped so a failure can NEVER break DSH startup (the desktop
 * blocks the whole UI on a plugin load error).
 */

import { createRequire } from 'node:module'

export const name = 'dsh-cookie-pruner'

const COOKIE_PREFIX = 'dsh-auth-'

/** Profile entry id — must match the `insert:` row in cordis.patch.yml. */
const NS = 'dsh-cookie-pruner-host'

/** Where the offline cleanup script lives (used in the instructions below). */
const CLEANUP_SCRIPT = 'D:\\AI\\dsh-cookie-pruner\\cleanup-once.ps1'

// Config schema (read via the plugin's Config export / cordis; defaults here).
const DEFAULT_CONFIG = {
  cookieMaxAgeDays: 7,   // mirrors Layer A; preventive only
  autoPrune: true,       // Layer A cap is on (prevents future pile-up)
  checkIntervalMs: 300000, // 5 minutes — how often we refresh the diagnostic
  startDelayMs: 30000,     // 30s after load
  cleanPollMs: 3000,       // how often we look for a Settings clean-request
  countPollMs: 15000,      // re-publish the diagnostic so it stays fresh
}

// Loaded defensively: on a `file:///` registration without a reachable
// node_modules this resolution fails. We must NOT let that break plugin load
// (it would break DSH startup), so the form is simply omitted and the pruner
// still runs headless.
let z = null
try {
  z = createRequire(import.meta.url)('@deepseek-ai/schemastery')
  z = z?.default ?? z
} catch (e1) {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    z = mod.default ?? mod
  } catch (e2) {
    console.warn('[dsh-cookie-pruner] schemastery unavailable — Settings form disabled:', e2?.message || e1?.message)
  }
}

/**
 * Volatile fields are live-editable from the DSH Settings page without
 * remounting the plugin. dsh-settings auto-renders a form for any plugin whose
 * Config has at least one `.volatile()` child.
 */
export const Config = z
  ? z.object({
      lastCount: z.number().description('当前 dsh-auth-* cookie 条数（-1 = 沙箱读不到）').default(-1).volatile(),
      available: z.boolean().description('运行时 cookie 存储是否可读（本架构下恒为 false）').default(false).volatile(),
      cleanRequest: z.boolean().description('置为 true 让插件输出离线清理指引').default(false).volatile(),
      lastResult: z.string().description('诊断 / 离线清理指引').default('').volatile(),
    })
  : undefined

/** Volatile field names — the only config keys dsh-settings accepts at runtime. */
const VOLATILE_KEYS = ['lastCount', 'available', 'cleanRequest', 'lastResult']

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
  for (const key of ['checkIntervalMs', 'startDelayMs', 'cleanPollMs', 'countPollMs']) {
    const n = Number(c[key])
    c[key] = Number.isFinite(n) && n > 0 ? n : DEFAULT_CONFIG[key]
  }
  c.autoPrune = c.autoPrune !== false
  return c
}

function isAuthCookie(cookie) {
  if (!cookie || typeof cookie.name !== 'string') return false
  if (!cookie.name.startsWith(COOKIE_PREFIX)) return false
  const host = (cookie.domain || cookie.host_key || '').replace(/^\./, '')
  return host === '127.0.0.1' || host === 'localhost' || host.startsWith('127.0.0.')
}

/**
 * Probe whether the Electron cookie store is reachable from THIS plugin realm.
 *
 * Verified finding (DSH 44.7.0 / @deepseek-ai 0.2.2-rc.1): the plugin host half
 * is evaluated inside a `node:vm` sandbox whose module linker maps `electron`
 * to the renderer bridge. That object has no `.session.defaultSession.cookies`,
 * so the main-process cookie store is unreachable here. We capture the proof
 * (the shape of the object we DID get) so the UI can show it — that's the most
 * useful thing this plugin can do, because it tells the user exactly why the
 * one-click clean can't run from Settings.
 *
 * Returns { available, cookies, error, probe }.
 */
async function probeCookieStore() {
  let electron
  try {
    electron = await import('electron')
  } catch (e) {
    return { available: false, cookies: [], error: 'electron not importable: ' + e.message, probe: null }
  }

  let probe = {}
  try {
    const e = electron.default ?? electron
    probe = {
      typeofElectron: typeof electron,
      keys: Array.isArray(Object.keys(e)) ? Object.keys(e).slice(0, 20) : '(no keys)',
      hasSession: !!(e && e.session),
      hasDefaultSession: !!(e && e.session && e.session.defaultSession),
      hasCookies: !!(e && e.session && e.session.defaultSession && e.session.defaultSession.cookies),
      hasDefaultSessionViaDefault: !!(e && e.default && e.default.session && e.default.session.defaultSession),
    }
  } catch (e) {
    probe = { probeError: e.message }
  }

  const reachable = !!(electron && electron.session && electron.session.defaultSession && electron.session.defaultSession.cookies)
  if (!reachable) {
    return {
      available: false,
      cookies: [],
      error: 'session.defaultSession.cookies missing — plugin vm sandbox cannot reach the Electron main-process cookie store',
      probe,
    }
  }

  // Defensive: if a future build exposes the store, actually read it.
  try {
    const all = await electron.session.defaultSession.cookies.get({})
    const auth = all.filter(isAuthCookie)
    auth.sort((a, b) => (b.expirationDate || b.creationDate || 0) - (a.expirationDate || a.creationDate || 0))
    return { available: true, cookies: auth, error: null, probe }
  } catch (e) {
    return { available: false, cookies: [], error: 'cookies.get failed: ' + e.message, probe }
  }
}

function offlineInstructions() {
  return [
    '⚠️ 运行时无法清理：本插件在 DSH 插件沙箱（node:vm）中运行，沙箱把 `electron` 映射到渲染进程桥接，没有 .session.defaultSession.cookies。这是 DSH 桌面端插件架构限制，不是本插件 bug，也不是你的操作问题。',
    '',
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
  ].join('\n')
}

export function apply(ctx, config) {
  const cfg = resolveConfig(config)

  // Live config: volatile fields are edited in place, so `apply` is never
  // re-run. Always read the latest values through the fiber.
  const live = () => {
    let raw = null
    try { raw = ctx.fiber?.effectiveConfig ?? null } catch { /* ignore */ }
    return resolveConfig({ ...cfg, ...(raw || {}) })
  }

  const settings = (() => {
    try { return ctx.get ? ctx.get('settings') : undefined } catch { return undefined }
  })()

  // dsh-settings persists every write into the profile YAML and then
  // reconciles the loader (which restarts this plugin). So:
  //   1. seed the cache from the values already stored in the YAML — otherwise
  //      each restart would republish and trigger another reconcile, looping;
  //   2. send only values that actually changed;
  //   3. allow a single write in flight.
  const published = Object.create(null)
  try {
    const raw = ctx.fiber?.effectiveConfig
    if (raw && typeof raw === 'object') {
      for (const key of VOLATILE_KEYS) {
        if (key in raw) published[key] = readValue(raw[key])
      }
    }
  } catch { /* ignore */ }

  let writing = null
  const push = async (patch) => {
    if (!settings || typeof settings.update !== 'function') return
    const delta = {}
    for (const [key, value] of Object.entries(patch)) {
      if (published[key] !== value) delta[key] = value
    }
    if (Object.keys(delta).length === 0) return
    if (writing) { try { await writing } catch { /* ignore */ } return push(patch) }
    writing = (async () => {
      try {
        await settings.update(NS, delta)
        Object.assign(published, delta)
      } catch (e) {
        console.warn('[dsh-cookie-pruner] settings update skipped:', e.message)
      } finally {
        writing = null
      }
    })()
    await writing
  }

  let busy = false

  // Publish the diagnostic. In this build `available` is always false and the
  // count is -1 (unknown); we surface the proof + the offline remedy.
  const publishCount = async () => {
    try {
      const { available, cookies, error, probe } = await probeCookieStore()
      let lastResult
      if (available) {
        lastResult = `运行时读取成功，当前 ${cookies.length} 条 dsh-auth-* cookie。`
      } else {
        const probeStr = probe ? ('\n\n探测到的 electron 对象：\n' + JSON.stringify(probe, null, 2)) : ''
        lastResult = '⚠️ 无法在运行时读取 cookie：' + error + probeStr +
          '\n\n' + offlineInstructions()
      }
      await push({ lastCount: available ? cookies.length : -1, available, lastResult })
    } catch (e) {
      console.warn('[dsh-cookie-pruner] count publish error:', e.message)
    }
  }

  // Preventive-only: if a future build ever exposes the store, prune old ones.
  // In the current build this is a no-op (available is always false).
  const runAutoPrune = async () => {
    const c = live()
    if (!c.autoPrune) return
    try {
      const { available, cookies, error } = await probeCookieStore()
      if (!available) {
        // Don't spam the diagnostic on every interval — publishCount handles it.
        return
      }
      await push({ lastCount: cookies.length, available: true })
    } catch (e) {
      console.warn('[dsh-cookie-pruner] auto-prune error:', e.message)
    }
  }

  // The "clean" action can't delete at runtime (sandbox limit). Instead it
  // prints the offline cleanup instructions into lastResult.
  const checkCleanRequest = async () => {
    if (busy) return
    let flag = false
    try { flag = readValue(ctx.fiber?.effectiveConfig?.cleanRequest) === true } catch { /* ignore */ }
    if (!flag) return
    busy = true
    try {
      await push({ cleanRequest: false })
      await push({ lastResult: offlineInstructions() })
    } catch (e) {
      await push({ lastResult: '生成离线清理指引失败：' + e.message })
    } finally {
      busy = false
    }
  }

  // Publish the diagnostic. First after a short delay, then keep it fresh.
  ctx.effect(() => {
    let cancelled = false
    const run = async () => { if (!cancelled) await publishCount() }
    const t = setTimeout(run, 1000)
    if (typeof t.unref === 'function') t.unref()
    const interval = setInterval(run, cfg.countPollMs)
    if (typeof interval.unref === 'function') interval.unref()
    return () => { cancelled = true; clearTimeout(t); clearInterval(interval) }
  })

  // Periodic refresh of the diagnostic (start after a delay so we don't race
  // welcome auth). Wrap in ctx.effect so cordis disposes the timer on plugin
  // shutdown — this is the only correct teardown pattern in this build
  // (no ctx.on('dispose')).
  ctx.effect(() => {
    let interval = null
    const startTimer = () => {
      if (interval) return
      interval = setInterval(runAutoPrune, cfg.checkIntervalMs)
      if (typeof interval.unref === 'function') interval.unref()
    }
    const delay = setTimeout(() => { runAutoPrune(); startTimer() }, cfg.startDelayMs)
    if (typeof delay.unref === 'function') delay.unref()
    return () => {
      clearTimeout(delay)
      if (interval) clearInterval(interval)
    }
  })

  // Poll for a Settings-issued clean request.
  ctx.effect(() => {
    const watch = setInterval(checkCleanRequest, cfg.cleanPollMs)
    if (typeof watch.unref === 'function') watch.unref()
    return () => clearInterval(watch)
  })
}
