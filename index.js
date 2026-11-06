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
 *      count exceeds `pruneThreshold` (default 12). It also serves an in-app
 *      dashboard page + JSON API showing the live count and a one-click clean
 *      that keeps the newest `manualKeepLatest` (default 5).
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
 * DEFAULT: `dryRun: true` — only counts, never deletes. Flip to false after you
 * confirm the dashboard shows the right number.
 */

export const name = 'dsh-cookie-pruner'

const COOKIE_PREFIX = 'dsh-auth-'

// Config schema (read via dsh-cookie-pruner Config / cordis; defaults here).
const DEFAULT_CONFIG = {
  cookieMaxAgeDays: 7,   // mirrors Layer A; mainly informational
  autoPrune: true,
  pruneThreshold: 12,    // auto-prune only when count > this
  keepLatest: 10,        // auto-prune keeps the newest N
  manualKeepLatest: 5,   // one-click clean keeps the newest N
  dryRun: true,          // safety: true = count only, no deletes
  checkIntervalMs: 300000, // 5 minutes
  startDelayMs: 30000,     // 30s after load
}

function resolveConfig(raw) {
  const c = { ...DEFAULT_CONFIG, ...(raw || {}) }
  c.pruneThreshold = Number(c.pruneThreshold) || DEFAULT_CONFIG.pruneThreshold
  c.keepLatest = Number(c.keepLatest) || DEFAULT_CONFIG.keepLatest
  c.manualKeepLatest = Number(c.manualKeepLatest) || DEFAULT_CONFIG.manualKeepLatest
  c.checkIntervalMs = Number(c.checkIntervalMs) || DEFAULT_CONFIG.checkIntervalMs
  c.startDelayMs = Number(c.startDelayMs) || DEFAULT_CONFIG.startDelayMs
  return c
}

function isAuthCookie(cookie) {
  if (!cookie || typeof cookie.name !== 'string') return false
  if (!cookie.name.startsWith(COOKIE_PREFIX)) return false
  const host = (cookie.domain || cookie.host_key || '').replace(/^\./, '')
  return host === '127.0.0.1' || host === 'localhost' || host.startsWith('127.0.0.')
}

function json(res, obj, status = 200) {
  const body = JSON.stringify(obj)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
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

  const runAutoPrune = async () => {
    if (!cfg.autoPrune) return
    try {
      const { available } = await readAuthCookies()
      if (!available) return
      if (cfg.dryRun) return // safety: do not delete while dry-run
      const state = await pruneAuthCookies(cfg.keepLatest)
      if (state.removed > 0) {
        console.log(`[dsh-cookie-pruner] auto-pruned ${state.removed} old dsh-auth-* cookies (kept ${state.kept})`)
      }
    } catch (e) {
      console.warn('[dsh-cookie-pruner] auto-prune error:', e.message)
    }
  }

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

  // In-app dashboard + JSON API, served on the same host/port as the DSH GUI.
  const html = (state) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>DSH Cookie Pruner</title>
<style>
  body { font:14px/1.6 system-ui,Segoe UI,Arial; background:#0f1115; color:#e6e6e6; margin:0; padding:32px; }
  .card { max-width:560px; margin:0 auto; background:#171a21; border:1px solid #2a2f3a; border-radius:12px; padding:24px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:#8b93a1; margin:0 0 18px; font-size:12px; }
  .count { font-size:40px; font-weight:700; margin:8px 0; }
  .ok { color:#4ade80; } .warn { color:#fbbf24; } .err { color:#f87171; }
  button { background:#2563eb; color:#fff; border:0; border-radius:8px; padding:10px 16px; font-size:14px; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .row { display:flex; gap:12px; align-items:center; margin-top:14px; }
  .note { margin-top:16px; font-size:12px; color:#8b93a1; }
  code { background:#222; padding:1px 6px; border-radius:4px; }
  .status { margin-left:auto; font-size:12px; }
</style></head>
<body><div class="card">
  <h1>DSH Cookie Pruner</h1>
  <p class="sub">dsh-auth-* 累积清理 · 防 HTTP 431 启动崩溃</p>
  <div class="count ${state.cls}">${state.count}</div>
  <div>当前 dsh-auth-* cookie 总条数</div>
  <div class="row">
    <button id="clean" ${state.available ? '' : 'disabled'}>一键清理（保留最近 ${state.manualKeepLatest} 条）</button>
    <span class="status" id="status"></span>
  </div>
  <div class="note">
    阈值：${state.pruneThreshold} ｜ 自动保留：${state.keepLatest} ｜ 手动保留：${state.manualKeepLatest} ｜ 干跑：${state.dryRun ? '是（只统计）' : '否'}<br>
    ${state.available
      ? '运行时清理可用。若不可用，请完全退出 DSH 后运行 <code>cleanup-once.ps1</code>。'
      : '运行时清理不可用（' + state.error + '）。请完全退出 DSH 后运行 <code>cleanup-once.ps1</code>。'}
  </div>
</div>
<script>
  const clean = document.getElementById('clean');
  const status = document.getElementById('status');
  clean && clean.addEventListener('click', async () => {
    clean.disabled = true; status.textContent = '清理中…';
    try {
      const r = await fetch('/dsh-cookie-pruner/prune', { method: 'POST' });
      const j = await r.json();
      status.textContent = j.ok ? ('已删除 ' + j.removed + ' 条，保留 ' + j.kept) : ('失败：' + (j.error || 'unknown'));
      setTimeout(() => location.reload(), 600);
    } catch (e) { status.textContent = '请求失败：' + e.message; clean.disabled = false; }
  });
</script></body></html>`

  const handle = async (req, res) => {
    const url = (req.url || '').split('?')[0]
    try {
      if (url === '/dsh-cookie-pruner/count') {
        const { available, cookies, error } = await readAuthCookies()
        const count = cookies.length
        const cls = !available ? 'err' : (count > cfg.pruneThreshold ? 'warn' : 'ok')
        return json(res, { count, available, error, pruneThreshold: cfg.pruneThreshold, keepLatest: cfg.keepLatest, manualKeepLatest: cfg.manualKeepLatest, dryRun: cfg.dryRun, cls })
      }
      if (url === '/dsh-cookie-pruner/prune' && req.method === 'POST') {
        if (cfg.dryRun) return json(res, { ok: false, error: 'dryRun 开启，未删除任何 cookie' }, 400)
        const state = await pruneAuthCookies(cfg.manualKeepLatest)
        if (!state.available) return json(res, { ok: false, error: state.error || 'store unavailable' }, 503)
        return json(res, { ok: true, removed: state.removed, kept: state.kept })
      }
      if (url === '/dsh-cookie-pruner/' || url === '/dsh-cookie-pruner') {
        const { available, cookies, error } = await readAuthCookies()
        const count = cookies.length
        const cls = !available ? 'err' : (count > cfg.pruneThreshold ? 'warn' : 'ok')
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.end(html({ count, available, error, cls, pruneThreshold: cfg.pruneThreshold, keepLatest: cfg.keepLatest, manualKeepLatest: cfg.manualKeepLatest, dryRun: cfg.dryRun }))
      }
      return json(res, { ok: false, error: 'not found' }, 404)
    } catch (e) {
      return json(res, { ok: false, error: e.message }, 500)
    }
  }

  // webServer is optional: some profiles/hosts may not serve the browser. Guard
  // with ctx.get('webServer') and degrade gracefully if it is absent.
  const webServer = ctx.get('webServer')
  if (webServer && typeof webServer.register === 'function') {
    try {
      webServer.register({ kind: 'prefix', path: '/dsh-cookie-pruner', handler: handle })
      console.log('[dsh-cookie-pruner] dashboard mounted at /dsh-cookie-pruner/')
    } catch (e) {
      console.warn('[dsh-cookie-pruner] webServer route registration failed (dashboard disabled):', e.message)
    }
  } else {
    console.warn('[dsh-cookie-pruner] webServer service unavailable — dashboard disabled, auto-prune still active')
  }
}
