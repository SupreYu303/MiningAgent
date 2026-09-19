// blast-engineering-ui — voice script (the ONLY thing the speaker is allowed to read).
//
// The spoken text is assembled exclusively from the deterministic display block the
// project CLI itself produced (`agent_adapter.cli canonical-result` → `value.render`),
// which the browser half already renders in the Overview page:
//
//   render.must_state[]          final status / confidence / review / evidence domain
//   render.core_metrics[]        holes, spacing, q_design, total charge, diameter
//   render.engineering_notices[] key warnings
//
// It never touches developer-facing material (technical trace, raw JSON, tool
// arguments, Think/Pwsh/Read/Write steps, paths, provenance, token accounting):
// there is no code path that can reach them, and `guard.excluded_categories` records
// that fact for the audit trail.
//
// Pure functions only — no fs, no child processes — so the file is unit-testable
// (tools/voice-selftest.mjs) and usable by the DSH host row (lib/api.mjs).

/** Metric labels we are allowed to pronounce, in speaking order. */
const SPOKEN_METRICS = [
  '井筒设计直径（m）',
  '炮孔总数',
  '掏槽孔数',
  '辅助孔数',
  '周边孔数',
  '周边孔距（mm）',
  '推荐总装药量（kg）',
  '单位炸药消耗量（kg/m³）',
]

/** Categories that must never be spoken, recorded for the audit trail. */
const EXCLUDED = [
  'technical trace / Think / Pwsh / Read / Write',
  'raw canonical JSON',
  'tool arguments and tool-call payloads',
  'file paths (output package, cache, logs)',
  'provenance strings and source-file references',
  'token / cost accounting',
]

function metricMap(render) {
  const out = new Map()
  for (const row of (render && render.core_metrics) || []) {
    if (row && typeof row.label_cn === 'string') out.set(row.label_cn, row)
  }
  return out
}

function mustStateMap(render) {
  const out = new Map()
  for (const row of (render && render.must_state) || []) {
    if (row && typeof row.key === 'string') out.set(row.key, row)
  }
  return out
}

/** One spoken clause for a metric, or null when the project did not publish it. */
function metricClause(metrics, label) {
  const row = metrics.get(label)
  if (!row || row.value === null || row.value === undefined || row.value === '') return null
  const value = row.value
  switch (label) {
    case '井筒设计直径（m）': return `井筒设计直径 ${value} 米`
    case '炮孔总数': return `炮孔总数 ${value} 个`
    case '掏槽孔数': return `掏槽孔 ${value} 个`
    case '辅助孔数': return `辅助孔 ${value} 个`
    case '周边孔数': return `周边孔 ${value} 个`
    case '周边孔距（mm）': return `周边孔距 ${value} 毫米`
    case '推荐总装药量（kg）': return `推荐总装药量 ${value} 公斤`
    case '单位炸药消耗量（kg/m³）': return `单位炸药消耗量 ${value} 千克每立方米`
    default: return `${label.replace(/（[^）]*）/, '')} ${value}`
  }
}

/**
 * Build the spoken script for one design version.
 *
 * @param version - the object `store.version(taskId)` returns (canonical + render + row).
 * @returns a plain JSON-serializable script description; `text` is what gets spoken.
 */
export function buildVoiceScript(version) {
  const render = (version && version.render) || {}
  const canonical = (version && version.canonical) || {}
  const metrics = metricMap(render)
  const must = mustStateMap(render)
  const caseId = (version && version.case_id) || (canonical.identity && canonical.identity.case_id) || null
  const taskId = (version && version.task_id) || (canonical.identity && canonical.identity.task_id) || null
  const diameter = version && version.design_version ? version.design_version.diameter_m : null

  const sentences = []
  const spokenMetrics = []

  // 1. identity of the version being spoken about (case + diameter; never a path).
  sentences.push(`${caseId || '当前案例'}${diameter === null || diameter === undefined ? '' : ` ${diameter} 米`}方案。`)

  // 2. core results — what the engineer asks first, then the hole breakdown.
  const pick = (labels) => labels.map((l) => metricClause(metrics, l)).filter(Boolean)
  const core = pick(['炮孔总数', '推荐总装药量（kg）', '单位炸药消耗量（kg/m³）'])
  if (core.length) sentences.push(core.join('，') + '。')
  const holes = pick(['掏槽孔数', '辅助孔数', '周边孔数'])
  if (holes.length) sentences.push(holes.join('，') + '。')
  for (const label of SPOKEN_METRICS) {
    const clause = metricClause(metrics, label)
    if (clause) spokenMetrics.push({ label, value: metrics.get(label).value, clause })
  }

  // 3. final status — the project's own wording, unchanged.
  const status = must.get('status')
  if (status) sentences.push(`最终状态：${status.text_cn || status.value}。`)
  const confidence = must.get('confidence')
  if (confidence) sentences.push(`${confidence.text_cn || confidence.value}。`)

  // 4. key warnings (count + the first one) and the review requirement.
  const notices = (render.engineering_notices || []).filter((n) => n && (n.text_cn || n.text))
  if (notices.length) {
    sentences.push(`工程提示 ${notices.length} 条，首要一条：${notices[0].text_cn || notices[0].text}。`)
  }
  const review = must.get('review_required')
  if (review) {
    sentences.push(review.value === true || review.value === 'true'
      ? '需要人工复核后采用。'
      : '无需人工复核。')
  }

  const text = sentences.join('')

  return {
    ok: true,
    kind: 'voice_script.v1',
    case_id: caseId,
    task_id: taskId,
    diameter_m: diameter === undefined ? null : diameter,
    final_status: canonical.status ? canonical.status.final : null,
    text,
    chars: text.length,
    sentences,
    spoken_metrics: spokenMetrics,
    guard: {
      metrics_included: spokenMetrics.map((m) => m.label),
      metrics_available: [...metrics.keys()],
      notices_included: notices.length ? 1 : 0,
      notices_available: notices.length,
      excluded_categories: EXCLUDED,
      contains_path_like: /[A-Za-z]:\\|\/agent_adapter\/|workspace\/tasks/.test(text),
      contains_raw_json: text.includes('{') || text.includes('"'),
      within_cap: text.length <= 1000,
    },
    sources: {
      status: 'canonical-result → render.must_state.status',
      confidence: 'canonical-result → render.must_state.confidence',
      review_required: 'canonical-result → render.must_state.review_required',
      metrics: 'canonical-result → render.core_metrics[].label_cn/value',
      warnings: 'canonical-result → render.engineering_notices[].text_cn',
    },
  }
}

/**
 * Current value of a parameter, taken from the canonical result, for the §8
 * high-impact confirmation line (`5 m → 5.5 m`) — never guessed by the client.
 */
export function buildImpactDiff(version, requestedDiameter) {
  const metrics = metricMap((version && version.render) || {})
  const current = metrics.get('井筒设计直径（m）')
  return {
    parameter: 'shaft_diameter_m',
    label: '井筒直径',
    from: current ? current.value : null,
    to: requestedDiameter === undefined ? null : requestedDiameter,
    source: 'canonical-result → render.core_metrics["井筒设计直径（m）"]',
  }
}
