// blast-live-voice — the Parameter Diff / Action Gate state machine.
//
// 与已验收的 `blast_live_poc/plugin/lib/gate.mjs` 是同一份实现，正式集成只**加**了
// 一样东西（没有任何语义放宽）：`confirm()` 会同时写下一条「人在场许可」（permit），
// 让 `blast_engine.run_analysis` 能在 Live 通话活跃时 fail-closed：
// 只有人工点过【创建版本】的那一次差异（parameter + to + parentTaskId）才被允许执行。
//
// 关键不变量：
//   * `requestChange()` 只会**创建**闸门（pending），永远不执行；
//   * `confirm()` 是唯一执行入口，只由 HTTP 路由 `/gate/confirm`（人工点击）调用；
//   * 差异里的旧值一定来自当前设计版本的**真实输入**；取不到就拒绝创建闸门；
//   * permit 只在人工确认时产生，15 分钟内绑定那一条差异，未确认时 `run_analysis`
//     在 Live 通话中一律拒绝。
import fs from 'node:fs'
import path from 'node:path'
import { PARAMETERS, parseEnvelope, nowIso, metricValue, METRIC_LABELS } from './config.mjs'

export function createGateMachine({ runAdapter, readDesign, runtimeDir, log, recordProvenance }) {
  const gateFile = path.join(runtimeDir, 'gate.json')
  /** 人工确认后的许可有效期：够一次真实计算（约 45~180 s）与随后的复核。 */
  const PERMIT_TTL_MS = 15 * 60 * 1000
  /**
   * Live 通话在场状态（由浏览器端上报、落在自己的 runtime 目录里）。
   * 为什么不用 host 侧 HTTP 去问实时语音插件：DSH Desktop 的 web 服务只接受带
   * renderer token 的请求（`dsh-plugin-desktop/DesktopWebServer.permits`），
   * loopback 裸请求一律 403；因此在场状态由能到达该路由的渲染进程上报，
   * 再以**文件**形式供 agent 面的互锁读取（同机同进程假设之外也能工作）。
   */
  const presenceFile = path.join(runtimeDir, 'voice.json')
  const PRESENCE_TTL_MS = 45 * 1000

  function loadPresence() {
    try { return JSON.parse(fs.readFileSync(presenceFile, 'utf8')) } catch { return null }
  }
  function notePresence({ active, phase }) {
    const record = { active: Boolean(active), phase: phase ? String(phase).slice(0, 40) : null, at: nowIso() }
    try {
      fs.mkdirSync(runtimeDir, { recursive: true })
      fs.writeFileSync(presenceFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    } catch (error) { log?.('warn', `cannot persist voice presence: ${error.message}`) }
    return record
  }
  /** 新鲜度：超过 45 s 没有下一次上报就当作"不在通话中"（浏览器关掉也不会一直挡着）。 */
  function voicePresence() {
    const record = loadPresence()
    if (!record) return { active: false, phase: null, at: null, fresh: false }
    const fresh = Date.now() - Date.parse(record.at) < PRESENCE_TTL_MS
    return { active: fresh ? Boolean(record.active) : false, phase: record.phase ?? null, at: record.at, fresh }
  }

  function load() {
    try { return JSON.parse(fs.readFileSync(gateFile, 'utf8')) } catch { return null }
  }
  function save(next) {
    try {
      fs.mkdirSync(runtimeDir, { recursive: true })
      fs.writeFileSync(gateFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    } catch (error) { log?.('warn', `cannot persist gate: ${error.message}`) }
  }

  let gate = load()
  let lastPoll = 0

  function view() {
    if (!gate) return null
    return {
      gateId: gate.gateId,
      parameter: gate.parameter,
      labelCn: gate.labelCn,
      unit: gate.unit,
      from: gate.from,
      to: gate.to,
      intent: gate.intent,
      status: gate.status,
      createdAt: gate.createdAt,
      confirmedAt: gate.confirmedAt ?? null,
      parentTaskId: gate.parentTaskId,
      taskId: gate.taskId ?? null,
      phase: gate.phase ?? null,
      elapsedS: gate.elapsedS ?? null,
      result: gate.result ?? null,
      designAtOpen: gate.designAtOpen ?? null,
      note: gate.note ?? null,
      /** 人工确认后产生的人在环许可（未确认时恒为 null）。 */
      permit: gate.permit ?? null,
    }
  }

  async function requestChange({ parameter, value, intent }) {
    const meta = PARAMETERS[parameter]
    if (!meta) return { ok: false, reason: 'unknown-parameter', summary: `未知参数 ${parameter}：闸门只接受项目输入契约里的参数。` }
    if (!Number.isFinite(Number(value))) return { ok: false, reason: 'invalid-value', summary: '请求的新值不是数字：闸门未创建。' }
    const design = await readDesign({ force: true })
    if (!design.ok) return { ok: false, reason: 'design-unavailable', summary: '读不到当前设计版本的真实输入：闸门未创建（不猜值）。' }
    const from = design.inputs[parameter]
    if (typeof from !== 'number') return { ok: false, reason: 'no-current-value', summary: `当前设计版本没有 ${parameter} 的真实值：闸门未创建。` }
    const to = Number(value)
    if (from === to) return { ok: false, reason: 'no-change', summary: `${parameter} 当前就是 ${from}${meta.unit}：没有需要确认的变更。` }
    const stamp = nowIso().replace(/[-:.TZ]/g, '').slice(0, 14)
    gate = {
      gateId: `G${stamp}`,
      parameter,
      labelCn: meta.labelCn,
      unit: meta.unit,
      from,
      to,
      intent: String(intent || '').slice(0, 500),
      status: 'pending',
      createdAt: nowIso(),
      parentTaskId: design.taskId,
      caseId: design.caseId,
      designAtOpen: {
        taskId: design.taskId,
        designStatus: design.designStatus,
        designStatusCn: design.designStatusCn,
        holes_total: metricValue(design, METRIC_LABELS.holes),
        total_charge_kg: metricValue(design, METRIC_LABELS.charge),
      },
    }
    save(gate)
    recordProvenance?.({ at: nowIso(), tool: 'gate-request', gateId: gate.gateId, parameter, from, to, intent: gate.intent, source: design.source })
    log?.('info', `gate ${gate.gateId} opened: ${parameter} ${from} -> ${to} (awaiting human confirmation)`)
    return { ok: true, gate: view() }
  }

  function cancel(reason = 'user-cancelled') {
    if (!gate) return { ok: false, reason: 'no-gate' }
    if (['queued', 'running'].includes(gate.status)) {
      return { ok: false, reason: 'already-running', summary: '闸门已确认并开始计算：取消只影响"未确认"的变更，正在跑的真实任务不会被撤销。' }
    }
    gate = { ...gate, status: 'cancelled', cancelledAt: nowIso(), note: reason, permit: null }
    save(gate)
    recordProvenance?.({ at: nowIso(), tool: 'gate-cancel', gateId: gate.gateId, reason })
    log?.('info', `gate ${gate.gateId} cancelled (${reason})`)
    return { ok: true, gate: view() }
  }

  /** 人工确认后**唯一**的执行入口。 */
  async function confirm() {
    if (!gate) return { ok: false, reason: 'no-gate' }
    if (gate.status !== 'pending') return { ok: false, reason: 'not-pending', status: gate.status, gate: view() }
    const design = await readDesign({ taskId: gate.parentTaskId, force: true })
    const payload = { case_id: gate.caseId }
    for (const [key, value] of Object.entries(design.inputs ?? {})) if (typeof value === 'number') payload[key] = value
    payload[gate.parameter] = gate.to
    // 人在环许可：只有走到这里（人工点击 /gate/confirm）才会有 permit。
    // blast_engine.run_analysis 在 Live 通话活跃时会拿它做 fail-closed 校验。
    const permit = {
      permitId: `P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      gateId: gate.gateId,
      parameter: gate.parameter,
      to: gate.to,
      parentTaskId: gate.parentTaskId,
      caseId: gate.caseId,
      issuedAt: nowIso(),
      expiresAt: new Date(Date.now() + PERMIT_TTL_MS).toISOString(),
      source: 'human-click:/gate/confirm',
      uses: 0,
    }
    gate = { ...gate, status: 'running', confirmedAt: nowIso(), permit }
    save(gate)
    recordProvenance?.({ at: nowIso(), tool: 'gate-confirm', gateId: gate.gateId, payload, parentTaskId: gate.parentTaskId })
    try {
      const result = await runAdapter(
        ['run-analysis', '--input-json', JSON.stringify(payload), '--parent-task-id', gate.parentTaskId],
        { timeoutMs: 240000, detail: 'gate-confirm:run-analysis' },
      )
      const envelope = parseEnvelope(result.out)
      gate = {
        ...gate,
        status: 'queued',
        taskId: envelope?.task_id ?? null,
        phase: envelope?.status ?? 'queued',
        adapterMs: result.ms,
        exitCode: result.code,
        stderrTail: result.err ? result.err.slice(-800) : null,
      }
      save(gate)
      log?.('info', `gate ${gate.gateId} confirmed -> task ${gate.taskId} (real pipeline running in background)`)
      void poll({ force: true })
      return { ok: true, gate: view() }
    } catch (error) {
      gate = { ...gate, status: 'failed', note: `run-analysis spawn failed: ${error.message}` }
      save(gate)
      return { ok: false, reason: 'spawn-failed', summary: error.message, gate: view() }
    }
  }

  async function poll({ force = false } = {}) {
    if (!gate?.taskId || !['queued', 'running'].includes(gate.status)) return
    if (!force && Date.now() - lastPoll < 2500) return
    lastPoll = Date.now()
    try {
      const status = await runAdapter(['task-status', '--task-id', gate.taskId], { timeoutMs: 60000, detail: 'gate:task-status' })
      const results = parseEnvelope(status.out)?.results ?? {}
      const phase = results.phase ?? gate.phase
      const next = { ...gate, phase, elapsedS: results.elapsed_s ?? gate.elapsedS }
      if (phase === 'done' || phase === 'failed') {
        const canonical = await runAdapter(['canonical-result', '--task-id', gate.taskId], { timeoutMs: 120000, detail: 'gate:result' })
        const envelope = parseEnvelope(canonical.out)
        next.status = phase === 'done' ? 'done' : 'failed'
        next.finishedAt = nowIso()
        next.result = {
          ok: Boolean(envelope?.success !== false),
          taskId: gate.taskId,
          designStatus: envelope?.results?.canonical?.status?.final ?? null,
          designStatusCn: envelope?.results?.canonical?.status?.final_cn ?? null,
          designStatusReasonCn: envelope?.results?.canonical?.status?.reason_cn ?? null,
          values: {},
        }
        for (const row of envelope?.results?.render?.core_metrics ?? []) {
          if (row?.label_cn) next.result.values[row.label_cn] = row.value
        }
        next.result.values[gate.parameter] = envelope?.results?.canonical?.input?.normalized?.[gate.parameter] ?? null
      }
      gate = next
      save(gate)
    } catch { /* a transient status failure must not corrupt the gate */ }
  }

  /**
   * 人在环许可校验 —— `blast_engine.run_analysis` 在 Live 通话活跃时用它做 fail-closed。
   * 只认人工确认过的那一条差异：parameter + to + parentTaskId 必须逐字一致且在有效期内；
   * 没有许可 / 已取消 / 过期 / 差异不一致 → 一律拒绝执行，并给出「请人工确认」的原话。
   */
  function checkPermit({ parameter, to, parentTaskId } = {}) {
    const permit = gate?.permit
    if (!permit) {
      return {
        ok: false, reason: 'no-permit', permit: null,
        summary: '当前没有人工确认过的人在环许可：Live 通话进行中，实时语音不能直接执行工程计算。请先在对话中确认参数变更（[创建版本]）。',
      }
    }
    if (Date.parse(permit.expiresAt) <= Date.now()) {
      return { ok: false, reason: 'permit-expired', permit, summary: '上次人工确认已超过有效期（15 分钟）：请重新确认。' }
    }
    if (String(permit.parameter) !== String(parameter) || Number(permit.to) !== Number(to)) {
      return {
        ok: false, reason: 'permit-mismatch', permit,
        summary: `人工确认的是 ${permit.parameter} → ${permit.to}，与本次请求（${parameter} → ${to}）不一致：拒绝执行。`,
      }
    }
    if (String(permit.parentTaskId) !== String(parentTaskId)) {
      return {
        ok: false, reason: 'permit-parent-mismatch', permit,
        summary: `人工确认针对父版本 ${permit.parentTaskId}，与本次请求的 ${parentTaskId} 不一致：拒绝执行。`,
      }
    }
    gate = { ...gate, permit: { ...permit, uses: (permit.uses ?? 0) + 1, lastUsedAt: nowIso() } }
    save(gate)
    return { ok: true, reason: 'human-confirmed', permit: gate.permit, summary: '本次变更已由人工确认（闸门「创建版本」）。' }
  }

  function current() { return view() }
  function designAtOpen() { return gate?.designAtOpen ?? null }

  return { requestChange, cancel, confirm, poll, current, designAtOpen, checkPermit,
    notePresence, voicePresence, file: gateFile, presenceFile }
}
