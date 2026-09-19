// blast-engineering-ui — node half (the DSH host row).
//
// This is the host face of a DSH "dual-face" row: applying it registers one
// prefix route on the harness webServer that serves the real project data
// (manifest / version / validate / artifact), and contributes one index
// injection row that publishes the absolute API base URL to the browser half.
//
// It touches no DSH core file and no project production directory: the only
// writes are the plugin's own cache under <pluginRoot>/.cache.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCaseStore } from './case-store.mjs'
import { createApiHandler, API_PREFIX } from './api.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
/** <repo>/blast_engineering_ui (the package root); <repo> is its parent. */
export const pluginRoot = path.resolve(here, '..')

export const name = 'blast-engineering-ui'
export const inject = ['webServer']

function resolveRepoRoot(config) {
  const fromEnv = process.env.BLAST_ENGINEERING_UI_REPO
  if (config && config.repoRoot) return path.resolve(config.repoRoot)
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(pluginRoot, '..')
}

export function apply(ctx, config = {}) {
  const repoRoot = resolveRepoRoot(config)
  const startedAt = new Date()
  const store = createCaseStore({
    repoRoot,
    pluginRoot,
    cacheDir: config.cacheDir,
    pythonExe: config.pythonExe,
    logger: {
      info: (message) => ctx.logger?.info?.(message),
      warn: (message) => ctx.logger?.warn?.(message),
      error: (message) => ctx.logger?.error?.(message),
    },
  })
  const handler = createApiHandler(store, { repoRoot, logger: ctx.logger, startedAt })

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
    'blast-engineering-ui: case API route',
  )

  // Publish the absolute base URL for the browser half: the served index page
  // also carries it, which keeps a file:// loaded renderer able to reach the API.
  ctx.on('webserver/index-inject', (table) => {
    const host = ctx.webServer.host === '0.0.0.0' ? '127.0.0.1' : ctx.webServer.host
    const base = `http://${host}:${ctx.webServer.port}${API_PREFIX}`
    table.push({ kind: 'global', name: '__BLAST_ENGINEERING_API__', value: base })
    table.push({
      kind: 'global',
      name: '__BLAST_ENGINEERING_CONTEXT__',
      value: {
        plugin: 'blast-engineering-ui',
        repo_root: repoRoot,
        workspace: store.paths.workspace,
        task_ledger: store.paths.ledgerPath,
      },
    })
  })

  ctx.logger?.info?.(`blast-engineering-ui: case API mounted on ${API_PREFIX} (repo ${repoRoot})`)
}
