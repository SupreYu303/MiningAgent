// blast-engineering-ui — host data layer (plain Node, no cordis imports).
//
// Discipline (matches this project's agent_adapter rules):
//   * READ-ONLY over the project: this module never writes into
//     51_one_click_end_to_end/**, agent_adapter/workspace/** or any phase dir;
//     its only writes are its own cache under <pluginRoot>/.cache.
//   * Every engineering number the UI shows is produced by the project's own
//     tools: persisted pipeline artifacts are read verbatim, and the canonical
//     result + deterministic render block come from
//     `python -m agent_adapter.cli canonical-result` (the project's own adapter
//     CLI), never from a re-implementation here.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const CORE_FILES = [
  'FINAL_STATUS.json', 'ENGINEERING_QC.json', 'JOINT_CALIBRATION.json',
  'RECOMMENDATION_RESULT.json', 'GEOMETRY.json', 'GEOMETRY_SNAPSHOT.json',
  'CANONICAL_GEOMETRY.json', 'CURRENT_DESIGN.json', 'CHARGE_RECOMMENDATION.json',
  'CHARGE_STRUCTURE.json', 'INPUT.json', 'ERROR_REPORT.json',
]
export const AUX_JSON = ['3D_GEOMETRY_QC', '3D_CHARGE_MAPPING', 'HOLE_3D_SCHEDULE']

const CONTENT_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.dxf': 'application/dxf',
}
const KIND_BY_SUFFIX = {
  '.png': 'figure', '.jpg': 'figure', '.jpeg': 'figure', '.webp': 'figure',
  '.svg': 'vector', '.pdf': 'document', '.dxf': 'cad',
  '.csv': 'table', '.xlsx': 'table', '.md': 'report', '.json': 'data',
  '.txt': 'text',
}

export function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

export function isFile(p) {
  try { return fs.statSync(p).isFile() } catch { return false }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8')
  fs.renameSync(tmp, file)
}

function taskStamp(taskId) {
  // T20260917_221003_AGENT_DEMO_1_axv0 -> 20260917_221003 (sortable)
  const m = /^T(\d{8}_\d{6})/.exec(String(taskId || ''))
  return m ? m[1] : ''
}

/** Per-task artifacts inside a real output package, verbatim from disk. */
export function listArtifacts(packageDir) {
  if (!isDir(packageDir)) return []
  const rows = []
  for (const name of fs.readdirSync(packageDir).sort()) {
    const p = path.join(packageDir, name)
    let st
    try { st = fs.statSync(p) } catch { continue }
    if (!st.isFile()) continue
    const ext = path.extname(name).toLowerCase()
    rows.push({
      name,
      kind: KIND_BY_SUFFIX[ext] || 'other',
      bytes: st.size,
      mtime: st.mtime.toISOString(),
    })
  }
  return rows
}

export function createCaseStore(options) {
  const repoRoot = path.resolve(options.repoRoot)
  const pluginRoot = path.resolve(options.pluginRoot)
  const cacheDir = options.cacheDir || path.join(pluginRoot, '.cache')
  const workspace = path.join(repoRoot, 'agent_adapter', 'workspace')
  const tasksDir = path.join(workspace, 'tasks')
  const ledgerPath = path.join(workspace, 'index.json')
  const logsDir = path.join(workspace, 'logs')
  const venvPython = options.pythonExe || path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
  const blastCmd = path.join(repoRoot, 'agent_adapter', 'blast.cmd')
  const cliTimeoutMs = Number(options.cliTimeoutMs || 240000)
  const canonicalTtlMs = Number(options.canonicalTtlMs || 5 * 60 * 1000)
  const validateTtlMs = Number(options.validateTtlMs || 10 * 60 * 1000)
  const logger = options.logger || { info() {}, warn() {}, error() {} }
  const inflight = new Map()

  fs.mkdirSync(cacheDir, { recursive: true })

  const cachePath = (kind, taskId) =>
    path.join(cacheDir, `${kind}-${String(taskId).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)

  function readCache(kind, taskId) {
    const file = cachePath(kind, taskId)
    const payload = readJson(file)
    if (!payload || !payload.value) return null
    let ageMs = Number.POSITIVE_INFINITY
    try { ageMs = Date.now() - fs.statSync(file).mtimeMs } catch { /* stays infinite */ }
    return { file, payload, ageMs }
  }

  function writeCache(kind, taskId, value, extra) {
    const file = cachePath(kind, taskId)
    try {
      writeJsonAtomic(file, { computed_at: new Date().toISOString(), ...(extra || {}), value })
    } catch (err) {
      logger.warn(`blast-engineering-ui: cache write failed (${file}): ${err}`)
    }
    return file
  }

  /** Run the project's own adapter CLI; stdout is exactly one JSON object. */
  function runCli(args) {
    return new Promise((resolve, reject) => {
      const usingPython = isFile(venvPython)
      const command = usingPython ? venvPython : 'cmd.exe'
      const argv = usingPython
        ? ['-m', 'agent_adapter.cli', ...args]
        : ['/d', '/s', '/c', blastCmd, ...args]
      const started = Date.now()
      let child
      try {
        child = spawn(command, argv, {
          cwd: repoRoot,
          windowsHide: true,
          env: { ...process.env, PYTHONPATH: repoRoot, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        })
      } catch (err) {
        reject(new Error(`adapter CLI could not start: ${err.message}`))
        return
      }
      let out = ''
      let errOut = ''
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        reject(new Error(`adapter CLI timeout after ${cliTimeoutMs} ms: ${args.join(' ')}`))
      }, cliTimeoutMs)
      child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
      child.stderr.on('data', (chunk) => { errOut += chunk.toString('utf8') })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`adapter CLI spawn error: ${error.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const text = out.trim()
        if (text === '') {
          reject(new Error(`adapter CLI produced no stdout (exit ${code}): ${errOut.slice(-400)}`))
          return
        }
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch (error) {
          reject(new Error(`adapter CLI stdout was not one JSON object (exit ${code}): ${error.message}`))
          return
        }
        resolve({
          envelope: parsed,
          exit_code: code,
          stderr_tail: errOut.slice(-1500),
          elapsed_s: Math.round((Date.now() - started) / 100) / 10,
          via: usingPython ? 'python -m agent_adapter.cli' : 'agent_adapter/blast.cmd',
        })
      })
    })
  }

  /** Mirrors agent_adapter.taskstore.package_dir (recorded path, single subdir, else output). */
  function packageDirOf(taskDir, status) {
    const recorded = status && status.package_dir
    if (recorded && isDir(recorded)) return recorded
    const base = path.join(taskDir, 'output')
    if (isDir(base)) {
      const subs = fs.readdirSync(base).filter((name) => isDir(path.join(base, name)))
      if (subs.length === 1) return path.join(base, subs[0])
    }
    return base
  }

  function readTaskRow(taskId) {
    const taskDir = path.join(tasksDir, taskId)
    if (!isDir(taskDir)) return null
    const status = readJson(path.join(taskDir, 'STATUS.json')) || {}
    const request = readJson(path.join(taskDir, 'REQUEST.json')) || {}
    const input = readJson(path.join(taskDir, 'INPUT.json')) || {}
    const persistedCanonical = readJson(path.join(taskDir, 'CANONICAL_RESULT.json'))
    const canonical = persistedCanonical && persistedCanonical.identity ? persistedCanonical : null
    const packageDir = packageDirOf(taskDir, status)
    const finalStatus = readJson(path.join(packageDir, 'FINAL_STATUS.json'))
    const detail = (finalStatus && finalStatus.detail) || {}
    const artifacts = listArtifacts(packageDir)
    const diameter = input.shaft_diameter_m
    return {
      task_id: taskId,
      case_id: (canonical && canonical.identity && canonical.identity.case_id)
        || (finalStatus && finalStatus.case_id)
        || input.case_id || status.case_id || null,
      phase: status.phase || null,
      parent_task_id: status.parent_task_id
        || (canonical && canonical.identity && canonical.identity.parent_task_id) || null,
      updated_at: status.updated_at || null,
      elapsed_s: status.elapsed_s === undefined ? null : status.elapsed_s,
      note: status.note === undefined ? null : status.note,
      stamp: taskStamp(taskId),
      short_id: String(taskId).slice(-4),
      task_dir: taskDir,
      package_dir: packageDir,
      input_normalized: input,
      request,
      diameter_m: diameter === undefined ? null : diameter,
      depth_m: input.shaft_depth_m === undefined ? null : input.shaft_depth_m,
      final_status: (finalStatus && finalStatus.status) || null,
      final_status_reason: detail.reason || null,
      review_required: detail.review_required === undefined ? null : detail.review_required,
      confidence: (canonical && canonical.confidence && canonical.confidence.overall)
        || detail.confidence || null,
      canonical_persisted: Boolean(canonical),
      artifacts,
      artifact_count: artifacts.length,
      core_files_present: CORE_FILES.filter((name) => isFile(path.join(packageDir, name))),
    }
  }

  function allTaskIds() {
    if (!isDir(tasksDir)) return []
    return fs.readdirSync(tasksDir)
      .filter((name) => isDir(path.join(tasksDir, name)))
      .sort()
      .reverse()
  }

  function ledger() {
    const index = readJson(ledgerPath) || {}
    const rows = Array.isArray(index.tasks) ? index.tasks : []
    const byId = new Map()
    for (const row of rows) if (row && row.task_id) byId.set(row.task_id, row)
    return byId
  }

  function manifest() {
    const byId = ledger()
    const rows = []
    for (const taskId of allTaskIds()) {
      const row = readTaskRow(taskId)
      if (!row) continue
      const led = byId.get(taskId) || {}
      if (led.note && !row.note) row.note = led.note
      if (led.updated_at && !row.updated_at) row.updated_at = led.updated_at
      if (led.parent_task_id && !row.parent_task_id) row.parent_task_id = led.parent_task_id
      // A Design Version is a real run that produced a real output package.
      if (row.artifact_count === 0) continue
      rows.push(row)
    }
    rows.sort((a, b) => String(b.stamp).localeCompare(String(a.stamp))
      || String(b.task_id).localeCompare(String(a.task_id)))

    const byCase = new Map()
    for (const row of rows) {
      const caseId = row.case_id || '(unknown)'
      if (!byCase.has(caseId)) byCase.set(caseId, [])
      byCase.get(caseId).push(row)
    }
    const cases = []
    for (const [caseId, versions] of byCase) {
      // One PRIMARY Design Version per (case, diameter): the newest real run.
      const seenDiameters = new Set()
      for (const v of versions) {
        const key = String(v.diameter_m)
        v.primary = !seenDiameters.has(key)
        seenDiameters.add(key)
        v.superseded = !v.primary
      }
      cases.push({
        case_id: caseId,
        version_count: versions.length,
        primary_count: versions.filter((v) => v.primary).length,
        latest_stamp: versions[0] ? versions[0].stamp : null,
        latest_status: versions[0] ? versions[0].final_status : null,
        diameters: [...new Set(versions.map((v) => v.diameter_m)
          .filter((d) => d !== null && d !== undefined))].sort((a, b) => a - b),
        versions,
      })
    }
    cases.sort((a, b) => String(b.latest_stamp).localeCompare(String(a.latest_stamp)))
    const focus = cases.findIndex((c) => c.case_id === 'AGENT_DEMO_1')
    if (focus > 0) cases.unshift(cases.splice(focus, 1)[0])

    return {
      generated_at: new Date().toISOString(),
      project: {
        id: 'blast-parameter-reextract',
        name: '立井钻爆智能参数推荐与炮孔设计',
        root: repoRoot,
        workspace,
        task_ledger: ledgerPath,
        version_count: rows.length,
        case_count: cases.length,
      },
      cases,
      focus_case: cases.length > 0 ? cases[0].case_id : null,
    }
  }

  function findTaskInManifest(taskId) {
    for (const cs of manifest().cases) {
      for (const v of cs.versions) if (v.task_id === taskId) return { case: cs, version: v }
    }
    return null
  }

  async function canonicalFor(taskId, { refresh = false } = {}) {
    if (!refresh) {
      const cached = readCache('canonical', taskId)
      if (cached && cached.ageMs < canonicalTtlMs) {
        return {
          canonical: cached.payload.value.canonical,
          render: cached.payload.value.render,
          artifacts: cached.payload.value.artifacts || [],
          meta: {
            source: 'cache',
            computed_at: cached.payload.computed_at,
            cache_file: cached.file,
            age_s: Math.round(cached.ageMs / 1000),
          },
        }
      }
    }
    const key = `canonical:${taskId}`
    if (inflight.has(key)) return inflight.get(key)
    const job = (async () => {
      const result = await runCli(['canonical-result', '--task-id', taskId])
      const envelope = result.envelope
      if (!envelope.success) {
        throw new Error((envelope.error && envelope.error.message) || 'canonical-result failed')
      }
      const value = {
        canonical: envelope.results.canonical,
        render: envelope.results.render,
        artifacts: envelope.artifacts || [],
      }
      const file = writeCache('canonical', taskId, value, {
        tool: 'canonical-result',
        task_id: taskId,
        case_id: envelope.case_id,
        elapsed_s: result.elapsed_s,
        via: result.via,
        exit_code: result.exit_code,
        stderr_tail: result.stderr_tail,
      })
      return {
        canonical: value.canonical,
        render: value.render,
        artifacts: value.artifacts,
        meta: {
          source: 'adapter-cli',
          tool: envelope.tool,
          computed_at: new Date().toISOString(),
          elapsed_s: result.elapsed_s,
          via: result.via,
          exit_code: result.exit_code,
          cache_file: file,
          stderr_tail: result.stderr_tail,
        },
      }
    })().finally(() => inflight.delete(key))
    inflight.set(key, job)
    return job
  }

  async function validationFor(taskId, { refresh = false } = {}) {
    if (!refresh) {
      const cached = readCache('validate', taskId)
      if (cached && cached.ageMs < validateTtlMs) {
        const value = cached.payload.value
        return {
          ...value,
          meta: {
            ...(value.meta || {}),
            source: 'cache',
            computed_at: cached.payload.computed_at,
            age_s: Math.round(cached.ageMs / 1000),
          },
        }
      }
    }
    const key = `validate:${taskId}`
    if (inflight.has(key)) return inflight.get(key)
    const job = (async () => {
      const result = await runCli(['validate-result-consistency', '--task-id', taskId])
      const envelope = result.envelope
      const value = {
        ok: Boolean(envelope.success),
        tool: envelope.tool,
        task_id: envelope.task_id,
        case_id: envelope.case_id,
        status: envelope.status,
        results: envelope.results || {},
        metrics: envelope.metrics || {},
        warnings: envelope.warnings || [],
        error: envelope.error || null,
        meta: {
          source: 'adapter-cli',
          computed_at: new Date().toISOString(),
          elapsed_s: result.elapsed_s,
          via: result.via,
          exit_code: result.exit_code,
          stderr_tail: result.stderr_tail,
        },
      }
      value.meta.cache_file = writeCache('validate', taskId, value, {
        tool: 'validate-result-consistency',
        task_id: taskId,
        elapsed_s: result.elapsed_s,
        via: result.via,
      })
      return value
    })().finally(() => inflight.delete(key))
    inflight.set(key, job)
    return job
  }

  async function version(taskId, { refresh = false } = {}) {
    const row = readTaskRow(taskId)
    if (!row) {
      const error = new Error(`unknown task_id: ${taskId}`)
      error.code = 'UNKNOWN_TASK'
      throw error
    }
    const canonical = await canonicalFor(taskId, { refresh })
    const caseRow = manifest().cases.find((c) => c.case_id === row.case_id)
    const lineage = { parent_task_id: row.parent_task_id || null, parent: null, children: [] }
    if (caseRow) {
      if (row.parent_task_id) {
        const parent = caseRow.versions.find((v) => v.task_id === row.parent_task_id)
        if (parent) {
          lineage.parent = {
            task_id: parent.task_id,
            diameter_m: parent.diameter_m,
            final_status: parent.final_status,
            stamp: parent.stamp,
          }
        }
      }
      lineage.children = caseRow.versions
        .filter((v) => v.parent_task_id === taskId)
        .map((v) => ({
          task_id: v.task_id,
          diameter_m: v.diameter_m,
          final_status: v.final_status,
          stamp: v.stamp,
        }))
    }

    // Raw real files passed through verbatim (small JSON + the markdown report).
    const maxInlineBytes = 512 * 1024
    const files = {}
    for (const name of CORE_FILES) {
      const p = path.join(row.package_dir, name)
      if (isFile(p) && fs.statSync(p).size <= maxInlineBytes) files[name] = readJson(p)
    }
    const dirNames = isDir(row.package_dir) ? fs.readdirSync(row.package_dir) : []
    for (const base of AUX_JSON) {
      for (const name of dirNames.filter((n) => n.startsWith(base) && n.endsWith('.json'))) {
        const p = path.join(row.package_dir, name)
        if (fs.statSync(p).size <= maxInlineBytes) files[name] = readJson(p)
      }
    }
    const reportPath = path.join(row.package_dir, 'ONE_CLICK_REPORT.md')
    const reportMarkdown = isFile(reportPath) ? fs.readFileSync(reportPath, 'utf8') : null

    return {
      ok: true,
      task_id: taskId,
      case_id: row.case_id,
      design_version: {
        label: row.diameter_m === null || row.diameter_m === undefined
          ? 'design version'
          : `${row.diameter_m} m`,
        diameter_m: row.diameter_m,
        depth_m: row.depth_m,
        stamp: row.stamp,
        primary: row.primary !== false,
      },
      row: {
        task_id: row.task_id,
        phase: row.phase,
        updated_at: row.updated_at,
        elapsed_s: row.elapsed_s,
        parent_task_id: row.parent_task_id,
        package_dir: row.package_dir,
        task_dir: row.task_dir,
        core_files_present: row.core_files_present,
      },
      input: { normalized: row.input_normalized, request: row.request },
      canonical: canonical.canonical,
      render: canonical.render,
      artifacts: canonical.artifacts.length > 0
        ? canonical.artifacts
        : row.artifacts.map((a) => ({
          kind: a.kind,
          name: a.name,
          bytes: a.bytes,
          path: path.join(row.package_dir, a.name),
        })),
      files,
      report_markdown: reportMarkdown,
      report_path: isFile(reportPath) ? reportPath : null,
      log: logTail(taskId, 12000),
      lineage,
      canonical_meta: canonical.meta,
    }
  }

  function artifact(taskId, name) {
    const row = readTaskRow(taskId)
    if (!row) return null
    const requested = String(name || '')
    const base = path.basename(requested)
    if (base === '' || base !== requested) return null
    const file = path.join(row.package_dir, base)
    if (!isFile(file)) return null
    const ext = path.extname(base).toLowerCase()
    return {
      file,
      name: base,
      bytes: fs.statSync(file).size,
      contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
    }
  }

  function logTail(taskId, maxBytes = 12000) {
    const file = path.join(logsDir, `${taskId}.log`)
    if (!isFile(file)) return null
    const size = fs.statSync(file).size
    const start = Math.max(0, size - maxBytes)
    const fd = fs.openSync(file, 'r')
    try {
      const length = size - start
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, start)
      return { file, bytes: size, truncated: start > 0, text: buf.toString('utf8') }
    } finally {
      fs.closeSync(fd)
    }
  }

  /**
   * The newest real task of a case — INCLUDING one that is still queued/running
   * and therefore has no output package yet (the Design-Version manifest only
   * lists finished runs). This is what lets the workspace show a live
   * Engineering Trace for a run the agent just started.
   */
  function activity(caseId) {
    const wanted = String(caseId || '')
    let best = null
    for (const taskId of allTaskIds()) {
      const row = readTaskRow(taskId)
      if (!row) continue
      if (wanted && String(row.case_id) !== wanted) continue
      if (!best || String(row.stamp) > String(best.stamp)) best = row
    }
    if (!best) return { ok: true, kind: 'case_activity.v1', case_id: wanted || null, latest: null }
    const status = readJson(path.join(best.task_dir, 'STATUS.json')) || {}
    const provenance = readJson(path.join(best.task_dir, 'RUNTIME_PROVENANCE.json'))
    return {
      ok: true,
      kind: 'case_activity.v1',
      case_id: best.case_id,
      latest: {
        task_id: best.task_id,
        short_id: best.short_id,
        stamp: best.stamp,
        phase: status.phase || best.phase || null,
        stage: status.stage || null,
        reason: status.reason || null,
        running: ['queued', 'running'].includes(status.phase || best.phase),
        elapsed_s: status.elapsed_s === undefined ? best.elapsed_s : status.elapsed_s,
        updated_at: status.updated_at || best.updated_at || null,
        diameter_m: best.diameter_m,
        parent_task_id: best.parent_task_id || null,
        has_package: best.artifact_count > 0,
        runtime_provenance: provenance || null,
      },
    }
  }

  /** The pipeline's own per-stage verdicts, verbatim from the run's result file. */
  function stages(taskId) {
    const row = readTaskRow(taskId)
    if (!row) {
      const error = new Error(`unknown task_id: ${taskId}`)
      error.code = 'UNKNOWN_TASK'
      throw error
    }
    const result = readJson(path.join(row.task_dir, 'AGENT_RESULT.json'))
    const stagesOut = (result && result.stages) || null
    const design = (result && result.charge_recommendation) || null
    const qc = (result && result.engineering_qc) || null
    return {
      ok: Boolean(stagesOut),
      kind: 'pipeline_stages.v1',
      task_id: taskId,
      case_id: row.case_id,
      phase: row.phase,
      stages: stagesOut,
      evidence: {
        charge_method_used: design && design.charge_method_used,
        charge_fallback_triggered: design && design.charge_fallback_triggered,
        joint_calibration: result && result.joint_calibration && result.joint_calibration.status,
        report_file: result && result.report_file ? true : false,
        unified_qc_keys: qc ? Object.keys(qc) : [],
      },
    }
  }

  /** What the Python compute process itself recorded about how it was started. */
  function runtime(taskId) {
    const row = readTaskRow(taskId)
    if (!row) {
      const error = new Error(`unknown task_id: ${taskId}`)
      error.code = 'UNKNOWN_TASK'
      throw error
    }
    return {
      ok: true,
      kind: 'runtime_provenance.v1',
      task_id: taskId,
      provenance: readJson(path.join(row.task_dir, 'RUNTIME_PROVENANCE.json')),
    }
  }

  return {
    repoRoot,
    pluginRoot,
    cacheDir,
    paths: { workspace, tasksDir, ledgerPath, venvPython, blastCmd, logsDir },
    manifest,
    version,
    canonicalFor,
    validationFor,
    artifact,
    logTail,
    activity,
    stages,
    runtime,
    findTaskInManifest,
    readTaskRow,
    runCli,
  }
}





