// blast-live-voice/lib/studio.mjs — **Profile ID 的唯一来源**（正式集成的冷启动修复）。
//
// POC 阶段出现过 process name / display name / profile id 三者混用（启动脚本误用
// `blast-live-poc`、实际 profile 却是 `blast-live-poc-qwen`）。正式集成的纪律是：
// 任何脚本、文档、自检都**不许**再写字面量，只能从这里 import。
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** `blast_live_voice` 包根（<repo>/blast_live_voice）。 */
export const packageRoot = path.resolve(here, '..')
/** 本仓库根（<repo>）；可用 BLAST_ENGINEERING_UI_REPO 覆盖。 */
export const repoRoot = process.env.BLAST_ENGINEERING_UI_REPO
  ? path.resolve(process.env.BLAST_ENGINEERING_UI_REPO)
  : path.resolve(packageRoot, '..')

/** 正式 BLAST Studio = DSH Desktop 的 `desktop` profile（唯一显式来源）。 */
export const STUDIO_PROFILE_ID = 'desktop'
/** 正式会话 preset：`blast-demo`（展示名「BLAST Studio」）。 */
export const STUDIO_PRESET_ID = 'blast-demo'
/** 正式 DSH home。 */
export const studioHome = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
/** 正式 profile 目录。 */
export const studioProfileDir = path.join(studioHome, 'profiles', STUDIO_PROFILE_ID)
/** profile 的共享 node_modules（任何一个 profile 都能解析到这些包）。 */
export const sharedNodeModules = path.join(studioHome, 'profiles', 'node_modules')

/** 本包（host 面 + agent 面）。 */
export const LIVE_PACKAGE_NAME = 'blast-live-voice'
/** 已验收的实时语音 provider 插件（第三方，不改动）。 */
export const REALTIME_PACKAGE_NAME = '@harness-remote/dsh-realtime-voice'
/** 已验收的实时语音 provider 的本地包目录（POC 安装时的同一份 tgz 解包结果）。 */
export const realtimePackageDir = path.join(
  repoRoot, 'blast_live_poc', 'vendor', 'repo-inspect', 'package',
)
/** 冻结资产：Conversation-Native UI 插件（只加 seat 内容，不改结构）。 */
export const UI_PACKAGE_NAME = 'blast-engineering-ui'

/** Live 运行产物（闸门状态 / 溯源）；只写这里。 */
export const runtimeDir = path.join(packageRoot, 'runtime')

/** 正式 Studio 的 web 端口（DSH Desktop 2.0.3 实测为 43120）。 */
export const STUDIO_WEB_PORT = Number(process.env.BLAST_STUDIO_PORT || 43120)

/** host-agent 两面之间的 loopback 基址（agent 面工具 → host 面闸门）。 */
export function gateBaseUrl() {
  return process.env.BLAST_LIVE_VOICE_GATE_URL
    || `http://127.0.0.1:${STUDIO_WEB_PORT}${'/blast-live-voice'}`
}

/** 一切 profile 相关的路径都从这里派生，脚本不再各自拼字符串。 */
export function profilePaths(profileId = STUDIO_PROFILE_ID) {
  const dir = path.join(studioHome, 'profiles', profileId)
  return {
    profileId,
    home: studioHome,
    dir,
    packageJson: path.join(dir, 'package.json'),
    patch: path.join(dir, 'cordis.patch.yml'),
    nodeModules: path.join(dir, 'node_modules'),
    sharedNodeModules,
    presetDir: path.join(studioHome, '.agent-presets', STUDIO_PRESET_ID),
  }
}
