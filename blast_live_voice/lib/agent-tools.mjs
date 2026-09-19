// blast-live-voice/agent-tools — the agent-plane face (mounted by the BLAST Studio preset).
//
// 与 `blast_live_poc/plugin/lib/agent-tools.mjs` 是同一份实现（同一套工具语义、
// 同一套 loopback HTTP 通道），正式集成只改了包名与基址来源。
//
//   * 工具在这里**不持有任何闸门状态**：它只把请求转给 host 面的 loopback HTTP
//     接口，因此两个面之间没有共享内存假设。
//   * 三个工具没有一个是"执行工程计算"的：读当前设计 / 请求闸门 / 看闸门状态。
//     工程计算只能由人在对话里点「创建版本」触发（host 面的唯一执行入口）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { gateBaseUrl } from './studio.mjs'

export const name = 'blast-live-voice-tools'
export const inject = ['tools', 'systemPrompt']

const PARAMETERS = ['shaft_diameter_m', 'shaft_depth_m', 'protodyakonov_f', 'planned_advance_mm', 'borehole_diameter_mm', 'borehole_depth_mm']
const METRIC = { holes: '炮孔总数', charge: '推荐总装药量（kg）', spacing: '周边孔距（mm）', diameter: '井筒设计直径（m）' }

async function callGate(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  try { return JSON.parse(text) } catch { return { ok: false, error: `gate API returned non-JSON (${response.status})` } }
}

export function apply(ctx, config = {}) {
  const baseUrl = String(config.gateBaseUrl || process.env.BLAST_LIVE_VOICE_GATE_URL || gateBaseUrl()).replace(/\/+$/, '')

  ctx.tools.register(defineTool({
    name: 'blast_live_design_read',
    description: [
      'Read the CURRENT real design of this case (read-only).',
      'Values come from the project adapter CLI (canonical-result of the newest finished task): the normalized inputs of that design version plus the canonical display metrics.',
      'Use this whenever the user asks what the current design is. Never restate a number you did not read here.',
    ].join(' '),
    parameters: {
      task_id: { type: 'string', description: '指定任务号（默认取最新的已完成任务）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          summary: { type: 'string', required: true },
          design_json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.summary}\n\n${value.design_json}` }],
    },
    async execute() {
      const data = await callGate(baseUrl, '/design')
      const d = data?.design ?? {}
      if (!d.ok) {
        return { ok: false, summary: `当前设计读取失败（${d.reason || 'unknown'}）：不猜任何数值。`, design_json: JSON.stringify(d) }
      }
      const v = d.values
      const text = `当前设计（案例 ${d.caseId} / 任务 ${d.taskId} / phase ${d.phase}）：`
        + `井筒直径 ${v.shaft_diameter_m} m，井筒深度 ${v.shaft_depth_m} m，f=${v.protodyakonov_f}，`
        + `计划进尺 ${v.planned_advance_mm} mm，炮孔直径 ${v.borehole_diameter_mm} mm，炮孔深度 ${v.borehole_depth_mm} mm；`
        + `炮孔总数 ${v.holes_total}，周边孔距 ${v.peripheral_spacing_mm} mm，推荐总装药量 ${v.total_charge_kg} kg；`
        + `设计状态 ${d.designStatusCn || d.designStatus || '—'}。`
      return { ok: true, summary: text, design_json: JSON.stringify(d) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'blast_live_gate_request',
    description: [
      'Request a parameter change. This DOES NOT execute anything.',
      'It opens a structured Parameter Diff / Action Gate for a human to confirm; only a human click on 创建版本 starts the real computation.',
      'Call this for every spoken engineering change (e.g. 把井筒直径改成 5.5 米) instead of trying to run the pipeline.',
      'After calling it, tell the user the Parameter Diff is waiting in the conversation; never claim the design has changed.',
    ].join(' '),
    parameters: {
      parameter: { type: 'string', required: true, enum: PARAMETERS, description: '项目输入契约里的字段名（例如 shaft_diameter_m）。' },
      value: { type: 'number', required: true, description: '请求的新值（单位与字段一致）。' },
      intent: { type: 'string', required: true, description: '用户原话/意图，用于闸门记录（最多 500 字）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          status: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          gate_id: { type: 'string', required: true },
          gate_json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args = {}) {
      const result = await callGate(baseUrl, '/gate/request', {
        method: 'POST',
        body: JSON.stringify({ parameter: args.parameter, value: Number(args.value), intent: args.intent, source: 'voice' }),
      })
      if (!result?.ok) {
        return {
          ok: false, status: 'rejected', gate_id: '',
          summary: `闸门未创建：${result?.summary ?? result?.reason ?? result?.error ?? 'unknown'}`,
          gate_json: JSON.stringify(result),
        }
      }
      const g = result.gate
      const summary = `已打开参数确认闸门 ${g.gateId}：${g.parameter}  ${g.from} ${g.unit} → ${g.to} ${g.unit}`
        + `（旧值来自当前设计版本 ${g.parentTaskId} 的真实输入）。`
        + '注意：这**还没有执行**——请让用户在对话里点「创建版本」，点了之后才会开始真实计算。'
      return { ok: true, status: g.status, summary, gate_id: g.gateId, gate_json: JSON.stringify(g) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'blast_live_gate_status',
    description: [
      'Read the state of the parameter gate, and of the real run that a human confirmation started.',
      'Use it to answer 确认了没有 / 算完了吗 / 结果是多少 — the numbers come from the real canonical result of the confirmed run.',
    ].join(' '),
    parameters: {
      gate_id: { type: 'string', description: '闸门 id（省略则返回最近一次闸门）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          status: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          gate_json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute() {
      const data = await callGate(baseUrl, '/state')
      const g = data?.gate
      if (!g) return { ok: false, status: 'none', summary: '当前没有闸门记录。', gate_json: '{}' }
      let summary
      if (g.status === 'pending') {
        summary = `闸门 ${g.gateId} 仍在等待人工确认：${g.parameter} ${g.from} ${g.unit} → ${g.to} ${g.unit}。未确认前不会执行。`
      } else if (g.status === 'cancelled') {
        summary = `闸门 ${g.gateId} 已被用户取消：${g.parameter} 保持 ${g.from} ${g.unit}，方案未变。`
      } else if (g.status === 'done') {
        const values = g.result?.values ?? {}
        summary = `闸门 ${g.gateId} 已确认并计算完成：任务 ${g.result?.taskId}；`
          + `井筒直径 ${values[METRIC.diameter] ?? '—'} m，炮孔总数 ${values[METRIC.holes] ?? '—'}，`
          + `周边孔距 ${values[METRIC.spacing] ?? '—'} mm，推荐总装药量 ${values[METRIC.charge] ?? '—'} kg；`
          + `设计状态 ${g.result?.designStatusCn || g.result?.designStatus || '—'}。`
      } else {
        summary = `闸门 ${g.gateId} 已确认，真实计算进行中：任务 ${g.taskId || '—'}，phase ${g.phase || '—'}（${g.elapsedS ?? '—'}s）。`
      }
      return { ok: true, status: g.status, summary, gate_json: JSON.stringify(g) }
    },
  }))

  ctx.systemPrompt.section({
    name: 'tool:blast-live-voice-gate',
    order: 208,
    text: [
      'This is the BLAST Studio Live Voice session: the user talks to you through a realtime voice call and your replies are spoken back.',
      'HARD RULE: a realtime voice request never changes the design by itself. For any spoken parameter change you must call `blast_live_gate_request`;',
      'the change is then shown to the human as a structured Parameter Diff in this conversation, and only a human click on 创建版本 starts the real computation.',
      'While a live call is active the engineering pipeline refuses to run without that human confirmation, so never try to run it yourself and never claim a change happened.',
      'Never estimate or invent a number. Current design values come from `blast_live_design_read`; gate state and finished-run numbers come from `blast_live_gate_status`.',
      'Answer in short spoken sentences.',
    ].join(' '),
  })

  ctx.logger?.info?.(`blast-live-voice-tools: mounted (gate API ${baseUrl})`)
}
