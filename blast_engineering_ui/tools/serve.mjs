// blast-engineering-ui — standalone dev server for the API (no DSH needed).
//
//   node blast_engineering_ui/tools/serve.mjs [--port 4180] [--repo <repoRoot>]
//
// Useful to (a) verify the API without touching the harness and (b) preview the
// real data payloads with curl. It shares lib/api.mjs with the DSH host row,
// so what it serves is exactly what the plugin serves inside DSH.
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCaseStore } from '../lib/case-store.mjs'
import { createApiHandler, API_PREFIX } from '../lib/api.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const repoRoot = path.resolve(arg('repo', path.resolve(pluginRoot, '..')))
const port = Number(arg('port', 4180))

const store = createCaseStore({ repoRoot, pluginRoot })
const handler = createApiHandler(store, {
  repoRoot,
  logger: console,
  startedAt: new Date(),
})

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(error) }))
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`blast-engineering-ui dev API on http://127.0.0.1:${port}${API_PREFIX}`)
  console.log(`repoRoot = ${repoRoot}`)
  console.log(`try: /manifest · /version?task=<id> · /validate?task=<id> · /artifact?task=<id>&name=FINAL_PLAN.png`)
})
