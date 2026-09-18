// blast-engineering-ui — host-plugin contract test (no DSH, no restart).
//
//   node blast_engineering_ui/tools/host-contract-test.mjs
//
// Loads lib/host.mjs exactly as the Cordis loader would (ESM import of the
// package root), applies it against a minimal fake context that records the
// webServer route registration, then drives the registered handler with fake
// request/response objects — proving the host row wires up and serves real data
// before it is ever mounted in DSH.
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const repoRoot = path.resolve(pluginRoot, '..')

const mod = await import(new URL('../lib/host.mjs', import.meta.url).href)
const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

record('named export: name', mod.name === 'blast-engineering-ui', mod.name)
record('named export: inject', Array.isArray(mod.inject) && mod.inject.includes('webServer'), JSON.stringify(mod.inject))
record('named export: apply', typeof mod.apply === 'function')

const routes = []
const injections = []
const ctx = {
  logger: { info() {}, warn(m) { console.log('  [warn]', m) }, error(m) { console.log('  [error]', m) } },
  effect(fn, label) { const dispose = fn(); record(`ctx.effect ran: ${label}`, typeof dispose === 'function'); return dispose },
  on(event, fn) { if (event === 'webserver/index-inject') injections.push(fn); return () => {} },
  webServer: {
    host: '127.0.0.1',
    port: 43120,
    register(route) { routes.push(route); return () => {} },
  },
}

mod.apply(ctx, {})
record('registered one webServer route', routes.length === 1, routes.length ? `${routes[0].kind} ${routes[0].path}` : 'none')
record('route is a prefix route on /blast-engineering-api', routes[0] && routes[0].kind === 'prefix' && routes[0].path === '/blast-engineering-api', routes[0] && routes[0].path)

// index injection rows carry the browser-facing API base URL
const table = []
injections.forEach((fn) => fn(table))
const apiRow = table.find((row) => row.name === '__BLAST_ENGINEERING_API__')
record('index injection publishes __BLAST_ENGINEERING_API__', Boolean(apiRow && apiRow.value === 'http://127.0.0.1:43120/blast-engineering-api'), apiRow && apiRow.value)
const ctxRow = table.find((row) => row.name === '__BLAST_ENGINEERING_CONTEXT__')
record('index injection publishes host context', Boolean(ctxRow && ctxRow.value && ctxRow.value.repo_root === repoRoot), ctxRow && ctxRow.value && ctxRow.value.repo_root)

// drive the real handler over a real socket: start an http server on it.
const server = http.createServer((req, res) => { routes[0].handler(req, res) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/blast-engineering-api`

async function get(pathname, binary) {
  const res = await fetch(base + pathname)
  const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
  return { status: res.status, contentType: res.headers.get('content-type'), body }
}

const health = await get('/health')
record('GET /health', health.status === 200 && JSON.parse(health.body).plugin === 'blast-engineering-ui', `${health.status}`)

const manifest = await get('/manifest')
const manifestJson = manifest.status === 200 ? JSON.parse(manifest.body) : null
record('GET /manifest', Boolean(manifestJson && manifestJson.cases && manifestJson.cases.length > 0), manifestJson ? `${manifestJson.cases.length} cases, focus=${manifestJson.focus_case}` : 'failed')

const focus = manifestJson && manifestJson.cases.find((c) => c.case_id === 'AGENT_DEMO_1')
// The newest run for a case can legitimately be an interrupted one whose package
// holds only INPUT.json; the contract test wants a real finished Design Version.
const version = focus && (focus.versions.find((v) => v.primary && v.final_status && v.artifact_count > 5)
  || focus.versions.find((v) => v.final_status && v.artifact_count > 5)
  || focus.versions.find((v) => v.primary))
const detail = version ? await get(`/version?task=${encodeURIComponent(version.task_id)}`) : { status: 0 }
const detailJson = detail.status === 200 ? JSON.parse(detail.body) : null
record('GET /version (canonical + render)', Boolean(detailJson && detailJson.canonical && detailJson.render && detailJson.render.must_state.length >= 4),
  detailJson ? `${detailJson.canonical.status.final} / ${detailJson.render.core_metrics.length} metrics` : 'failed')

const png = await get(`/artifact?task=${encodeURIComponent(version.task_id)}&name=FINAL_PLAN.png`, true)
record('GET /artifact FINAL_PLAN.png', png.status === 200 && png.contentType === 'image/png' && png.body.subarray(1, 4).toString() === 'PNG', `${png.status} ${png.contentType} ${png.body.length} bytes`)

const escape = await get(`/artifact?task=${encodeURIComponent(version.task_id)}&name=${encodeURIComponent('..\\..\\STATUS.json')}`)
record('GET /artifact refuses traversal', escape.status === 404, String(escape.status))

// Round 2 routes: the live Engineering Trace + the Python process's own runtime record.
const activity = await get('/activity?case=AGENT_DEMO_1')
const activityJson = activity.status === 200 ? JSON.parse(activity.body) : null
record('GET /activity (case activity, running runs included)',
  Boolean(activityJson && activityJson.ok && activityJson.latest && activityJson.latest.task_id),
  activityJson && activityJson.latest
    ? `${activityJson.latest.phase} ${activityJson.latest.diameter_m}m running=${activityJson.latest.running}`
    : 'failed')

const stages = await get(`/stages?task=${encodeURIComponent(version.task_id)}`)
const stagesJson = stages.status === 200 ? JSON.parse(stages.body) : null
record('GET /stages (pipeline’s own stage verdicts)',
  Boolean(stagesJson && stagesJson.ok && stagesJson.stages && stagesJson.stages.unified_qc),
  stagesJson && stagesJson.stages ? Object.keys(stagesJson.stages).length + ' stages' : 'failed')

const runtime = await get(`/runtime?task=${encodeURIComponent(version.task_id)}`)
const runtimeJson = runtime.status === 200 ? JSON.parse(runtime.body) : null
record('GET /runtime (runtime provenance contract)',
  Boolean(runtimeJson && runtimeJson.ok && runtimeJson.kind === 'runtime_provenance.v1' && 'provenance' in runtimeJson),
  runtimeJson && runtimeJson.provenance
    ? `single_process.enabled=${runtimeJson.provenance.single_process.enabled}`
    : 'runs recorded before round 2 carry no provenance file (expected)')

const bad = await get('/nope')
record('unknown endpoint -> 404 json', bad.status === 404, String(bad.status))

server.close()

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
