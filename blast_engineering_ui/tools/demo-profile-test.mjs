// Demo Profile self-test — offline, no DSH, no LLM.
//
//   node blast_engineering_ui/tools/demo-profile-test.mjs
//
// It loads lib/blast-tools.mjs the way the preset does, through a stub of the two
// DSH modules the plugin imports, then exercises the real logic:
//   * both tools register, and their argument/output schemas stay inside the
//     JSON-Schema subset DSH's `defineTool` accepts (the stub enforces the same
//     keyword list, so an authoring mistake fails here instead of at load time);
//   * one allowlisted command classifies as allowed, and the interesting
//     near-misses (chained, redirected, non-venv python, arbitrary cmdlet) do not;
//   * an off-allowlist command WITHOUT an approval channel fails closed;
//   * an off-allowlist command whose approval is rejected also fails closed, and
//     one that is allowed once gets executed;
//   * `blast_engine operation=doctor` really runs the project adapter CLI, and the
//     runtime provenance records the environment that was passed to it.
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const repoRoot = path.resolve(process.argv[2] || path.join(pluginRoot, '..'))
const pluginFile = path.join(pluginRoot, 'lib', 'blast-tools.mjs')
const provenanceFile = path.join(pluginRoot, '.cache', 'runtime_provenance.jsonl')

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── stub the two DSH modules the plugin imports ──────────────────────────────
// The stub mirrors the documented contract: `defineTool` accepts
// { name, description, parameters, output{schema,render}, execute } and rejects
// schema keywords outside the supported subset (type/oneOf/properties/required/
// additionalProperties/items/enum/const + annotations).
const SUPPORTED_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function checkSchema(node, at) {
  if (node === null || typeof node !== 'object') throw new Error(`${at}: not a schema object`)
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) throw new Error(`${at}.${key} is not supported by the value schema DSL`)
  }
  if (node.type !== undefined && (Array.isArray(node.type) || !SCHEMA_TYPES.has(node.type))) {
    throw new Error(`${at}.type is not a supported type`)
  }
  if (node.required !== undefined && node.required !== true) throw new Error(`${at}.required must be true when present`)
  if (node.properties !== undefined) {
    for (const [key, value] of Object.entries(node.properties)) checkSchema(value, `${at}.${key}`)
  }
  if (node.items !== undefined) checkSchema(node.items, `${at}.items`)
  if (node.oneOf !== undefined) node.oneOf.forEach((value, i) => checkSchema(value, `${at}.oneOf[${i}]`))
}

const stubSource = `
export function defineTool(options) {
  const check = globalThis.__schemaCheck
  if (typeof options.name !== 'string' || options.name === '') throw new Error('defineTool: name is required')
  if (typeof options.description !== 'string' || options.description === '') throw new Error('defineTool: description is required')
  if (!options.output || !options.output.schema) throw new Error('defineTool: output.schema is required')
  if (typeof options.output.render !== 'function') throw new Error('defineTool: output.render is required')
  if (typeof options.execute !== 'function') throw new Error('defineTool: execute is required')
  if (options.parameters) {
    if (typeof options.parameters !== 'object') throw new Error('defineTool: parameters must be a property map')
    for (const [key, spec] of Object.entries(options.parameters)) check(spec, options.name + ':parameters.' + key)
  }
  check(options.output.schema, options.name + ':output')
  return options
}
`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'stub:dsh-tools', shortCircuit: true, format: 'module' }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'stub:dsh-tools') return { format: 'module', source: stubSource, shortCircuit: true }
    return nextLoad(url, context)
  },
})
globalThis.__schemaCheck = checkSchema

// ── load the plugin the way the preset does ─────────────────────────────────
const plugin = await import(`file://${pluginFile.replace(/\\/g, '/')}`)

/** Mount the plugin on a fake ctx, returning the tools it registered. */
function mount(services) {
  const captured = []
  const sections = []
  const ctx = {
    tools: { register: (definition) => { captured.push(definition); return () => {} } },
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    get: (name) => (services || {})[name],
    logger: { info() {}, warn() {} },
  }
  plugin.apply(ctx, { repoRoot })
  return {
    engine: captured.find((tool) => tool.name === 'blast_engine'),
    shell: captured.find((tool) => tool.name === 'blast_shell'),
    count: captured.length,
    sections,
  }
}

const mounted = mount({})
const engine = mounted.engine
const shellTool = mounted.shell
record('plugin exports the cordis contract',
  plugin.name === 'blast-demo-tools' && Array.isArray(plugin.inject) && typeof plugin.apply === 'function',
  `name=${plugin.name} inject=${JSON.stringify(plugin.inject)}`)
record('two tools registered (and only two)', mounted.count === 2,
  [engine, shellTool].map((tool) => tool && tool.name).join(', '))
record('blast_engine operation set is closed and explicit',
  Boolean(engine && engine.parameters.operation.enum) && engine.parameters.operation.enum.length === 10,
  engine ? engine.parameters.operation.enum.join(', ') : 'missing')
record('blast_engine exposes the project’s own five inputs + case_id',
  ['shaft_depth_m', 'shaft_diameter_m', 'protodyakonov_f', 'planned_advance_mm',
    'borehole_diameter_mm', 'borehole_depth_mm', 'case_id'].every((key) => key in engine.parameters))
record('system prompt section registered', mounted.sections.length === 1 && mounted.sections[0].name === 'tool:blast')
record('both tools declare an output schema (defineTool would have thrown otherwise)',
  Boolean(engine.output.schema && shellTool.output.schema))

// ── the allowlist is a whitelist, not a substring test ──────────────────────
const paths = { repoRoot, venvPython: path.join(repoRoot, '.venv', 'Scripts', 'python.exe') }
const allowedCommands = [
  'agent_adapter\\blast.cmd run-analysis --foreground --input-file .agent_tmp\\request.json',
  '.venv\\Scripts\\python.exe -m agent_adapter.cli canonical-result --task-id T20260918_115907_AGENT_DEMO_1_vsan',
]
const refusedCommands = [
  ['chained statement', 'agent_adapter\\blast.cmd run-analysis; Remove-Item -Recurse agent_adapter'],
  ['redirect', 'agent_adapter\\blast.cmd run-analysis > out.txt'],
  ['pipeline', 'agent_adapter\\blast.cmd run-analysis | Out-File x'],
  ['arbitrary cmdlet', 'Remove-Item -Recurse -Force agent_adapter'],
  ['unknown subcommand', 'agent_adapter\\blast.cmd detonate'],
  ['PATH python, not the project venv', 'python -m agent_adapter.cli doctor'],
  ['foreign python', 'C:\\Python312\\python.exe -m agent_adapter.cli doctor'],
  ['system listing', 'Get-ChildItem C:\\'],
]
for (const command of allowedCommands) {
  const verdict = plugin.classifyCommand(command, paths)
  record(`allowlist accepts: ${command.slice(0, 58)}`, verdict.allowed === true, verdict.reason || verdict.entry)
}
for (const [label, command] of refusedCommands) {
  const verdict = plugin.classifyCommand(command, paths)
  record(`allowlist refuses (${label})`, verdict.allowed === false, verdict.reason)
}

// ── blast_shell: fail-closed / rejected / approved-once ─────────────────────
const shellRuns = []
const okShell = { run: async (spec) => { shellRuns.push(spec); return { exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' }, sandbox: { mode: 'workspace-write', denied: false } } } }
const policyService = { resolve: () => ({ mode: 'workspace-write', workspaceRoot: repoRoot }) }
const execContext = { agent: { session: { header: { cwd: repoRoot } } }, callId: 'call-1' }

const shellOf = (services) => mount(services).shell

const noChannelRun = await shellOf({ shell: okShell })
  .execute({ command: 'Get-Process', description: 'test' }, execContext)
record('off-allowlist without an approval channel → fail closed, nothing runs',
  noChannelRun.decision === 'fail-closed' && noChannelRun.allowed === false && shellRuns.length === 0,
  noChannelRun.summary.slice(0, 90))

const rejectedRun = await shellOf({ shell: okShell, sandboxPolicy: policyService, approval: { request: async () => 'rejected' } })
  .execute({ command: 'Get-Process', description: 'test' }, execContext)
record('off-allowlist + approval rejected → nothing runs',
  rejectedRun.decision === 'rejected' && shellRuns.length === 0, rejectedRun.summary.slice(0, 90))

const approvedRun = await shellOf({ shell: okShell, sandboxPolicy: policyService, approval: { request: async () => 'allowed-once' } })
  .execute({ command: 'Get-Process', description: 'test' }, execContext)
record('off-allowlist + allowed-once → runs exactly once',
  approvedRun.decision === 'approved-once' && shellRuns.length === 1, approvedRun.summary)

const allowlistedRun = await shellOf({ shell: okShell, sandboxPolicy: policyService, approval: { request: async () => 'rejected' } })
  .execute({ command: 'agent_adapter\\blast.cmd doctor', description: 'adapter self-check' }, execContext)
record('allowlisted command needs no approval', allowlistedRun.decision === 'allowlisted' && allowlistedRun.allowed === true,
  `${allowlistedRun.summary} (runs=${shellRuns.length})`)
const lastRun = shellRuns[shellRuns.length - 1]
record('allowlisted command still runs inside the session sandbox policy',
  lastRun.sandboxPolicy && lastRun.sandboxPolicy.mode === 'workspace-write',
  JSON.stringify(lastRun.sandboxPolicy))
record('allowlisted command carries the runtime env for the compute process',
  lastRun.env.BLAST_AGENT_SINGLE_PROCESS === '1' && lastRun.env.BLAST_AGENT_ORIGIN === 'dsh-demo-profile',
  JSON.stringify(lastRun.env).slice(0, 130))

// ── blast_engine: argument validation + one real adapter run ────────────────
let rejectedId = false
try {
  await engine.execute({ operation: 'task_status', task_id: '..\\..\\etc' })
} catch (error) {
  rejectedId = /invalid task_id/.test(error.message)
}
record('blast_engine rejects a malformed task id before spawning', rejectedId)

let rejectedOperation = false
try {
  await engine.execute({ operation: 'rm_rf', case_id: 'AGENT_DEMO_1' })
} catch {
  rejectedOperation = true
}
record('blast_engine refuses an unknown operation', rejectedOperation)

let rejectedNumber = false
try {
  await engine.execute({ operation: 'run_analysis', case_id: 'PROBE_ONLY', shaft_diameter_m: -5 })
} catch (error) {
  rejectedNumber = /invalid shaft_diameter_m/.test(error.message)
}
record('blast_engine rejects a non-positive engineering value', rejectedNumber)

const provenanceBefore = fs.existsSync(provenanceFile)
  ? fs.readFileSync(provenanceFile, 'utf8').trim().split('\n').length : 0
const doctor = await engine.execute({ operation: 'doctor' })
record('blast_engine operation=doctor really ran the project adapter CLI',
  doctor.ok === true && /doctor: \d+\/\d+ checks passed/.test(doctor.summary), doctor.summary)
record('the adapter’s own JSON envelope is returned verbatim',
  typeof doctor.envelope_json === 'string' && doctor.envelope_json.length > 200, `${doctor.envelope_json.length} chars`)
const provenanceAfter = fs.readFileSync(provenanceFile, 'utf8').trim().split('\n').length
record('runtime provenance appended for the call', provenanceAfter > provenanceBefore,
  `${provenanceBefore} → ${provenanceAfter} records in .cache/runtime_provenance.jsonl`)
const lastProvenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8').trim().split('\n').pop())
record('provenance records the interpreter and the environment it passed',
  lastProvenance.python.endsWith('python.exe') && lastProvenance.env.BLAST_AGENT_SINGLE_PROCESS === '1'
  && lastProvenance.operation === 'doctor',
  `${lastProvenance.operation} → ${lastProvenance.python}`)

// ── the preset template renders into the assembly the installer writes ──────
const rendered = fs.readFileSync(path.join(pluginRoot, 'demo-profile', 'agent.cordis.template.yml'), 'utf8')
  .replace(/\{\{PLUGIN_FILE\}\}/g, pluginFile.split(path.sep).join('/'))
  .replace(/\{\{REPO_ROOT\}\}/g, repoRoot.split(path.sep).join('/'))
record('preset template has no unresolved installer placeholder',
  !/\{\{(PLUGIN_FILE|REPO_ROOT)\}\}/.test(rendered))
// `{{cwd}}` / `{{model}}` are DSH's own runtime placeholders (dsh-persona resolves
// them), so the check runs on the row list only, with comments stripped.
const rowLines = rendered.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
record('preset mounts our tool plugin and no general shell/fs tool',
  rowLines.includes('blast-demo-tools')
  && !/dsh-tool-pwsh|dsh-tool-bash|dsh-tool-fs\b/.test(rowLines)
  && !rowLines.includes('danger-full-access'),
  `${rendered.split('\n').length} lines`)


const failed = checks.filter((check) => !check.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)



