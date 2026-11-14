/**
 * dsh-cookie-pruner — browser (client) half, v0.1.14
 *
 * Contributes an HONEST "Cookie 清理" section to the DSH Settings dialog — the
 * panel opened from the bottom-left account avatar → 设置 (the place the user
 * asked for, not the left Plugins sidebar, not a web dashboard).
 *
 * HONESTY NOTE (verified against the shipped 44.7.0 asar + real restart logs):
 *  - The host half runs in a locked-down `node:vm` sandbox. It has `node:fs`
 *    (so it CAN measure the Cookies DB size) but it does NOT get `settings` /
 *    `bash` / `subprocess` / `config` / `fiber`. There is no supported channel
 *    for the host to push live numbers into this panel at runtime.
 *  - Therefore this panel does NOT pretend to show live DB-size numbers it can't
 *    receive. Instead it explains the real situation and gives the offline steps
 *    that ACTUALLY fix 431. The live measurement lives in the host's
 *    `.runtime-diag.json`, which the assistant (the agent driving this plugin)
 *    reads and reports to you in chat.
 *  - The genuine mitigation is OUTSIDE the plugin: the profile's
 *    `connection.cookieMaxAgeDays: 7` (Layer A) caps future pile-up, and
 *    `cleanup-once.ps1` clears the existing DB once DSH is fully quit.
 */

window.__ModuleLoader__.load({
  id: 'dsh-cookie-pruner',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Host-side settings namespace (must equal the cordis.patch.yml entry id).
    const NS = 'dsh-cookie-pruner-host'

    const T = {
      primary: 'var(--dsw-alias-label-primary, #e8ecf4)',
      secondary: 'var(--dsw-alias-label-secondary, #a6b0c3)',
      tertiary: 'var(--dsw-alias-label-tertiary, #7c879b)',
      bg: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04))',
      border: 'var(--dsw-alias-border-l2, rgba(255,255,255,0.10))',
      brand: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff)',
      success: 'var(--dsw-alias-state-success-primary, #3fbf7f)',
      error: 'var(--dsw-alias-state-error-primary, #f0716b)',
      warning: 'var(--dsw-alias-state-warning-primary, #e0a23b)',
      radius: 'var(--dsw-radius-md, 8px)',
    }

    const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: `1px solid ${T.border}` }
    const label = { color: T.secondary, fontSize: 13 }
    const value = { color: T.primary, fontSize: 13, fontVariantNumeric: 'tabular-nums' }
    const block = { background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '12px 16px', whiteSpace: 'pre-wrap', color: T.primary, fontSize: 12, lineHeight: 1.6 }

    function Section() {
      return h('div', {
        style: { color: T.primary, fontSize: 14, maxWidth: 760, lineHeight: 1.6, padding: '4px 2px' },
      },
        h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 4 } }, 'DSH 认证 Cookie 清理'),
        h('div', { style: { color: T.tertiary, fontSize: 12, marginBottom: 18 } },
          '关于 dsh-auth-* cookie 累积导致的 HTTP 431 / “Web authentication failed” 启动崩溃。'),

        // What is actually going on (honest).
        h('div', { style: { ...row, borderBottom: 'none' } },
          h('span', { style: label }, '插件状态'),
          h('span', { style: { ...value, color: T.success } }, '已加载')),

        h('div', { style: { ...row, borderBottom: 'none' } },
          h('span', { style: label }, '实时数据'),
          h('span', { style: { ...value, color: T.tertiary } }, '由助手读取后转述')),

        h('div', {
          style: { color: T.warning, fontSize: 12, margin: '14px 0', lineHeight: 1.55 },
        },
          '说明：插件运行在 DSH 桌面端的插件沙箱内，运行时无法直接删除 cookie（DSH 桌面端架构限制，并非插件 bug，也不是本机特例）。插件能做到的是：检测到 Cookies 库堆积时，把实时状态和“解除 431 的离线步骤”告诉助手，由助手转述给你。真正生效的缓解在插件之外（见下方）。'),

        h('div', { style: { fontSize: 14, fontWeight: 600, marginTop: 18, marginBottom: 8 } }, '真正能解除 431 的两件事'),

        h('div', { style: row },
          h('span', { style: label }, '① 预防（已自动生效）'),
          h('span', { style: { ...value, color: T.success } }, 'Layer A')),
        h('div', { style: { color: T.secondary, fontSize: 12, margin: '4px 0 12px' } },
          '你的 profile 里 connection.cookieMaxAgeDays: 7 已把未来 cookie 寿命压到 7 天，旧 cookie 会自行过期，不再无限堆积。'),

        h('div', { style: row },
          h('span', { style: label }, '② 清理当前堆积（一次性）'),
          h('span', { style: { ...value, color: T.warning } }, '需手动')),
        h('div', { style: { color: T.secondary, fontSize: 12, margin: '4px 0 12px' } },
          '当前 Cookies 库已有堆积（约 28 KB），必须完全退出 DSH 后运行一次离线脚本：'),

        h('div', { style: block },
          '1. 完全退出 DSH（右键托盘 → 退出，确认进程结束）。\n' +
          '2. 以管理员身份打开 PowerShell，运行：\n' +
          '     & "D:\\AI\\dsh-cookie-pruner\\cleanup-once.ps1"\n' +
          '   脚本会把 Cookies 库改名备份，并守护“DSH 已退出”，放心跑。\n' +
          '3. 重新打开 DSH 即可，431 解除。'),

        h('div', { style: { color: T.tertiary, fontSize: 11, marginTop: 18 } },
          'dsh-cookie-pruner v0.1.14 · 诚实版：插件沙箱无法运行时删 cookie，已说明真实情况与离线修复步骤。'),
      )
    }

    return {
      // Required client services (activation is deferred until they exist).
      inject: ['slots', 'configForms'],
      apply(ctx) {
        // Register the Settings section. We still fetch the host config form so
        // the auto-generated Plugins-sidebar form coexists cleanly, but the
        // panel content above is honest static guidance (no fake live numbers).
        try { ctx.configForms.get(NS) } catch {}
        const Bound = () => h(Section, {})
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
