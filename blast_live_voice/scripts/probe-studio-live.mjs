// probe-studio-live.mjs — BLAST Studio Live Voice 的**机器可验证**验收（真渲染进程，CDP）。
//
//   node blast_live_voice/scripts/probe-studio-live.mjs [--cdp 9223] [--timeout 30000]
//
// 它验证的是「不依赖人嘴」的部分：
//   ① 实时语音控件真的出现在 Composer（conversation.input.right 座位）
//   ② 工程侧的状态条/闸门座位已挂载（blast-engineering-ui 的 Live 面）
//   ③ /blast-live-voice/live 在渲染进程里可达（Desktop 只服务自己的渲染进程）
//   ④ 语音意图 → Parameter Diff：开闸门只产生 pending，**task_id 为空**
//   ⑤ 差异里的旧值来自真实 canonical-result（不是页面估算）
//   ⑥ 未人工确认时 /permit/check 一律拒绝（no-execution-before-confirmation）
//   ⑦ 取消闸门不产生任何任务
//
// 明确**不由本脚本**断言（必须人工对着麦克风）：中文语音质量、连续对话听感、
// barge-in 的实际听感延迟。这些在 docs/LIVE_VOICE_PRODUCTION_ACCEPTANCE.md 里
// 列为人工项，脚本不会假装通过。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}
const cdpPort = Number(arg('cdp', '9223'))
const timeoutMs = Number(arg('timeout', '30000'))
const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const runtimeDir = path.join(pkgRoot, 'runtime')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function findPageTarget() {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      const targets = await response.json()
      const page = targets.find((t) => t.type === 'page' && String(t.url).startsWith('http://127.0.0.1'))
      if (page) return page
    } catch { /* CDP not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return null
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = nextId++
        socket.send(JSON.stringify({ id, method, params }))
        return new Promise((res, rej) => pending.set(id, { res, rej }))
      },
      close() { try { socket.close() } catch { /* ignore */ } },
    }))
    socket.addEventListener('message', (event) => {
      let message = null
      try { message = JSON.parse(String(event.data)) } catch { return }
      const entry = message.id ? pending.get(message.id) : null
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.rej(new Error(message.error.message))
      else entry.res(message.result)
    })
    socket.addEventListener('error', (error) => reject(new Error(`CDP socket error: ${error.message ?? error}`)))
    setTimeout(() => reject(new Error('CDP connect timeout')), 10000)
  })
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

const target = await findPageTarget()
if (!target) {
  check('找到了 BLAST Studio 的渲染进程（CDP）', false, `no page target on 127.0.0.1:${cdpPort}`)
  console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  process.exit(1)
}
check('找到了 BLAST Studio 的渲染进程（CDP）', true, target.url.split('?')[0])

const client = await connect(target.webSocketDebuggerUrl)
try {
  await client.send('Runtime.enable')
  // Cold-start semantics: this probe is meant to run right after a fresh Studio start
  // (start-studio.ps1 -Restart), so the renderer already holds the freshly served
  // bundle. It does NOT reload the app's own window (that aborts the app's navigation).
  const readyDeadline = Date.now() + timeoutMs
  let ready = false
  while (Date.now() < readyDeadline && !ready) {
    try { ready = await evaluate(client, `Boolean(document.querySelector('[data-voice-strip]'))`) } catch { ready = false }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  check('Composer 座位在冷启动后已就绪', ready)

  // The engineering dock seat only exists once a conversation has started (DSH renders
  // `conversation.composer.dock` for a session with content, not for the new-session
  // hero). The documented flow opens an existing engineering conversation first, so the
  // probe does the same: if the seat is absent it starts one turn (`--no-converse` skips).
  let started = await evaluate(client, `Boolean(document.querySelector('[data-slot="conversation.composer.dock"]'))`)
  if (!started && !argv.includes('--no-converse')) {
    await evaluate(client, `(() => {
      const area = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, '你好');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await evaluate(client, `(() => {
      const area = document.querySelector('textarea');
      for (const type of ['keydown', 'keypress', 'keyup']) {
        area.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
      return true;
    })()`)
    const startDeadline = Date.now() + 60000
    while (Date.now() < startDeadline && !started) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      started = await evaluate(client, `Boolean(document.querySelector('[data-slot="conversation.composer.dock"]'))`)
    }
  }
  check('工程会话已开始（对话内工程座位存在）', started)

  // ① 实时语音控件（provider 插件自己的 composer 控件）
  const callButton = await evaluate(client, `(() => {
    const start = document.querySelector('[aria-label="开始实时语音"]');
    const end = document.querySelector('[aria-label="结束实时语音"]');
    const busy = document.querySelector('[aria-label="实时语音已被其他客户端占用"]');
    const node = start || end || busy;
    return { present: Boolean(node), label: node ? node.getAttribute('aria-label') : null };
  })()`)
  check('Composer 里有实时语音控件（📞）', callButton.present, `label=${callButton.label}`)

  // ② 工程侧座位（blast-engineering-ui 的 Live 面）
  const seats = await evaluate(client, `(() => {
    const strip = document.querySelector('[data-voice-strip]');
    const live = document.querySelector('.beu-live');
    return { strip: Boolean(strip), state: strip ? strip.getAttribute('data-state') : null,
      phase: live ? live.getAttribute('data-live-phase') : null };
  })()`)
  check('Composer 语音/状态座位已挂载', seats.strip, `state=${seats.state}`)
  check('未通话时 Live 状态条不占位（相位为空）', seats.phase === null || seats.phase === '', `phase=${seats.phase}`)

  // ③ 工程侧 Live 路由（渲染进程可达）
  const live = await evaluate(client, `fetch('/blast-live-voice/live', { cache: 'no-store' }).then(r => r.json())`)
  check('渲染进程可访问 /blast-live-voice/live', live && live.ok === true,
    `protocol=${live?.voice?.protocol} callActive=${live?.voice?.active}`)
  check('Live 路由声明了唯一执行入口',
    typeof live?.safety?.confirmRoute === 'string' && live.safety.confirmRoute.endsWith('/gate/confirm'),
    live?.safety?.confirmRoute)

  // ④ 语音意图 → Parameter Diff（只产生 pending，不产生任务）
  const state = await evaluate(client, `fetch('/blast-live-voice/state', { cache: 'no-store' }).then(r => r.json())`)
  const current = state?.design?.values?.shaft_diameter_m
  check('当前设计的真实读数可用（canonical-result）', typeof current === 'number',
    `${state?.design?.taskId} shaft_diameter_m=${current}`)

  const requested = await evaluate(client, `fetch('/blast-live-voice/gate/request', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parameter: 'shaft_diameter_m', value: ${Number(current) + 0.5}, intent: 'probe-studio-live', source: 'probe' }),
  }).then(r => r.json())`)
  const gate = requested && requested.gate
  check('开闸门成功且状态为 pending', requested?.ok === true && gate?.status === 'pending', `gate=${gate?.gateId}`)
  check('确认前 task_id 为空（不启动真实计算）', gate?.taskId === null, `taskId=${String(gate?.taskId)}`)
  check('差异旧值 = 当前设计的真实输入', gate?.from === current, `${gate?.from} vs ${current}`)

  // ⑤ 闸门出现在对话里（ComposerDock 的 Live 闸门块）
  await new Promise((resolve) => setTimeout(resolve, 3500))
  const dock = await evaluate(client, `(() => {
    const node = document.querySelector('[data-blast-live-gate]');
    const rows = document.querySelectorAll('[data-blast-live-gate] .beu-diff-row,[data-blast-live-gate] .beu-diff');
    return { present: Boolean(node), status: node ? node.getAttribute('data-blast-live-gate') : null,
      rows: rows.length, hasConfirm: Boolean(document.querySelector('[data-live-gate-action="confirm"]')),
      hasCancel: Boolean(document.querySelector('[data-live-gate-action="cancel"]')),
      text: node ? (node.textContent || '').slice(0, 200) : null };
  })()`)
  check('对话里出现 Parameter Diff 闸门', dock.present && dock.status === 'pending', `status=${dock.status} rows=${dock.rows}`)
  check('闸门提供 [取消] / [创建版本] 两个人工动作', dock.hasCancel && dock.hasConfirm,
    `cancel=${dock.hasCancel} confirm=${dock.hasConfirm} text=${dock.text}`)

  // ⑥ 未确认 → 人在环许可校验必须拒绝（no-execution-before-confirmation）
  const permitDenied = await evaluate(client, `fetch('/blast-live-voice/permit/check', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caller: 'probe', parent_task_id: '${state?.design?.taskId ?? ''}', inputs: { shaft_diameter_m: ${Number(current) + 0.5} } }),
  }).then(async r => ({ status: r.status, body: await r.json() }))`)
  check('未人工确认时 run_analysis 的人在场许可被拒绝',
    permitDenied.status === 403 && permitDenied.body?.ok === false,
    `${permitDenied.status} ${permitDenied.body?.reason}`)

  // ⑦ 取消闸门：方案不变，且没有任何新任务
  const cancelled = await evaluate(client, `fetch('/blast-live-voice/gate/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json())`)
  check('取消闸门成功（方案未改变）', cancelled?.gate?.status === 'cancelled', `status=${cancelled?.gate?.status}`)
  let gateFile = null
  try { gateFile = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'gate.json'), 'utf8')) } catch { gateFile = null }
  check('取消后闸门文件里没有 task_id（未启动计算）', gateFile?.taskId === null || gateFile?.taskId === undefined,
    `taskId=${String(gateFile?.taskId)}`)
} finally {
  client.close()
}

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
const evidence = { at: new Date().toISOString(), cdpPort, results }
fs.mkdirSync(runtimeDir, { recursive: true })
fs.writeFileSync(path.join(runtimeDir, 'probe-studio-live.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = failed.length === 0 ? 0 : 1
