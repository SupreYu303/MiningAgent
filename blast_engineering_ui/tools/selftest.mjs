// blast-engineering-ui — self-test for the host data layer (no DSH needed).
//
//   node blast_engineering_ui/tools/selftest.mjs [repoRoot]
//
// Verifies against the REAL project data (no mocks):
//   1. manifest scans real task packages and groups them per case / Design Version
//   2. version() returns the canonical result + deterministic render block, from
//      the project's own `agent_adapter.cli canonical-result`
//   3. validationFor() runs the project's consistency validator
//   4. artifact() resolves real artifacts inside the package dir and refuses traversal
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCaseStore } from '../lib/case-store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const repoRoot = path.resolve(process.argv[2] || path.join(pluginRoot, '..'))

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const store = createCaseStore({ repoRoot, pluginRoot })
console.log(`repoRoot   = ${repoRoot}`)
console.log(`pluginRoot = ${pluginRoot}`)

const manifest = store.manifest()
record('manifest.project.root', manifest.project.root === repoRoot, manifest.project.root)
record('manifest.cases > 0', manifest.cases.length > 0, `${manifest.cases.length} cases / ${manifest.project.version_count} versions`)

const agentCase = manifest.cases.find((c) => c.case_id === 'AGENT_DEMO_1')
record('case AGENT_DEMO_1 present', Boolean(agentCase), agentCase ? `${agentCase.version_count} versions, diameters ${JSON.stringify(agentCase.diameters)}` : 'missing')
if (agentCase) {
  const primaries = agentCase.versions.filter((v) => v.primary)
  record('AGENT_DEMO_1 primary Design Versions', primaries.length >= 2, primaries.map((v) => `${v.diameter_m}m:${v.short_id}`).join(', '))
}

const target = agentCase
  ? (agentCase.versions.find((v) => v.primary && v.diameter_m === 6)
    || agentCase.versions.find((v) => v.primary)
    || agentCase.versions[0])
  : null
record('picked a real Design Version', Boolean(target), target ? `${target.task_id} (${target.diameter_m} m, ${target.artifact_count} artifacts)` : 'none')

if (target) {
  const detail = await store.version(target.task_id)
  record('version.canonical.schema', detail.canonical && detail.canonical.schema === 'canonical_result.v1', String(detail.canonical && detail.canonical.schema))
  record('version.canonical.status', Boolean(detail.canonical && detail.canonical.status.final), `${detail.canonical && detail.canonical.status.final} / confidence ${detail.canonical && detail.canonical.confidence.overall}`)
  record('version.render.must_state', Array.isArray(detail.render.must_state) && detail.render.must_state.length >= 4, `${detail.render.must_state.length} must-state items`)
  record('version.render.core_metrics', Array.isArray(detail.render.core_metrics) && detail.render.core_metrics.length > 0, `${detail.render.core_metrics.length} metrics`)
  record('version.render.engineering_notices', Array.isArray(detail.render.engineering_notices), `${detail.render.engineering_notices.length} notices`)
  record('version.artifacts > 0', detail.artifacts.length > 0, `${detail.artifacts.length} artifacts`)
  record('version.report_markdown real', typeof detail.report_markdown === 'string' && detail.report_markdown.length > 200, `${detail.report_markdown ? detail.report_markdown.length : 0} chars`)
  record('version.files ENGINEERING_QC.json', Boolean(detail.files['ENGINEERING_QC.json']), JSON.stringify(detail.files['ENGINEERING_QC.json'] || {}).slice(0, 90))
  record('version.files CHARGE_STRUCTURE.json', Boolean(detail.files['CHARGE_STRUCTURE.json']), detail.files['CHARGE_STRUCTURE.json'] ? 'groups=' + Object.keys(detail.files['CHARGE_STRUCTURE.json'].hole_groups || {}).join('|') : 'missing')
  record('version.canonical_meta.source', detail.canonical_meta.source === 'adapter-cli' || detail.canonical_meta.source === 'cache', `${detail.canonical_meta.source} (${detail.canonical_meta.elapsed_s}s)`)

  const plan = store.artifact(target.task_id, 'FINAL_PLAN.png')
  record('artifact FINAL_PLAN.png', Boolean(plan), plan ? `${plan.bytes} bytes, ${plan.contentType}` : 'missing')
  const traverse = store.artifact(target.task_id, '..\\..\\STATUS.json')
  record('artifact traversal refused', traverse === null, JSON.stringify(traverse))

  const validation = await store.validationFor(target.task_id)
  record('validation ran', validation.results && typeof validation.results.valid === 'boolean',
    `valid=${validation.results.valid} counts=${JSON.stringify(validation.metrics)}`)
  record('validation checks table', Object.keys(validation.results.checks || {}).length > 0, `${Object.keys(validation.results.checks || {}).length} checks`)
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
