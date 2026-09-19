// blast-live-voice — read the CURRENT real design (read-only, 与 POC 同一份实现)。
//
// 旧值不来自页面、不来自模型记忆，只来自项目自己算出来的结果：
//   list-tasks       → 该案例最新的已完成任务
//   canonical-result → canonical.input.normalized（= 当前版本 INPUT.json）
//                      canonical.status.final（设计状态）
//                      render.core_metrics（展示指标）
import { parseEnvelope, metricValue, nowIso, METRIC_LABELS } from './config.mjs'

export function createDesignReader({ runAdapter, caseId }) {
  let cache = { at: 0, value: null }

  async function readDesign({ taskId = '', force = false } = {}) {
    if (!taskId && !force && cache.value && Date.now() - cache.at < 15000) return cache.value
    const list = await runAdapter(['list-tasks'], { timeoutMs: 90000, detail: 'design:list-tasks' })
    const tasks = parseEnvelope(list.out)?.results?.tasks ?? []
    const chosen = taskId
      ? { task_id: taskId }
      : (tasks.find((t) => t.case_id === caseId && t.phase === 'done')
        ?? tasks.find((t) => t.case_id === caseId)
        ?? tasks[0])
    if (!chosen?.task_id) {
      return { ok: false, reason: 'no-task', tasks: tasks.length, source: 'agent_adapter list-tasks' }
    }
    const canonical = await runAdapter(['canonical-result', '--task-id', chosen.task_id], {
      timeoutMs: 120000, detail: 'design:canonical-result',
    })
    const block = parseEnvelope(canonical.out)?.results?.canonical ?? {}
    const inputs = {}
    for (const [key, value] of Object.entries(block?.input?.normalized ?? {})) {
      if (typeof value === 'number' || typeof value === 'string') inputs[key] = value
    }
    const value = {
      ok: true,
      caseId: inputs.case_id ?? chosen.case_id ?? caseId,
      taskId: chosen.task_id,
      phase: chosen.phase ?? null,
      parentTaskId: chosen.parent_task_id ?? null,
      designStatus: block?.status?.final ?? null,
      designStatusCn: block?.status?.final_cn ?? null,
      reviewRequired: Boolean(block?.status?.review_required ?? block?.review?.required ?? false),
      inputs,
      units: block?.input?._units ?? block?.input?.units ?? {},
      metrics: parseEnvelope(canonical.out)?.results?.render?.core_metrics ?? [],
      source: 'agent_adapter CLI: list-tasks + canonical-result',
      readAt: nowIso(),
    }
    if (!taskId) cache = { at: Date.now(), value }
    return value
  }

  function summarize(design) {
    if (!design?.ok) return { ok: false, reason: design?.reason ?? 'unavailable' }
    return {
      ok: true,
      caseId: design.caseId,
      taskId: design.taskId,
      phase: design.phase,
      designStatus: design.designStatus,
      designStatusCn: design.designStatusCn,
      reviewRequired: design.reviewRequired,
      values: {
        shaft_diameter_m: design.inputs.shaft_diameter_m ?? null,
        shaft_depth_m: design.inputs.shaft_depth_m ?? null,
        protodyakonov_f: design.inputs.protodyakonov_f ?? null,
        planned_advance_mm: design.inputs.planned_advance_mm ?? null,
        borehole_diameter_mm: design.inputs.borehole_diameter_mm ?? null,
        borehole_depth_mm: design.inputs.borehole_depth_mm ?? null,
        holes_total: metricValue(design, METRIC_LABELS.holes),
        total_charge_kg: metricValue(design, METRIC_LABELS.charge),
        peripheral_spacing_mm: metricValue(design, METRIC_LABELS.spacing),
      },
      source: design.source,
      readAt: design.readAt,
    }
  }

  function cached() { return cache.value }

  return { readDesign, summarize, cached }
}
