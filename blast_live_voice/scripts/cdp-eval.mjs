// cdp-eval.mjs — 在 BLAST Studio 的渲染进程里跑一段表达式（只读调试用）。
//
//   node blast_live_voice/scripts/cdp-eval.mjs "document.title"
//   node blast_live_voice/scripts/cdp-eval.mjs --cdp 9223 "fetch('/blast-live-voice/live').then(r=>r.text())"
//
// 为什么需要它：DSH Desktop 的 web 服务只服务自己的渲染进程（403 于裸 loopback），
// 所以任何对插件路由的调试都必须在渲染进程里做。
import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const at = argv.indexOf('--cdp')
const cdpPort = at >= 0 ? Number(argv[at + 1]) : 9223
const shotAt = argv.indexOf('--screenshot')
const shotPath = shotAt >= 0 ? argv[shotAt + 1] : null
const skip = new Set()
if (at >= 0) { skip.add(at); skip.add(at + 1) }
if (shotAt >= 0) { skip.add(shotAt); skip.add(shotAt + 1) }
const expression = argv.filter((_, index) => !skip.has(index)).join(' ')
if (!expression && !shotPath) {
  console.log('usage: node cdp-eval.mjs [--cdp 9223] [--screenshot out.png] "<expression>"')
  process.exit(2)
}

const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && String(t.url).startsWith('http://127.0.0.1'))
if (!page) {
  console.log('no page target')
  process.exit(3)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
const result = await new Promise((resolve, reject) => {
  socket.addEventListener('open', () => {
    if (shotPath && !expression) {
      socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
      return
    }
    socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }))
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== 1) return
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })
  socket.addEventListener('error', (error) => reject(new Error(String(error.message ?? error))))
  setTimeout(() => reject(new Error('timeout')), 30000)
})
socket.close()

if (shotPath) {
  const data = result?.data
  if (!data) {
    console.log('no screenshot data')
    process.exit(4)
  }
  writeFileSync(shotPath, Buffer.from(data, 'base64'))
  console.log(`screenshot written: ${shotPath} (${Buffer.from(data, 'base64').length} bytes)`)
}
if (!expression) process.exit(0)

if (result.exceptionDetails) {
  console.log('EXCEPTION:', result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
} else {
  console.log(typeof result.result.value === 'string' ? result.result.value : JSON.stringify(result.result.value, null, 2))
}
void readFileSync
