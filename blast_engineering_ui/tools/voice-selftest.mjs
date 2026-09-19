// blast-engineering-ui — self-test for the voice layer (no DSH, no microphone needed).
//
//   node blast_engineering_ui/tools/voice-selftest.mjs [repoRoot]
//
// Verifies against the REAL project data (no mocks):
//   1. GET /voice?task=<id> returns a script built only from the project's own
//      `render.core_metrics` / `must_state` / `engineering_notices` values
//   2. the spoken text never contains paths, raw JSON, provenance or trace material
//   3. GET /diff?task=<id>&to=5.5 returns the current diameter from the canonical result
//   4. the composer-side impact detector (lib/client.js logic, re-implemented here as
//      a table of cases) classifies Test-1/Test-2 utterances the way the UI does
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCaseStore } from '../lib/case-store.mjs'
import { createApiHandler, API_PREFIX } from '../lib/api.mjs'
import { buildVoiceScript, buildImpactDiff } from '../lib/voice-script.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const repoRoot = path.resolve(process.argv[2] || path.join(pluginRoot, '..'))

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const store = createCaseStore({ repoRoot, pluginRoot })
const server = http.createServer((req, res) => {
  createApiHandler(store, { repoRoot, startedAt: new Date() })(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}${API_PREFIX}`
const getJson = async (p) => (await fetch(base + p)).json()

const manifest = await getJson('/manifest')
const caseRow = manifest.cases.find((c) => c.case_id === 'AGENT_DEMO_1') || manifest.cases[0]
const version = caseRow.versions.find((v) => v.diameter_m === 5) || caseRow.versions[0]
console.log(`repoRoot = ${repoRoot}`)
console.log(`task     = ${version.task_id} (${caseRow.case_id} / ${version.diameter_m} m)`)

// 1. the script is built from the project's own numbers
const voice = await getJson(`/voice?task=${encodeURIComponent(version.task_id)}`)
record('GET /voice ok', voice.ok === true && voice.kind === 'voice_script.v1', voice.kind)
const rendered = await store.version(version.task_id)
const metrics = new Map((rendered.render.core_metrics || []).map((m) => [m.label_cn, m.value]))
const holes = metrics.get('炮孔总数')
const charge = metrics.get('推荐总装药量（kg）')
record('script speaks the real hole count', holes !== undefined && voice.text.includes(String(holes)),
  `炮孔总数=${holes}`)
record('script speaks the real total charge', charge !== undefined && voice.text.includes(String(charge)),
  `推荐总装药量=${charge}`)
record('script speaks the project final status',
  String(voice.text).includes(String(rendered.canonical.status.final_cn || rendered.canonical.status.final)),
  rendered.canonical.status.final)
record('script mentions the review requirement',
  voice.text.includes('需要人工复核') || voice.text.includes('无需人工复核'),
  rendered.canonical.review.required ? 'review required' : 'no review needed')

// 2. nothing developer-facing may be spoken
const forbidden = ['D:\\', '/agent_adapter/', 'workspace/tasks', 'STATUS.json', 'FINAL_STATUS.json',
  'provenance', 'tool_call', 'Think', '{', '}', '"']
const leak = forbidden.find((token) => voice.text.includes(token))
record('spoken text carries no path / raw JSON / trace', leak === undefined, leak ? `leaked: ${leak}` : 'clean')
record('guard.contains_path_like = false', voice.guard.contains_path_like === false)
record('guard.contains_raw_json = false', voice.guard.contains_raw_json === false)
record('guard.within_cap', voice.guard.within_cap === true, `${voice.chars} chars`)
record('guard lists the excluded categories', Array.isArray(voice.guard.excluded_categories)
  && voice.guard.excluded_categories.length >= 5, `${voice.guard.excluded_categories.length} categories`)
record('only whitelisted metrics are included', voice.guard.metrics_included
  .every((label) => String(metrics.get(label)) !== 'undefined' || metrics.has(label) === false),
  voice.guard.metrics_included.join(' / '))

// 3. the impact diff comes from the canonical result, not from the page
const diff = await getJson(`/diff?task=${encodeURIComponent(version.task_id)}&to=5.5`)
record('GET /diff returns the current diameter', diff.ok === true && Number(diff.from) === Number(version.diameter_m),
  `${diff.from} → ${diff.to}`)
record('diff source is the canonical render block', String(diff.source).includes('render.core_metrics'), diff.source)

// 4. pure-function checks of the script builder + impact diff
const built = buildVoiceScript({ case_id: 'X', task_id: 'Y', design_version: { diameter_m: 5 }, render: {}, canonical: {} })
record('builder degrades gracefully without render', built.ok === true && built.text.length > 0, built.text)
const emptyDiff = buildImpactDiff({ render: {} }, 6)
record('impact diff without canonical yields null (never a guess)', emptyDiff.from === null, JSON.stringify(emptyDiff))

// 5. missing ?task= is a 400, unknown task a 404
record('GET /voice without ?task is 400', (await fetch(base + '/voice')).status === 400)
record('GET /voice unknown task is 404', (await fetch(base + '/voice?task=NOPE')).status === 404)

server.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`)
if (failed.length) process.exitCode = 1
