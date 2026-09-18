// blast-engineering-ui — Demo Profile tool plugin (the ONLY execution surface of
// the `blast-demo` agent preset).
//
// Why this file exists
// --------------------
// DSH 2.0.3 (measured on this machine, see docs/DEMO_PROFILE.md §1) has exactly
// three permission knobs — sandbox mode (read-only / workspace-write /
// danger-full-access), approval policy (ask / never) and the preset table that
// bundles them. There is NO command allowlist in the host permission stack, so
// "run only the known BLAST commands without a generic escalation prompt" cannot
// be configured there. It has to live in the AGENT COMPOSITION, i.e. in the
// preset's rows. That is what this plugin is:
//
//   * `blast_engine` — the engineering path. It never sees a shell string: it
//     maps a closed operation set onto a fixed argv for the project's own
//     adapter CLI (`python -m agent_adapter.cli …`), validates every argument,
//     and spawns that exact argv directly (no shell, no pwsh, no command
//     interpreter). `run_analysis` uses the adapter's documented background
//     mode, so the tool call returns in seconds and the real pipeline keeps
//     running as a detached worker.
//   * `blast_shell` — the escape hatch. A command matching the published
//     allowlist (`agent_adapter\blast.cmd …` / `.venv\Scripts\python.exe -m
//     agent_adapter.cli …`) runs through the SANDBOXED DSH executor
//     (`ctx.shell`) with no approval prompt. Anything else must be approved by
//     the user for that single call (`ctx.approval` → allowed-once); without an
//     approval channel it fails closed.
//
// Runtime provenance: every call records the exact environment it passed to the
// Python compute process (BLAST_AGENT_SINGLE_PROCESS=1 + BLAST_AGENT_ORIGIN), and
// the adapter process itself writes down what IT saw
// (`agent_adapter/workspace/logs/runtime_provenance.jsonl`,
// `tasks/<id>/RUNTIME_PROVENANCE.json`). The two sides together are what makes
// the claim "the flag really reached the computing process" checkable rather
// than asserted.
//
// This plugin writes nothing outside <repo>/blast_engineering_ui/.cache and the
// project's own adapter workspace, which the adapter CLI owns.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'blast-demo-tools'
export const inject = ['tools', 'systemPrompt']

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')

/** Subcommands of `agent_adapter.cli` this profile is allowed to run. */
const OPERATIONS = {
  doctor: { argv: () => ['doctor'], timeoutMs: 120000 },
  validate_input: { argv: (a) => ['validate-input', '--input-json', JSON.stringify(requestOf(a))], timeoutMs: 120000 },
  run_analysis: {
    argv: (a) => ['run-analysis', '--input-json', JSON.stringify(requestOf(a)),
      ...(a.parent_task_id ? ['--parent-task-id', a.parent_task_id] : [])],
    timeoutMs: 180000,
  },
  task_status: { argv: (a) => ['task-status', ...(a.task_id ? ['--task-id', a.task_id] : [])], timeoutMs: 60000 },
  get_result: {
    argv: (a) => ['get-result',
      ...(a.task_id ? ['--task-id', a.task_id] : []),
      ...(a.case_id ? ['--case-id', a.case_id] : []),
      ...(a.section ? ['--section', a.section] : [])],
    timeoutMs: 120000,
  },
  canonical_result: {
    argv: (a) => ['canonical-result',
      ...(a.task_id ? ['--task-id', a.task_id] : []),
      ...(a.case_id ? ['--case-id', a.case_id] : [])],
    timeoutMs: 180000,
  },
  validate_result_consistency: {
    argv: (a) => ['validate-result-consistency',
      ...(a.task_id ? ['--task-id', a.task_id] : []),
      ...(a.case_id ? ['--case-id', a.case_id] : [])],
    timeoutMs: 180000,
  },
  list_tasks: { argv: () => ['list-tasks'], timeoutMs: 60000 },
  generate_report: {
    argv: (a) => ['generate-report',
      ...(a.task_id ? ['--task-id', a.task_id] : []),
      ...(a.case_id ? ['--case-id', a.case_id] : [])],
    timeoutMs: 180000,
  },
  generate_figures: {
    argv: (a) => ['generate-figures',
      ...(a.task_id ? ['--task-id', a.task_id] : []),
      ...(a.case_id ? ['--case-id', a.case_id] : []),
      '--targets', a.targets || 'plan,3d,charge'],
    timeoutMs: 240000,
  },
}

/** The five engineering inputs the one-click pipeline accepts (real schema fields). */
const INPUT_FIELDS = [
  'shaft_depth_m', 'shaft_diameter_m', 'protodyakonov_f',
  'planned_advance_mm', 'borehole_diameter_mm', 'borehole_depth_mm',
]

const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/

/** Build the raw request object from the model's arguments (no invented fields). */
function requestOf(args) {
  const raw = {}
  for (const field of INPUT_FIELDS) {
    if (args[field] !== undefined && args[field] !== null) raw[field] = args[field]
  }
  if (args.case_id) raw.case_id = args.case_id
  return raw
}

function assertArgs(args) {
  for (const key of ['case_id', 'task_id', 'parent_task_id']) {
    const value = args[key]
    if (value !== undefined && value !== null && !ID_RE.test(String(value))) {
      throw new Error(`invalid ${key}: expected [A-Za-z0-9_.-]{1,64}`)
    }
  }
  for (const field of INPUT_FIELDS) {
    const value = args[field]
    if (value === undefined || value === null) continue
    if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${field}: expected a positive number`)
  }
}

/**
 * The published allowlist for `blast_shell`. Each entry is a *whole-command*
 * shape, not a substring test: the command must start with the launcher, name
 * one known subcommand, and carry only characters that cannot introduce a new
 * statement, a redirect, a subexpression, a pipeline or a variable expansion.
 */
const ALLOWED_SUBCOMMANDS = ['doctor', 'validate-input', 'run-analysis', 'task-status',
  'get-result', 'canonical-result', 'validate-result-consistency', 'list-tasks',
  'compare-results', 'generate-figures', 'generate-report']

const SHELL_ALLOWLIST = [
  {
    id: 'adapter-cmd',
    pattern: /^\s*(?:"([^"]*blast\.cmd)"|([^\s"|&;<>()$`]*blast\.cmd))\s+([a-z][a-z-]*)((?:\s+[A-Za-z0-9_.,:=/\\-]+)*)\s*$/i,
    requiresVenvPython: false,
  },
  {
    id: 'adapter-module',
    pattern: /^\s*(?:"([^"]*[\\/](?:python|python3)\.exe)"|([^\s"|&;<>()$`]*[\\/](?:python|python3)\.exe))\s+-m\s+agent_adapter\.cli\s+([a-z][a-z-]*)((?:\s+[A-Za-z0-9_.,:=/\\-]+)*)\s*$/i,
    requiresVenvPython: true,
  },
]

/** Classify one shell command against the published allowlist. */
export function classifyCommand(command, paths) {
  for (const entry of SHELL_ALLOWLIST) {
    const match = entry.pattern.exec(String(command || ''))
    if (!match) continue
    const launcher = match[1] || match[2] || ''
    const subcommand = match[3]
    if (!ALLOWED_SUBCOMMANDS.includes(subcommand)) {
      return { allowed: false, entry: null, reason: `unknown adapter subcommand "${subcommand}"` }
    }
    if (entry.requiresVenvPython && path.resolve(launcher) !== path.resolve(paths.venvPython)) {
      return { allowed: false, entry: null, reason: `python must be the project venv interpreter (${paths.venvPython})` }
    }
    return { allowed: true, entry: entry.id, subcommand, launcher }
  }
  return { allowed: false, entry: null, reason: 'command is outside the BLAST demo allowlist' }
}

export function apply(ctx, config = {}) {
  const repoRoot = path.resolve(config.repoRoot || path.join(pluginRoot, '..'))
  const venvPython = path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
  const cacheDir = path.join(pluginRoot, '.cache')
  const provenanceFile = path.join(cacheDir, 'runtime_provenance.jsonl')
  const paths = { repoRoot, venvPython }

  /**
   * The environment every adapter process gets. `BLAST_AGENT_SINGLE_PROCESS=1`
   * is the declaration; the adapter writes down what it actually saw, which is
   * the half of the provenance that cannot be faked by the caller.
   */
  function computeEnv(detail) {
    return {
      BLAST_AGENT_SINGLE_PROCESS: '1',
      BLAST_AGENT_ORIGIN: 'dsh-demo-profile',
      BLAST_AGENT_ORIGIN_DETAIL: detail,
      PYTHONPATH: repoRoot,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    }
  }

  function recordProvenance(record) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.appendFileSync(provenanceFile, JSON.stringify(record) + '\n', 'utf8')
    } catch { /* provenance must never break a call */ }
  }

  /** Run the adapter CLI with a fixed argv; resolve with its single JSON envelope. */
  function runAdapter(operation, args) {
    const spec = OPERATIONS[operation]
    const argv = spec.argv(args)
    const env = computeEnv(`blast_engine:${operation}`)
    const started = Date.now()
    const fullArgv = ['-m', 'agent_adapter.cli', ...argv]
    recordProvenance({
      at: new Date().toISOString(),
      tool: 'blast_engine',
      operation,
      argv: fullArgv,
      cwd: repoRoot,
      python: venvPython,
      env,
    })
    return new Promise((resolve, reject) => {
      const child = spawn(venvPython, fullArgv, {
        cwd: repoRoot,
        windowsHide: true,
        env: { ...process.env, ...env },
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        reject(new Error(`adapter CLI timed out after ${spec.timeoutMs} ms: ${operation}`))
      }, spec.timeoutMs)
      child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
      child.stderr.on('data', (chunk) => { err += chunk.toString('utf8') })
      child.on('error', (error) => { clearTimeout(timer); reject(error) })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, out: out.trim(), err: err.trim(), argv: fullArgv,
          ms: Math.round((Date.now() - started) / 100) / 10 })
      })
    })
  }

  function summarize(operation, envelope) {
    if (!envelope) return `${operation}: the adapter CLI produced no JSON envelope`
    const results = envelope.results || {}
    switch (operation) {
      case 'run_analysis':
        return results.mode === 'background'
          ? `run_analysis queued: task ${envelope.task_id} (phase ${envelope.status}) — poll with operation=task_status`
          : `run_analysis finished: task ${envelope.task_id}, status ${envelope.status}, ${envelope.elapsed_s}s`
      case 'task_status':
        return `task_status: ${results.phase}${results.stage ? ' @ ' + results.stage : ''}`
          + ` (${results.elapsed_s === undefined ? '—' : results.elapsed_s}s)`
      case 'doctor':
        return `doctor: ${envelope.metrics ? envelope.metrics.passed + '/' + envelope.metrics.total : '—'} checks passed`
      default:
        return `${operation}: ${envelope.status || (envelope.success ? 'ok' : 'failed')} (task ${envelope.task_id || '—'})`
    }
  }

  // ── tool 1: the engineering path (structured, no shell string) ─────────────
  ctx.tools.register(defineTool({
    name: 'blast_engine',
    description: [
      'Run the BLAST shaft-blast design pipeline and read its results.',
      'Maps one closed operation set onto the project adapter CLI (python -m agent_adapter.cli …): no shell string, no PowerShell, every argument validated.',
      'Normal order: doctor → validate_input with the five engineering inputs → run_analysis (returns immediately; the real pipeline keeps running) → task_status until phase=done → canonical_result / get_result.',
      'Every number in a result comes from the project’s own computation; never restate a number you did not read here.',
    ].join(' '),
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: Object.keys(OPERATIONS),
        description: 'Which adapter command to run. Each is a fixed argv; no shell is involved.',
      },
      case_id: { type: 'string', description: 'Engineering case id, e.g. AGENT_DEMO_1.' },
      task_id: { type: 'string', description: 'Task id of a previous run (T…), when the operation needs one.' },
      parent_task_id: { type: 'string', description: 'Design version this run derives from (run_analysis only).' },
      shaft_depth_m: { type: 'number', description: '井筒深度 (m).' },
      shaft_diameter_m: { type: 'number', description: '井筒设计直径 (m).' },
      protodyakonov_f: { type: 'number', description: '普氏坚固性系数 f.' },
      planned_advance_mm: { type: 'number', description: '计划进尺 (mm).' },
      borehole_diameter_mm: { type: 'number', description: '炮孔直径 (mm).' },
      borehole_depth_mm: { type: 'number', description: '炮孔深度 (mm).' },
      section: { type: 'string', description: 'get_result: summary | render | canonical | full.' },
      targets: { type: 'string', description: 'generate_figures: comma list of plan,3d,charge.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          operation: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          task_id: { type: 'string' },
          case_id: { type: 'string' },
          phase: { type: 'string' },
          stage: { type: 'string' },
          status: { type: 'string' },
          elapsed_s: { type: 'number' },
          exit_code: { type: 'number' },
          argv: { type: 'array', required: true, items: { type: 'string' } },
          envelope_json: { type: 'string', required: true },
          stderr_tail: { type: 'string' },
          runtime_provenance: { type: 'string', required: true },
          next_actions: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.summary}\n\n${value.envelope_json}` }],
    },
    async execute(args) {
      assertArgs(args)
      const operation = args.operation
      const result = await runAdapter(operation, args)
      let envelope = null
      try { envelope = JSON.parse(result.out) } catch { envelope = null }
      const results = (envelope && envelope.results) || {}
      return {
        ok: Boolean(envelope && envelope.success !== false && result.code === 0),
        operation,
        summary: summarize(operation, envelope),
        ...(envelope && envelope.task_id ? { task_id: envelope.task_id } : {}),
        ...(envelope && envelope.case_id ? { case_id: envelope.case_id } : {}),
        ...(results.phase ? { phase: String(results.phase) } : {}),
        ...(results.stage ? { stage: String(results.stage) } : {}),
        ...(envelope && envelope.status ? { status: String(envelope.status) } : {}),
        ...(envelope && typeof envelope.elapsed_s === 'number' ? { elapsed_s: envelope.elapsed_s } : {}),
        exit_code: result.code === null ? -1 : result.code,
        argv: result.argv,
        envelope_json: envelope ? JSON.stringify(envelope, null, 1) : (result.out || '(no stdout)'),
        ...(result.err ? { stderr_tail: result.err.slice(-1200) } : {}),
        runtime_provenance: JSON.stringify({
          tool: 'blast_engine',
          operation,
          argv: ['python', ...result.argv],
          cwd: repoRoot,
          env: computeEnv(`blast_engine:${operation}`),
          recorded_at: new Date().toISOString(),
        }),
        ...(envelope && Array.isArray(envelope.next_actions)
          ? { next_actions: envelope.next_actions.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))) }
          : {}),
      }
    },
  }))

  // ── tool 2: the escape hatch (allowlist first, approval for the rest) ─────
  ctx.tools.register(defineTool({
    name: 'blast_shell',
    description: [
      'Run one PowerShell command.',
      'Commands on the published BLAST allowlist — the project adapter launcher (agent_adapter\\blast.cmd <subcommand> …) or the project venv python running -m agent_adapter.cli … — execute immediately through the sandboxed executor.',
      'Any other command needs the user’s approval for that single call; when approval is unavailable it does not run. Prefer blast_engine for engineering work: it needs no shell at all.',
    ].join(' '),
    parameters: {
      command: { type: 'string', required: true, description: 'The exact command line to run.' },
      description: { type: 'string', required: true, description: 'One-line summary of what the command does (5-10 words, UI only).' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds.' },
      justification: { type: 'string', description: 'Required when the command is outside the allowlist: one sentence telling the user why this exact command is needed.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          allowed: { type: 'boolean', required: true },
          allowlist_entry: { type: 'string' },
          decision: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          exit_code: { type: 'number' },
          stdout_tail: { type: 'string' },
          stderr_tail: { type: 'string' },
          sandbox_mode: { type: 'string' },
          sandbox_denied: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [value.summary, value.stdout_tail || '',
          value.stderr_tail ? `[stderr]\n${value.stderr_tail}` : ''].filter(Boolean).join('\n'),
      }],
    },
    async execute(args, exec) {
      const command = String(args.command || '')
      if (command.trim() === '') throw new Error('invalid command: expected a non-empty string')
      const verdict = classifyCommand(command, paths)
      let decision = verdict.allowed ? 'allowlisted' : 'approval-required'
      if (!verdict.allowed) {
        const approval = ctx.get('approval')
        if (!approval || !exec.agent) {
          return {
            ok: false, allowed: false, decision: 'fail-closed',
            summary: `refused: ${verdict.reason}; no approval channel is available in this session, so the command did not run.`,
          }
        }
        const outcome = await approval.request({
          agent: exec.agent,
          toolName: 'blast_shell',
          ...(exec.callId !== undefined ? { callId: exec.callId } : {}),
          reason: args.justification || `command outside the BLAST demo allowlist: ${command}`,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          return {
            ok: false, allowed: false, decision: String(outcome),
            summary: `refused by the user (${outcome}): ${verdict.reason}. The command did not run.`,
          }
        }
        decision = 'approved-once'
      }
      const env = computeEnv('blast_shell')
      recordProvenance({
        at: new Date().toISOString(), tool: 'blast_shell', decision,
        allowlist_entry: verdict.entry, command, cwd: repoRoot, env,
      })
      const shell = ctx.get('shell')
      if (!shell) throw new Error('blast_shell: no shell executor is mounted in this composition')
      const policyService = ctx.get('sandboxPolicy')
      const policy = policyService && exec.agent
        ? policyService.resolve({ session: exec.agent.session }) : undefined
      const run = await shell.run({
        command,
        workdir: repoRoot,
        ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
        env,
        ...(policy ? { sandboxPolicy: policy } : {}),
        ...(exec.signal ? { signal: exec.signal } : {}),
      })
      const stdout = (run.stdout && run.stdout.text) || ''
      const stderr = (run.stderr && run.stderr.text) || ''
      const denied = Boolean(run.sandbox && run.sandbox.denied)
      return {
        ok: run.exitCode === 0 && !denied,
        allowed: verdict.allowed,
        ...(verdict.entry ? { allowlist_entry: verdict.entry } : {}),
        decision,
        summary: denied
          ? `denied by the sandbox (${run.sandbox.mode}): the command did not complete`
          : `${decision}: exit ${run.exitCode === null ? 'signal' : run.exitCode}`,
        ...(run.exitCode === null ? {} : { exit_code: run.exitCode }),
        ...(stdout ? { stdout_tail: stdout.slice(-4000) } : {}),
        ...(stderr ? { stderr_tail: stderr.slice(-2000) } : {}),
        ...(run.sandbox ? { sandbox_mode: run.sandbox.mode, sandbox_denied: denied } : {}),
      }
    },
  }))

  ctx.systemPrompt.section({
    name: 'tool:blast',
    order: 106,
    text: [
      'This workspace runs the BLAST shaft-blast design pipeline. Use `blast_engine` for every engineering step: it is a fixed, validated argv set over the project adapter CLI and needs no shell.',
      'A diameter or parameter change is a NEW design version: pass the current task id as `parent_task_id` when you run it, and never restate a number you did not read from a tool result.',
      'The 平面布孔图 / 3D炮孔布置 / 装药结构 / 工程QC / 设计报告 artifacts are produced by the pipeline and rendered in the workspace preview pane; do not paste file paths or raw JSON into your reply.',
    ].join(' '),
  })

  ctx.logger?.info?.(`blast-demo-tools: mounted (repo ${repoRoot}, venv ${venvPython})`)
}




