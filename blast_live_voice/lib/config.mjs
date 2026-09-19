// blast-live-voice — shared constants and small helpers.
//
// 这一份是从已人工验收的 `blast_live_poc/plugin/lib/config.mjs` 原样搬过来的通用部分
// （参数契约 / 指标标签 / 信封解析 / 时间戳 / 指标取值），只把 prefix 换成正式集成的
// `/blast-live-voice`，并补上 Live 相位词汇。同一逻辑没有第二种实现。

/** 允许通过闸门修改的工程参数（= 项目自己的输入契约字段名）。 */
export const PARAMETERS = {
  shaft_diameter_m: { labelCn: '井筒设计直径', unit: 'm' },
  shaft_depth_m: { labelCn: '井筒深度', unit: 'm' },
  protodyakonov_f: { labelCn: '普氏坚固性系数 f', unit: '' },
  planned_advance_mm: { labelCn: '计划进尺', unit: 'mm' },
  borehole_diameter_mm: { labelCn: '炮孔直径', unit: 'mm' },
  borehole_depth_mm: { labelCn: '炮孔深度', unit: 'mm' },
}

/** 展示指标的真实来源：canonical-result 的 render.core_metrics labels。 */
export const METRIC_LABELS = {
  holes: '炮孔总数',
  charge: '推荐总装药量（kg）',
  spacing: '周边孔距（mm）',
  diameter: '井筒设计直径（m）',
}

export const PREFIX = '/blast-live-voice'

/**
 * 语音交接会话的 preset（POC 时代用的「无执行面」会话）。
 * 正式集成后语音与文字共用同一个 BLAST Studio 会话，因此这个常量只保留给
 * POC 兼容与自检引用；Studio 侧的安全性由 `run_analysis` 的人在环互锁承担。
 */
export const GATE_PRESET = 'blast-live-gate'

/** 实时语音插件（第三方，未改动）自己发布的占用/相位状态路由。 */
export const REALTIME_STATUS_PATH = '/plugins/realtime-voice/v1/status'

/** 语音协议标识（与实时语音插件一致）。 */
export const VOICE_PROTOCOL = 'dsh.voice.v1'

/**
 * Composer 附近要显示的**轻量** Live 相位词汇（正式集成 UI 的唯一来源）。
 * key 就是实时语音插件自己发布的 client 相位（`data-phase`），UI 不自己造说法。
 */
export const LIVE_PHASE_TEXT = {
  idle: '',
  'requesting-permission': '正在连接…',
  connecting: '正在连接…',
  reconnecting: '正在连接…',
  listening: '● 正在聆听',
  thinking: 'BLAST Studio 正在回应',
  'agent-working': 'BLAST Studio 正在回应',
  speaking: 'BLAST Studio 正在回应',
  ending: '',
  error: '实时语音不可用',
}

/** 「正在回应」的三个相位（自检与 UI 断言共用）。 */
export const LIVE_SPEAKING_PHASES = ['thinking', 'agent-working', 'speaking']

/** 「正在聆听」的两个相位（用户说话也算聆听）。 */
export const LIVE_LISTENING_PHASES = ['listening']

/** 适配层 CLI 的 JSON 信封解析：stdout 可能带前置噪声，取第一个 `{`。 */
export function parseEnvelope(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '')
  const at = raw.indexOf('{')
  if (at < 0) return null
  try { return JSON.parse(raw.slice(at)) } catch { return null }
}

export function nowIso() { return new Date().toISOString() }

export function metricValue(design, labelCn) {
  const row = (design?.metrics ?? []).find((m) => m && m.label_cn === labelCn)
  return row ? row.value : null
}
