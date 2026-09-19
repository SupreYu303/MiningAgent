// blast-live-voice — the human side of the gate (HTTP routes on the Studio webServer).
//
// 与 `blast_live_poc/plugin/lib/routes.mjs` 是同一套路由语义，正式集成去掉两样东西：
//   * **没有闸门页**（HTML）——参数差异直接渲染在 BLAST Studio 的对话里（ComposerDock）；
//   * **没有入口预绑定**——Studio 的工作区/会话由 DSH 自己拥有，插件不碰。
//
// 执行入口只有一处：`POST /blast-live-voice/gate/confirm`（人工点击【创建版本】）。
// `/gate/request` 只创建 pending 闸门；`/permit/check` 只做只读校验，永不执行。
import { PREFIX, nowIso, REALTIME_STATUS_PATH, VOICE_PROTOCOL } from './config.mjs'

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8')
      if (raw.length > 65536) { reject(new Error('request body too large')); req.destroy() }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

export function createHandler({ design, gate, caseId, repoRoot, gatePreset, log }) {
  /** Live 通话在场：渲染进程上报（见 gate.notePresence 的注释）。 */
  function voiceState() {
    const presence = gate.voicePresence()
    return {
      protocol: VOICE_PROTOCOL,
      statusPath: REALTIME_STATUS_PATH,
      reportedBy: 'studio-renderer',
      active: presence.active,
      phase: presence.phase,
      at: presence.at,
      fresh: presence.fresh,
    }
  }

  /** 安全事实（第一屏可见的三条硬约束，self-describing）。 */
  function safety() {
    return {
      rule: '实时语音模型不能直接改变工程方案：变更只能经由人工确认的 Parameter Diff 闸门；确认后由本插件调用项目自己的适配层 CLI 执行。',
      confirmRoute: `${PREFIX}/gate/confirm`,
      permitRoute: `${PREFIX}/permit/check`,
      sessionPreset: gatePreset,
      interlock: 'Live 通话活跃时，blast_engine.run_analysis 必须持有一次性的人在环许可（permit）；无许可一律 fail-closed。',
    }
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const p = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname

      // 轻量：只回闸门 + Live 在场（Composer 附近的状态条每 2 s 轮询这个）。
      if (p === '/live') {
        await gate.poll()
        return sendJson(res, 200, {
          ok: true, at: nowIso(),
          config: { caseId, prefix: PREFIX, preset: gatePreset },
          voice: voiceState(),
          gate: gate.current(),
          safety: safety(),
        })
      }
      // 完整：额外把当前设计版本的真实读数取回来（有 15 s 缓存，不会每次打 CLI）。
      if (p === '/state') {
        await gate.poll()
        const snapshot = design.summarize(design.cached() ?? await design.readDesign())
        return sendJson(res, 200, {
          ok: true, at: nowIso(),
          config: { repoRoot, caseId, prefix: PREFIX, preset: gatePreset },
          design: snapshot,
          voice: voiceState(),
          gate: gate.current(),
          safety: safety(),
        })
      }
      // 渲染进程上报 Live 通话在场（它才是唯一能读到实时插件状态的一侧）。
      if (p === '/voice/presence' && req.method === 'POST') {
        const body = await readBody(req)
        gate.notePresence({ active: body.active, phase: body.phase })
        return sendJson(res, 200, { ok: true, voice: voiceState() })
      }
      if (p === '/design') {
        const snapshot = design.summarize(await design.readDesign({ force: url.searchParams.get('force') === '1' }))
        return sendJson(res, 200, { ok: true, design: snapshot })
      }
      if (p === '/gate/request' && req.method === 'POST') {
        const body = await readBody(req)
        const result = await gate.requestChange({
          parameter: body.parameter,
          value: Number(body.value),
          intent: body.intent ?? `studio (${body.source ?? 'unknown'})`,
        })
        return sendJson(res, result.ok ? 200 : 400, result)
      }
      if (p === '/gate/confirm' && req.method === 'POST') {
        // 唯一执行入口（人工点击【创建版本】）。
        const result = await gate.confirm()
        return sendJson(res, result.ok ? 200 : 409, result)
      }
      if (p === '/gate/cancel' && req.method === 'POST') {
        return sendJson(res, 200, gate.cancel('studio'))
      }
      // 人在环许可校验：只读 + 记一次 uses，不做任何工程计算。
      // 两种入参口径：
      //   * {parameter, to, parentTaskId}          —— 已经是结构化差异；
      //   * {inputs, parentTaskId}                 —— 交付上来的整份输入（多一个都不行）：
      //     由 host 用**父版本的真实输入**自己算差异，再与许可比对。
      if (p === '/permit/check' && req.method === 'POST') {
        const body = await readBody(req)
        let parameter = body.parameter
        let to = body.to
        const parentTaskId = body.parentTaskId || body.parent_task_id || body.task_id || ''
        if (body.inputs && parentTaskId) {
          const parentDesign = await design.readDesign({ taskId: parentTaskId, force: true })
          if (!parentDesign.ok) {
            return sendJson(res, 403, {
              ok: false, reason: 'parent-design-unavailable',
              summary: `读不到父版本 ${parentTaskId} 的真实输入（${parentDesign.reason ?? 'unknown'}）：Live 通话中拒绝执行。`,
            })
          }
          const changed = []
          for (const [key, value] of Object.entries(body.inputs)) {
            if (typeof value !== 'number') continue
            if (typeof parentDesign.inputs[key] === 'number' && parentDesign.inputs[key] !== value) {
              changed.push({ parameter: key, from: parentDesign.inputs[key], to: value })
            }
          }
          if (changed.length !== 1) {
            return sendJson(res, 403, {
              ok: false, reason: changed.length === 0 ? 'no-diff' : 'ambiguous-diff',
              summary: `本次请求相对父版本 ${parentTaskId} 有 ${changed.length} 处变化：Live 通话中只允许逐项人工确认过的单一变更。`,
              changed,
            })
          }
          parameter = changed[0].parameter
          to = changed[0].to
        }
        const result = gate.checkPermit({ parameter, to, parentTaskId })
        if (result.ok) log?.('info', `permit used by ${body.caller ?? 'unknown'} (gate ${result.permit.gateId})`)
        return sendJson(res, result.ok ? 200 : 403, result)
      }
      return sendJson(res, 404, { ok: false, error: `no route ${p}` })
    } catch (error) {
      log?.('error', `route failure: ${error.stack || error.message}`)
      try { sendJson(res, 500, { ok: false, error: error.message }) } catch { /* already sent */ }
    }
  }

  return { handle }
}

export function registerRoutes(ctx, handler) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }),
    'blast-live-voice: gate + live status API (no page of its own)',
  )
}
