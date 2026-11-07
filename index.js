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
 *      guaranteeing old cookies expire on their own.
 *   B) This Host half, while DSH is live, reads the Electron Chromium cookie
 *      store via `session.defaultSession.cookies` and prunes the oldest
 *      `dsh-auth-*` rows, keeping the newest `keepLatest` (default 10) when the
 *      count exceeds `pruneThreshold` (default 12). It also publishes the live
 *      count into the DSH Settings page (设置 → 插件) and reacts to a
 *      `cleanRequest` toggle there, keeping the newest `manualKeepLatest`
 *      (default 5).
 *   C) For the worst case where the runtime store is unreachable, ship the
 *      offline `cleanup-once.ps1` (run with DSH fully closed) that renames the
 *      Chromium Cookies DB so DSH rebuilds a clean one.
 *
 * SAFETY: every cookie operation is fenced to name prefix `dsh-auth-` and host
 * `127.0.0.1` (or any loopback). We never touch other cookies. The CURRENT
 * session's cookie is the newest and is always kept. All work is wrapped so a
 * failure can NEVER break DSH startup (the desktop blocks the whole UI on a
 * plugin load error).
 *
 * DEFAULT: `dryRun: true` — only counts, never deletes. Flip it from the
 * Settings form (or in the profile patch) after you confirm the number.
 */

import { createRequire } from 'node:module'

export const name = 'dsh-cookie-pruner'

const COOKIE_PREFIX = 'dsh-auth-'

/** Profile entry id — must match the `insert:` row in cordis.patch.yml. */
const NS = 'dsh-cookie-pruner-host'

// Config schema (read via the plugin's Config export / cordis; defaults here).
const DEFAULT_CONFIG = {
  cookieMaxAgeDays: 7,   // mirrors Layer A; mainly informational
  autoPrune: true,
  pruneThreshold: 12,    // auto-prune only when count > this
  keepLatest: 10,        // auto-prune keeps the newest N
  manualKeepLatest: 5,   // one-click clean keeps the newest N
  dryRun: true,          // safety: true = count only, no deletes
  checkIntervalMs: 300000, // 5 minutes
  startDelayMs: 30000,     // 30s after load
  cleanPollMs: 3000,       // how often we look for a Settings clean request
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
      lastCount: z.number().description('当前 dsh-auth-* cookie 总条数').default(0).volatile(),
      available: z.boolean().description('运行时 cookie 存储是否可读').default(false).volatile(),
      dryRun: z.boolean().description('干跑：只统计，不删除').default(true).volatile(),
      cleanRequest: z.boolean().description('置为 true 触发一次清理（保留最近 5 条）').default(false).volatile(),
      lastResult: z.string().description('上一次清理结果').default('').volatile(),
    })
  : undefined

/** Volatile field names — the only config keys dsh-settings accepts at runtime. */
const VOLATILE_KEYS = ['lastCount', 'available', 'dryRun', 'cleanRequest', 'lastResult']

// A `.volatile()` field parses into a cosmokit volatile cell — a plain OBJECT
// carrying a `.get()` reader (marked with Symbol.for("cosmokit.volatile.write")).
// Cordis hands us that parsed value, so every read must unwrap it: otherwise
// `dryRun: true` inside the cell would look like a truthy object and `cleanRequest
// === true` would never match.
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
  for (const key of ['pruneThreshold', 'keepLatest', 'manualKeepLatest', 'checkIntervalMs', 'startDelayMs', 'cleanPollMs']) {
    const n = Number(c[key])
    c[key] = Number.isFinite(n) && n > 0 ? n : DEFAULT_CONFIG[key]
  }
  c.autoPrune = c.autoPrune !== false
  c.dryRun = c.dryRun !== false
  return c
}

function isAuthCookie(cookie) {
  if (!cookie || typeof cookie.name !== 'string') return false
  if (!cookie.name.startsWith(COOKIE_PREFIX)) return false
  const host = (cookie.domain || cookie.host_key || '').replace(/^\./, '')
  return host === '127.0.0.1' || host === 'localhost' || host.startsWith('127.0.0.')
}

// Returns { available, cookies, error }. `available=false` means we could not
// reach the Electron cookie store (e.g. non-desktop build) — degrade gracefully.
async function readAuthCookies() {
  let session
  try {
    const electron = await import('electron')
    session = electron.session || (electron.default && electron.default.session)
  } catch (e) {
    return { available: false, cookies: [], error: 'electron not importable: ' + e.message }
  }
  if (!session || !session.defaultSession || !session.defaultSession.cookies) {
    return { available: false, cookies: [], error: 'session.defaultSession.cookies missing' }
  }
  try {
    const all = await session.defaultSession.cookies.get({})
    const auth = all.filter(isAuthCookie)
    // Newest first. Electron cookies reliably carry `expirationDate`; under the
    // fixed cookieMaxAgeDays the one set most recently has the largest value,
    // so the CURRENT session cookie (set this launch) always sorts first and is
    // kept. Fall back to creationDate, then 0, so a missing field can never make
    // the order unstable enough to drop the live cookie.
    const ts = (c) => (c.expirationDate || c.creationDate || 0)
    auth.sort((a, b) => ts(b) - ts(a))
    return { available: true, cookies: auth, error: null }
  } catch (e) {
    return { available: false, cookies: [], error: 'cookies.get failed: ' + e.message }
  }
}

// Remove all but the newest `keep` cookies among the auth set.
// Returns { removed, kept, available, error }.
async function pruneAuthCookies(keep) {
  const { available, cookies, error } = await readAuthCookies()
  if (!available) return { removed: 0, kept: cookies.length, available: false, error }
  if (cookies.length <= keep) {
    return { removed: 0, kept: cookies.length, available: true }
  }
  const electron = await import('electron')
  const session = electron.session || (electron.default && electron.default.session)
  const toRemove = cookies.slice(keep)
  let removed = 0
  let lastError = null
  for (const cookie of toRemove) {
    const url = (cookie.secure ? 'https://' : 'http://') +
      (cookie.domain || cookie.host_key || '127.0.0.1') + (cookie.path || '/')
    try {
      await session.defaultSession.cookies.remove(url, cookie.name)
      removed++
    } catch (e) {
      lastError = e.message
    }
  }
  return { removed, kept: cookies.length - removed, available: true, error: lastError }
}

export function apply(ctx, config) {
  const cfg = resolveConfig(config)

  // Live config: volatile fields are edited in place, so `apply` is never
  // re-run. Always read the latest values through the fiber. `effectiveConfig`
  // is the host-side view dsh-settings reads too — resolveConfig unwraps the
  // volatile cells for us.
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

  const publishCount = async () => {
    try {
      const { available, cookies } = await readAuthCookies()
      await push({ lastCount: cookies.length, available })
    } catch (e) {
      console.warn('[dsh-cookie-pruner] count publish error:', e.message)
    }
  }

  const runAutoPrune = async () => {
    const c = live()
    if (!c.autoPrune) return
    try {
      const { available, cookies } = await readAuthCookies()
      if (!available) return
      await push({ lastCount: cookies.length, available: true })
      if (c.dryRun) return // safety: do not delete while dry-run
      if (cookies.length <= c.pruneThreshold) return
      const state = await pruneAuthCookies(c.keepLatest)
      if (state.removed > 0) {
        console.log(`[dsh-cookie-pruner] auto-pruned ${state.removed} old dsh-auth-* cookies (kept ${state.kept})`)
        await push({ lastCount: state.kept, lastResult: `自动清理：删除 ${state.removed} 条，保留 ${state.kept} 条` })
      }
    } catch (e) {
      console.warn('[dsh-cookie-pruner] auto-prune error:', e.message)
    }
  }

  // Watch the Settings `cleanRequest` toggle. Reset it first so a slow prune
  // can never re-trigger itself.
  const checkCleanRequest = async () => {
    if (busy) return
    let flag = false
    try { flag = readValue(ctx.fiber?.effectiveConfig?.cleanRequest) === true } catch { /* ignore */ }
    if (!flag) return
    busy = true
    try {
      await push({ cleanRequest: false })
      const c = live()
      const { available, cookies, error } = await readAuthCookies()
      if (!available) {
        await push({ available: false, lastResult: '运行时存储不可用：' + (error || 'unknown') })
        return
      }
      if (c.dryRun) {
        await push({ lastCount: cookies.length, available: true, lastResult: `干跑开启，未删除（当前 ${cookies.length} 条）` })
        return
      }
      if (cookies.length <= c.manualKeepLatest) {
        await push({ lastCount: cookies.length, lastResult: `只有 ${cookies.length} 条，无需清理` })
        return
      }
      const state = await pruneAuthCookies(c.manualKeepLatest)
      await push({
        lastCount: state.kept,
        available: true,
        lastResult: `已删除 ${state.removed} 条，保留 ${state.kept} 条`,
      })
    } catch (e) {
      await push({ lastResult: '清理失败：' + e.message })
    } finally {
      busy = false
    }
  }

  // Publish the current count right away so the Settings page is never blank.
  ctx.effect(() => {
    let cancelled = false
    const run = async () => { if (!cancelled) await publishCount() }
    const t = setTimeout(run, 1000)
    if (typeof t.unref === 'function') t.unref()
    return () => { cancelled = true; clearTimeout(t) }
  })

  // Schedule periodic check (start after a delay so we don't race welcome auth).
  // Wrap in ctx.effect so cordis disposes the timer on plugin shutdown — this is
  // the only correct teardown pattern in this build (no ctx.on('dispose')).
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
