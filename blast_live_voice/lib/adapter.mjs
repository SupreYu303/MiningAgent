// blast-live-voice — the adapter CLI caller (与 POC 同一份实现)。
//
// 与冻结的 blast-engineering-ui/blast-tools.mjs 同一套纪律：把一组**封闭的 argv**
// 直接 spawn（不经任何 shell / 命令解释器），并记录运行溯源。
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { nowIso } from './config.mjs'

export function createAdapterRunner({ repoRoot, runtimeDir, venvPython }) {
  const provenanceFile = path.join(runtimeDir, 'gate_provenance.jsonl')

  function recordProvenance(record) {
    try {
      fs.mkdirSync(runtimeDir, { recursive: true })
      fs.appendFileSync(provenanceFile, `${JSON.stringify(record)}\n`, 'utf8')
    } catch { /* provenance must never break a call */ }
  }

  function computeEnv(detail) {
    return {
      BLAST_AGENT_SINGLE_PROCESS: '1',
      BLAST_AGENT_ORIGIN: 'dsh-blast-studio-live',
      BLAST_AGENT_ORIGIN_DETAIL: detail,
      PYTHONPATH: repoRoot,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    }
  }

  function runAdapter(argv, { timeoutMs = 180000, detail = 'adapter' } = {}) {
    const env = computeEnv(detail)
    const started = Date.now()
    recordProvenance({
      at: nowIso(), argv: ['-m', 'agent_adapter.cli', ...argv],
      cwd: repoRoot, python: venvPython, env,
    })
    return new Promise((resolve, reject) => {
      const child = spawn(venvPython, ['-m', 'agent_adapter.cli', ...argv], {
        cwd: repoRoot, windowsHide: true, env: { ...process.env, ...env },
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        reject(new Error(`adapter CLI timed out after ${timeoutMs} ms: ${argv.join(' ')}`))
      }, timeoutMs)
      child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
      child.stderr.on('data', (chunk) => { err += chunk.toString('utf8') })
      child.on('error', (error) => { clearTimeout(timer); reject(error) })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, out: out.trim(), err: err.trim(), argv, ms: Math.round((Date.now() - started) / 100) / 10 })
      })
    })
  }

  return { runAdapter, recordProvenance, provenanceFile }
}
