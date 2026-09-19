// blast-live-voice — BLAST Studio Live Voice 的 product 层（host 面）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 这是「Qwen 实时语音 ↔ 真实工程动作」之间**唯一**的闸门，也是正式集成后
// BLAST Studio 里 Live Voice 的全部服务端面。它复用 POC 已人工验收的同一份实现
// （闸门状态机 / 设计读取 / 适配层调用），只改了挂载方式：
//
//   * 不再为浏览器预绑定工作区与会话 —— Studio 的工作区/会话属于 DSH 自己；
//   * 不再有自己的闸门页 —— Parameter Diff 渲染在 BLAST Studio 对话的 ComposerDock 里；
//   * 多了 `permit`（人在环许可）与 `/permit/check` —— 让 blast_engine.run_analysis
//     在 Live 通话活跃时 fail-closed。
//
// 工程约束（本插件存在的理由）：
//   实时语音模型**绝对不能**直接改变工程方案。它（或交接到的 DSH agent）最多只能
//   "请求"一次参数变更；变更以结构化差异（真实字段名 + 当前设计版本的真实旧值 + 单位）
//   呈现给人，只有人点「创建版本」之后，才由本插件调用项目自己的适配层 CLI
//   （`python -m agent_adapter.cli run-analysis …`）真正开始计算。
//
// 写入面：只写 <repo>/blast_live_voice/runtime（gate 状态 + 运行溯源）。
//   不写任何冻结目录（51_/17_/23_/43_/47_/49_/50_/53_/52_/agent_adapter）。
// ─────────────────────────────────────────────────────────────────────────────
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdapterRunner } from './adapter.mjs'
import { createDesignReader } from './design.mjs'
import { createGateMachine } from './gate.mjs'
import { createHandler, registerRoutes } from './routes.mjs'
import { GATE_PRESET, PREFIX } from './config.mjs'
import { repoRoot as repoRootFromStudio, STUDIO_PRESET_ID } from './studio.mjs'

export const name = 'blast-live-voice'
export const inject = ['webServer']

const here = path.dirname(fileURLToPath(import.meta.url))
export const pluginRoot = path.resolve(here, '..')

export function apply(ctx, config = {}) {
  const repoRoot = path.resolve(
    config.repoRoot || process.env.BLAST_LIVE_VOICE_REPO || repoRootFromStudio,
  )
  const runtimeDir = path.resolve(config.runtimeDir || path.join(pluginRoot, 'runtime'))
  const caseId = String(config.caseId || 'AGENT_DEMO_1')
  const venvPython = config.pythonExe || path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
  const gatePreset = String(config.gatePreset || config.preset || STUDIO_PRESET_ID || GATE_PRESET)
  const log = (level, message) => ctx.logger?.[level]?.(`blast-live-voice: ${message}`)

  const { runAdapter, recordProvenance } = createAdapterRunner({ repoRoot, runtimeDir, venvPython })
  const design = createDesignReader({ runAdapter, caseId })
  const gate = createGateMachine({ runAdapter, readDesign: design.readDesign, runtimeDir, log, recordProvenance })

  const { handle } = createHandler({ design, gate, caseId, repoRoot, gatePreset, log })
  registerRoutes(ctx, handle)

  log('info', `mounted (repo ${repoRoot}, case ${caseId}, preset ${gatePreset}, gate ${gate.current()?.gateId ?? 'none yet'}, api ${PREFIX})`)
}
