/**
 * dsh-cookie-pruner — browser (client) half, v0.1.7
 *
 * Contributes a real "Cookie 清理" section to the DSH Settings dialog — the
 * panel opened from the bottom-left account avatar → 设置. This is the place
 * the user asked for (not the left Plugins sidebar, not a web dashboard).
 *
 * v0.1.7 role: show the LIVE prevention state (Cookies DB size, risk level,
 * auto-clean on/off, last clean) and let the user flip the auto-clean switch or
 * request the offline steps. The actual deferred cleanup is done by a Windows
 * Task Scheduler job that the Host half registers — it runs cleanup-once.ps1
 * after DSH fully exits, so the 431 is prevented automatically.
 *
 * Mechanism (verified against the shipped 44.7.0 asar):
 *  - `dsh-client-ui-settings-general` owns the Settings dialog and builds its
 *    nav from the `settings.section` LIST slot; the active section's component
 *    is rendered by `renderSlot("settings.section", {close}, {only: active})`.
 *  - A plugin contributes a nav row + panel by registering a `settings.section`
 *    entry from a CLIENT half. The host (node) half cannot register slots.
 *  - The live values live in the Host's `dsh-settings` service under namespace
 *    `dsh-cookie-pruner-host` (= the cordis.patch.yml entry id). The client reads
 *    them through `ctx.configForms.get(ns)` and writes back through
 *    `form.set("autoCleanEnabled", bool)` / `form.set("cleanRequest", true)`.
 *
 * This file is served VERBATIM as a browser module: the loader calls
 * `factory(require)` and `require('react')` comes from the browser module table.
 * Do NOT import Harness client packages as modules.
 */
window.__ModuleLoader__.load({
  id: 'dsh-cookie-pruner',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Host-side settings namespace (must equal the cordis.patch.yml entry id).
    const NS = 'dsh-cookie-pruner-host'

    // Theme tokens are provided by the host; every lookup has a fallback so the
    // panel still looks sane if a token is absent in a future build.
    const c = (token, fallback) => `var(${token}, ${fallback})`
    const T = {
      primary: c('--dsw-alias-label-primary', '#e8ecf4'),
      secondary: c('--dsw-alias-label-secondary', '#a6b0c3'),
      tertiary: c('--dsw-alias-label-tertiary', '#7c879b'),
      bg: c('--dsw-alias-bg-layer-2', 'rgba(255,255,255,0.04)'),
      border: c('--dsw-alias-border-l2', 'rgba(255,255,255,0.10)'),
      brand: c('--dsw-alias-brand-primary-new-colorprimary-new-color', '#4c8dff'),
      success: c('--dsw-alias-state-success-primary', '#3fbf7f'),
      error: c('--dsw-alias-state-error-primary', '#f0716b'),
      warning: c('--dsw-alias-state-warning-primary', '#e0a23b'),
      radius: c('--dsw-radius-md', '8px'),
    }

    const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: `1px solid ${T.border}` }
    const label = { color: T.secondary, fontSize: 13 }
    const value = { color: T.primary, fontSize: 13, fontVariantNumeric: 'tabular-nums' }

    function Badge(text, color) {
      return h('span', {
        style: {
          display: 'inline-block', padding: '2px 8px', borderRadius: 999,
          fontSize: 12, lineHeight: '18px', color,
          background: T.bg, border: `1px solid ${T.border}`,
        },
      }, text)
    }

    function formatKB(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
      if (bytes < 1024) return bytes + ' B'
      return (bytes / 1024).toFixed(1) + ' KB'
    }

    function Section(props) {
      const form = props.form
      const [snap, setSnap] = React.useState(() => form.getSnapshot())
      React.useEffect(() => {
        setSnap(form.getSnapshot())
        return form.subscribe(() => setSnap(form.getSnapshot()))
      }, [form])

      const [pending, setPending] = React.useState(false)
      React.useEffect(() => {
        if (!pending) return
        const t = setTimeout(() => setPending(false), 12000)
        return () => clearTimeout(t)
      }, [pending])

      const v = (snap && snap.value) || {}
      const status = snap && snap.status
      const dbSize = typeof v.lastDbSize === 'number' ? v.lastDbSize : 0
      const launches = typeof v.launchesSincePrune === 'number' ? v.launchesSincePrune : 0
      const autoClean = v.autoCleanEnabled !== false
      const lastResult = typeof v.lastResult === 'string' ? v.lastResult : ''
      const writable = !!(snap && snap.writable)

      const showInstructions = () => {
        if (pending) return
        setPending(true)
        // The host's poll turns cleanRequest into the offline steps + turns on
        // auto-clean.
        Promise.resolve(form.set('cleanRequest', true)).catch(() => {})
      }

      const toggleAuto = (checked) => {
        if (!writable) return
        Promise.resolve(form.set('autoCleanEnabled', checked)).catch(() => {})
      }

      let statusLine
      if (status === 'loading') statusLine = '正在读取插件状态…'
      else if (status === 'unavailable' || status === undefined) statusLine = '插件尚未就绪（请完全退出并重进 DSH 一次）'
      else statusLine = ''

      // Risk heuristic must match the host (8 KiB or 50 launches).
      const risk = dbSize >= 8192 || launches >= 50
      const riskBadge = risk ? Badge('有溢出风险', T.error) : Badge('安全', T.success)
      const autoBadge = autoClean ? Badge('自动清理 开', T.success) : Badge('自动清理 关', T.warning)

      return h('div', {
        style: { color: T.primary, fontSize: 14, maxWidth: 760, lineHeight: 1.6, padding: '4px 2px' },
      },
        h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 4 } }, 'DSH 认证 Cookie 清理'),
        h('div', { style: { color: T.tertiary, fontSize: 12, marginBottom: 20 } },
          '缓解 dsh-auth-* cookie 累积导致的 HTTP 431 / Web authentication failed 启动崩溃。'),

        h('div', { style: { background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '8px 16px', marginBottom: 18 } },
          h('div', { style: row },
            h('span', { style: label }, 'Cookies 库大小'),
            h('span', { style: value }, formatKB(dbSize))),
          h('div', { style: { ...row, borderBottom: 'none' } },
            h('span', { style: label }, '自上次清理启动次数'),
            h('span', { style: value }, String(launches)))),

        h('div', { style: { ...row, borderBottom: 'none' } },
          h('span', { style: label }, '溢出风险'),
          riskBadge),

        h('div', { style: { ...row, borderBottom: 'none' } },
          h('span', { style: label }, '自动清理'),
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, cursor: writable ? 'pointer' : 'not-allowed' } },
            h('input', {
              type: 'checkbox',
              checked: autoClean,
              disabled: !writable,
              onChange: (e) => toggleAuto(e.target.checked),
              style: { accentColor: T.brand, width: 16, height: 16 },
            }),
            h('span', { style: { color: T.secondary, fontSize: 13 } }, autoClean ? '已开启' : '已关闭'))),

        h('div', { style: { color: T.warning, fontSize: 12, marginBottom: 14, lineHeight: 1.5 } },
          '说明：插件在 DSH 插件沙箱内运行，运行时无法直接删除 cookie（DSH 桌面端架构限制，非插件 bug）。但插件能读到 Cookies 库大小，检测到堆积时会自动登记后台任务——你完全退出 DSH 后，它会自动清理以解除 431。Layer A（cookieMaxAgeDays:7）已在生效，未来 cookie 会自行过期。'),

        h('button', {
          type: 'button',
          onClick: showInstructions,
          disabled: pending || !writable || status === 'unavailable',
          style: {
            appearance: 'none', cursor: (pending || !writable) ? 'not-allowed' : 'pointer',
            padding: '9px 18px', fontSize: 13, fontWeight: 600,
            color: '#fff', background: (pending || !writable) ? T.border : T.brand,
            border: 'none', borderRadius: T.radius,
            opacity: (pending || !writable) ? 0.65 : 1,
          },
        }, pending ? '生成中…' : '显示离线清理步骤'),

        h('div', { style: { color: T.secondary, fontSize: 12, marginTop: 10 } },
          '如 431 已导致 DSH 打不开，点上面按钮看离线脚本路径与步骤（需完全退出 DSH 后运行，一次即可解除）。'),

        (lastResult || statusLine)
          ? h('div', {
              style: {
                marginTop: 16, padding: '10px 12px', borderRadius: T.radius,
                background: T.bg, border: `1px solid ${T.border}`,
                color: T.primary, fontSize: 12, whiteSpace: 'pre-wrap',
                maxHeight: 320, overflow: 'auto',
              },
            }, lastResult || statusLine)
          : null,

        h('div', { style: { color: T.tertiary, fontSize: 11, marginTop: 20 } },
          'dsh-cookie-pruner v0.1.7 · 自动检测 + 退出后自动清理 · Layer A（cookieMaxAgeDays:7）防止未来堆积。'),
      )
    }

    return {
      // Required client services (activation is deferred until they exist).
      inject: ['slots', 'configForms'],
      apply(ctx) {
        // Create the controller in `apply` (not in the factory) — the factory
        // must stay side-effect free. `get()` triggers the describe mirror load;
        // Section re-renders through subscribe() once it becomes ready.
        const form = ctx.configForms.get(NS)
        const Bound = () => h(Section, { form })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-cookie-pruner',
          order: 5,
          label: () => 'Cookie 清理',
        }, Bound))
      },
    }
  },
})
