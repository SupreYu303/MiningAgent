// blast-engineering-ui — HTTP surface over the real project data.
//
// The handler is deliberately dependency-free (pure node:http) so it can be
// unit-tested with `serve.mjs` outside DSH; the plugin's host half only wires
// it onto the harness `webServer` route table.
import fs from 'node:fs'
import path from 'node:path'
import { buildVoiceScript, buildImpactDiff } from './voice-script.mjs'

export const API_PREFIX = '/blast-engineering-api'

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function sendFile(res, file, contentType) {
  const stat = fs.statSync(file)
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': stat.size,
    'cache-control': 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
}

/**
 * Build the request handler for the plugin's API.
 * @param store - createCaseStore(...) product.
 * @param options - { repoRoot, logger, startedAt }
 * @returns an async (req, res) handler.
 */
export function createApiHandler(store, options = {}) {
  const logger = options.logger || { warn() {}, error() {} }
  const startedAt = options.startedAt || new Date()
  let requestCount = 0

  const routes = {
    async health() {
      return {
        ok: true,
        plugin: 'blast-engineering-ui',
        version: '0.3.0-voicefirst',
        repo_root: store.repoRoot,
        workspace: store.paths.workspace,
        task_ledger: store.paths.ledgerPath,
        adapter_python: store.paths.venvPython,
        adapter_cmd: store.paths.blastCmd,
        cache_dir: store.cacheDir,
        started_at: startedAt.toISOString(),
        requests: requestCount,
      }
    },
    async manifest() {
      return store.manifest()
    },
    async version(params) {
      const taskId = params.get('task')
      if (!taskId) return { __status: 400, ok: false, error: 'missing ?task=' }
      return store.version(taskId, { refresh: params.get('refresh') === '1' })
    },
    async validate(params) {
      const taskId = params.get('task')
      if (!taskId) return { __status: 400, ok: false, error: 'missing ?task=' }
      const result = await store.validationFor(taskId, { refresh: params.get('refresh') === '1' })
      return result
    },
    /**
     * The spoken script for one design version. Assembled by lib/voice-script.mjs from
     * `render.must_state` / `render.core_metrics` / `render.engineering_notices` only —
     * the project's own computed values, verbatim. Nothing developer-facing is included.
     */
    async voice(params) {
      const taskId = params.get('task')
      if (!taskId) return { __status: 400, ok: false, error: 'missing ?task=' }
      const version = await store.version(taskId, { refresh: params.get('refresh') === '1' })
      return buildVoiceScript(version)
    },
    /** Current value of the parameter a high-impact voice request would change. */
    async diff(params) {
      const taskId = params.get('task')
      if (!taskId) return { __status: 400, ok: false, error: 'missing ?task=' }
      const to = params.get('to')
      const version = await store.version(taskId)
      return { ok: true, kind: 'voice_impact_diff.v1', ...buildImpactDiff(version, to === null ? undefined : Number(to)) }
    },
    /** Newest real task of a case, INCLUDING one that is still running. */
    async activity(params) {
      return store.activity(params.get('case'))
    },
    /** The pipeline's own per-stage verdicts for one run (Engineering Trace). */
    async stages(params) {
      const taskId = params.get('task')
      if (!taskId) return { __status: 400, ok: false, error: 'missing ?task=' }
      return store.stages(taskId)
    },
    /** What the Python compute process recorded about its own runtime. */
    async runtime(params) {
      const taskId = params.get('task')
      if (!taskId) return { __status: 400, ok: false, error: 'missing ?task=' }
      return store.runtime(taskId)
    },
  }

  return async function handler(req, res) {
    requestCount += 1
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad url' })
      return
    }
    const rest = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '')
    const [name, ...tail] = rest.split('/')

    try {
      if (name === 'artifact') {
        const task = url.searchParams.get('task')
        const fileName = url.searchParams.get('name')
        const resolved = task && fileName ? store.artifact(task, fileName) : null
        if (!resolved) {
          sendJson(res, 404, { ok: false, error: `artifact not found: ${fileName}` })
          return
        }
        sendFile(res, resolved.file, resolved.contentType)
        return
      }
      const route = routes[name]
      if (typeof route !== 'function') {
        sendJson(res, 404, { ok: false, error: `unknown endpoint: ${name || '(root)'}`, endpoints: Object.keys(routes).concat('artifact') })
        return
      }
      const body = await route(url.searchParams)
      const status = body && body.__status ? body.__status : 200
      if (body && body.__status) delete body.__status
      sendJson(res, status, body)
      return
    } catch (error) {
      const code = error && error.code === 'UNKNOWN_TASK' ? 404 : 500
      logger.warn?.(`blast-engineering-ui: ${url.pathname} failed: ${error && error.message}`)
      sendJson(res, code, {
        ok: false,
        error: (error && error.message) || String(error),
        endpoint: path.posix.join(API_PREFIX, rest),
      })
    }
  }
}
