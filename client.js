/**
 * dsh-cookie-pruner — browser (client) half, v0.1.6
 *
 * Contributes a real "Cookie 清理" section to the DSH Settings dialog — the
 * panel opened from the bottom-left account avatar → 设置. This is the place
 * the user asked for (not the left Plugins sidebar, not a web dashboard).
 *
 * HONEST NOTE (v0.1.6): a third-party plugin host half runs inside a
 * node:vm sandbox whose module linker maps `electron` to the renderer bridge,
 * so `session.defaultSession.cookies` is unreachable and there is no
 * `ctx.cookies`/`ctx.session` service. The Chromium Cookies DB is also locked
 * while DSH runs. Therefore the plugin CANNOT read or delete cookies at
 * runtime. This panel therefore (1) shows that fact, (2) shows the proof the
 * host probed, and (3) gives the one-click path to the OFFLINE cleanup script
 * that actually fixes the 431.
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
 *    `form.set("cleanRequest", true)`, which the host turns into the offline
 *    instructions.
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
      const count = typeof v.lastCount === 'number' ? v.lastCount : -1
      const available = v.available === true
      const cleanRequest = v.cleanRequest === true
      const lastResult = typeof v.lastResult === 'string' ? v.lastResult : ''
      const writable = !!(snap && snap.writable)

      const showInstructions = () => {
        if (pending) return
        setPending(true)
        // The host's `checkCleanRequest` polls cleanRequest and prints the
        // offline cleanup instructions into lastResult.
        Promise.resolve(form.set('cleanRequest', true)).catch(() => {})
      }

      let statusLine
      if (status === 'loading') statusLine = '正在读取插件状态…'
      else if (status === 'unavailable' || status === undefined) statusLine = '插件尚未就绪（请完全退出并重进 DSH 一次）'
      else if (!available) statusLine = '运行时 Cookie 存储不可访问（DSH 插件沙箱限制，见下方说明）'
      else statusLine = ''

      const disabled = pending || cleanRequest || !writable || status === 'unavailable'

      const countText = count === -1 ? '读不到（-1）' : String(count)

      return h('div', {
        style: { color: T.primary, fontSize: 14, maxWidth: 760, lineHeight: 1.6, padding: '4px 2px' },
      },
        h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 4 } }, 'DSH 认证 Cookie 清理'),
        h('div', { style: { color: T.tertiary, fontSize: 12, marginBottom: 20 } },
          '缓解 dsh-auth-* cookie 累积导致的 HTTP 431 / Web authentication failed 启动崩溃。'),

        h('div', { style: { background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '8px 16px', marginBottom: 18 } },
          h('div', { style: row },
            h('span', { style: label }, '当前认证 Cookie 条数'),
            h('span', { style: value }, countText)),
          h('div', { style: { ...row, borderBottom: 'none' } },
            h('span', { style: label }, '运行时存储'),
            available ? Badge('可用', T.success) : Badge('不可用', T.error))),

        h('div', { style: { color: T.warning, fontSize: 12, marginBottom: 14, lineHeight: 1.5 } },
          '说明：本插件运行在 DSH 插件沙箱内，无法直接读取或删除 cookie（这是 DSH 桌面端插件架构限制，不是插件 bug）。条数显示「读不到」属正常。要真正清理堆积、解除 431，请使用下面的离线脚本。'),

        h('button', {
          type: 'button',
          onClick: showInstructions,
          disabled,
          style: {
            appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
            padding: '9px 18px', fontSize: 13, fontWeight: 600,
            color: '#fff', background: disabled ? T.border : T.brand,
            border: 'none', borderRadius: T.radius,
            opacity: disabled ? 0.65 : 1,
          },
        }, pending || cleanRequest ? '生成中…' : '如何彻底清理（离线）'),

        h('div', { style: { color: T.secondary, fontSize: 12, marginTop: 10 } },
          '点击后会显示离线清理脚本的路径与步骤（需完全退出 DSH 后运行）。'),

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
          'dsh-cookie-pruner v0.1.6 · Layer A（cookieMaxAgeDays:7）已在生效，防止未来 cookie 堆积。'),
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
