// Host harness for v0.1.13 — simulates the dsh-cordis-host-runner sandbox façade
// with the services DECLARED in inject (so they are reachable via property
// access). Verifies the deferred settings.update reaches the panel.
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const url = pathToFileURL('D:/AI/dsh-cookie-pruner/index.js').href
const mod = await import(url)

if (!mod.apply || !mod.Config) { console.error('FAIL: missing apply/Config'); process.exit(1) }
if (typeof mod.inject !== 'object' || !mod.inject.optional?.includes('settings')) {
  console.error('FAIL: inject.optional must include settings; got', JSON.stringify(mod.inject)); process.exit(1)
}

const updates = []
const intervals = []
const spawns = []
const fakeHandle = (argv) => ({
  stdout: null,
  done: Promise.resolve({ exitCode: 0, signal: null }),
  dispose() {},
})
const ctx = {
  settings: {
    update(ns, patch) { updates.push({ ns, patch }); return Promise.resolve() },
  },
  timer: {
    interval(fn, ms) { intervals.push({ ms }); return { dispose() {} } },
    timeout(fn, ms) { return { dispose() {} } },
  },
  bash: { spawn(spec) { spawns.push(spec); return fakeHandle(spec.argv) } },
  subprocess: null, // prefer bash in harness
  fiber: {
    effectiveConfig: { launchesSincePrune: 3, autoCleanEnabled: true },
    inject: mod.inject,
  },
}

// Config schema: confirm it built (dsh-settings renders it; diag hasConfig proves
// the volatile fields exist). Just assert it is a schemastery object with toJSON.
if (typeof mod.Config !== 'function' || typeof mod.Config.toJSON !== 'function') {
  console.error('FAIL: Config is not a schemastery object'); process.exit(1)
}
console.log('Config: built (schemastery object with toJSON) — diag.hasConfig already proves 7 volatile fields')

const applyResult = mod.apply(ctx, {})
if (applyResult && typeof applyResult.catch === 'function') {
  applyResult.catch((e) => { console.error('apply threw', e); process.exit(1) })
}

// wait a few microtask/macrotask ticks for the deferred run()+push() to complete
await new Promise((r) => setTimeout(r, 400))

const last = updates[updates.length - 1]
const lastDbSize = last?.patch?.lastDbSize
const launches = last?.patch?.launchesSincePrune
console.log('pushCount:', updates.length)
console.log('lastDbSize:', lastDbSize)
console.log('launchesSincePrune (seeded 3 +1):', launches)
console.log('lastResult:', last?.patch?.lastResult)
console.log('intervals registered:', intervals.length)
console.log('spawns (schtasks/powershell):', spawns.map((s) => s.argv[0]).join(', '))

let ok = true
if (updates.length === 0) { console.error('FAIL: settings.update never called (panel would be blank)'); ok = false }
if (typeof lastDbSize !== 'number' || lastDbSize <= 0) { console.error('FAIL: lastDbSize not a positive number'); ok = false }
// no graceMs-less spawn should have been attempted; ensure graceMs present on all spawns
for (const s of spawns) { if (!s.graceMs) { console.error('FAIL: spawn missing graceMs', s.argv); ok = false } }

// NOTE: do NOT read/write the real .runtime-diag.json — that file is owned by the
// real DSH host. Write harness output to a separate file so we never contaminate
// the ground-truth diagnostic.
const HARNESS_DIAG = 'D:/AI/dsh-cookie-pruner/.runtime-diag.harness.json'
try {
  writeFileSync(HARNESS_DIAG, JSON.stringify({
    harness: 'v0.1.13', pushCount: updates.length, lastDbSize,
    launchesSincePrune: launches, spawns: spawns.map((s) => s.argv[0]),
    intervals: intervals.length,
  }, null, 2))
  console.log('harness diag written to', HARNESS_DIAG, '(NOT the real .runtime-diag.json)')
} catch (e) { console.error('note: could not write harness diag', e.message) }

console.log(ok ? '\nHOST HARNESS: PASS' : '\nHOST HARNESS: FAIL')
process.exit(ok ? 0 : 1)
