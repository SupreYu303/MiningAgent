// deploy-studio-live.mjs — 把 Live Voice（Qwen Audio Realtime Plus）以**最小 diff**
// 合入正式 BLAST Studio（DSH Desktop 的 profile），不碰 DSH Core、不碰 app.asar、
// 不碰任何冻结生产目录。
//
//   node blast_live_voice/scripts/deploy-studio-live.mjs --status
//   node blast_live_voice/scripts/deploy-studio-live.mjs --install
//   node blast_live_voice/scripts/deploy-studio-live.mjs --uninstall
//
// 它只写这些地方（全部在 DSH home 内）：
//   1. <DSH_HOME>/profiles/node_modules/<pkg>               两个 junction（共享解析面）
//   2. <DSH_HOME>/profiles/<PROFILE_ID>/node_modules/<pkg>  两个 junction（profile 解析面）
//   3. <DSH_HOME>/profiles/<PROFILE_ID>/cordis.patch.yml    一段**带标记**的托管块
//      （旧文件先备份为 cordis.patch.yml.bak-live-voice-<stamp>）
//
// PROFILE_ID 只有一个来源：lib/studio.mjs（POC 时代 process/display/profile id 混用的
// 教训 —— 本脚本不接受任何手写的 profile 名，只用那个常量）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIVE_PACKAGE_NAME, REALTIME_PACKAGE_NAME, STUDIO_PRESET_ID, STUDIO_PROFILE_ID,
  packageRoot, profilePaths, realtimePackageDir, repoRoot, runtimeDir, studioHome,
} from '../lib/studio.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const argValue = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}
const caseId = argValue('case', 'AGENT_DEMO_1')
const mode = flag('status') ? 'status' : flag('uninstall') ? 'uninstall' : 'install'
const paths = profilePaths(STUDIO_PROFILE_ID)

const BEGIN = '# >>> BLAST Studio Live Voice (managed by blast_live_voice/scripts/deploy-studio-live.mjs)'
const END = '# <<< BLAST Studio Live Voice (managed) <<<'
const toPosix = (value) => value.split(path.sep).join('/')

function profilePatchBlock() {
  return [
    BEGIN,
    '# 两行：实时语音 provider（第三方，未改动）与它在本项目里的 product 层。',
    '- insert:',
    '    - id: realtime-voice',
    `      name: '${REALTIME_PACKAGE_NAME}'`,
    '      inject: [webServer, apiProxy, credentials, agents, systemPrompt, tools]',
    `    - id: ${LIVE_PACKAGE_NAME}`,
    `      name: '${LIVE_PACKAGE_NAME}'`,
    '',
    `- id: ${LIVE_PACKAGE_NAME}`,
    '  config:',
    `    repoRoot: '${toPosix(repoRoot)}'`,
    `    runtimeDir: '${toPosix(runtimeDir)}'`,
    `    caseId: '${caseId}'`,
    `    gatePreset: '${STUDIO_PRESET_ID}'`,
    END,
  ].join('\n')
}

function stripManaged(text) {
  const lines = text.split(/\r?\n/)
  const kept = []
  let inside = false
  for (const line of lines) {
    if (line.trim() === BEGIN) { inside = true; continue }
    if (inside && line.trim() === END) { inside = false; continue }
    if (!inside) kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n')
}

function linkDir(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath)
    const current = stat.isSymbolicLink() ? fs.readlinkSync(linkPath) : null
    if (current && path.resolve(current) === path.resolve(target)) return 'already-linked'
    return 'present-not-ours'
  }
  fs.symlinkSync(target, linkPath, 'junction')
  return 'linked'
}

const presetAssembly = path.join(paths.presetDir, 'agent.cordis.yml')

function describe() {
  const patch = fs.existsSync(paths.patch) ? fs.readFileSync(paths.patch, 'utf8') : ''
  const nodeModules = [
    path.join(paths.sharedNodeModules, LIVE_PACKAGE_NAME),
    path.join(paths.sharedNodeModules, REALTIME_PACKAGE_NAME),
    path.join(paths.nodeModules, LIVE_PACKAGE_NAME),
    path.join(paths.nodeModules, REALTIME_PACKAGE_NAME),
  ]
  return {
    profile_id: STUDIO_PROFILE_ID,
    preset_id: STUDIO_PRESET_ID,
    dsh_home: studioHome,
    profile_dir: paths.dir,
    profile_dir_present: fs.existsSync(paths.dir),
    patch_file: paths.patch,
    patch_has_blast_engineering_ui: patch.includes('blast-engineering-ui'),
    patch_has_live_block: patch.includes(BEGIN),
    live_package_dir: packageRoot,
    realtime_package_dir: realtimePackageDir,
    realtime_package_present: fs.existsSync(path.join(realtimePackageDir, 'lib', 'index.js')),
    node_modules: nodeModules.map((p) => ({ path: p, present: fs.existsSync(p) })),
    preset_dir: paths.presetDir,
    preset_has_live_row: fs.existsSync(presetAssembly)
      && fs.readFileSync(presetAssembly, 'utf8').includes("'blast-live-voice/agent-tools'"),
  }
}

const out = (line) => console.log(line)
void here

switch (mode) {
  case 'status':
    out(JSON.stringify(describe(), null, 2))
    break

  case 'install': {
    if (!fs.existsSync(paths.dir)) {
      out(`profile not found: ${paths.dir}（PROFILE_ID=${STUDIO_PROFILE_ID}，来源 lib/studio.mjs）`)
      process.exitCode = 2
      break
    }
    if (!fs.existsSync(path.join(realtimePackageDir, 'lib', 'index.js'))) {
      out(`realtime package missing: ${realtimePackageDir}`)
      process.exitCode = 3
      break
    }
    const links = [
      [realtimePackageDir, path.join(paths.sharedNodeModules, REALTIME_PACKAGE_NAME)],
      [packageRoot, path.join(paths.sharedNodeModules, LIVE_PACKAGE_NAME)],
      [realtimePackageDir, path.join(paths.nodeModules, REALTIME_PACKAGE_NAME)],
      [packageRoot, path.join(paths.nodeModules, LIVE_PACKAGE_NAME)],
    ]
    for (const [target, linkPath] of links) {
      const result = linkDir(target, linkPath)
      out(`${result.padEnd(18)} ${linkPath}`)
      if (result === 'present-not-ours') out(`  ! ${linkPath} 已存在且不是我们建立的 junction —— 未改动它`)
    }
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    const current = fs.existsSync(paths.patch)
      ? fs.readFileSync(paths.patch, 'utf8')
      : '# created by deploy-studio-live.mjs\n[]\n'
    if (fs.existsSync(paths.patch)) {
      fs.copyFileSync(paths.patch, `${paths.patch}.bak-live-voice-${stamp}`)
      out(`patch backup: ${paths.patch}.bak-live-voice-${stamp}`)
    }
    const base = stripManaged(current)
    const separator = base.endsWith('\n') ? '\n' : '\n\n'
    fs.writeFileSync(paths.patch, `${base}${separator}${profilePatchBlock()}\n`, 'utf8')
    out(`profile patch written: ${paths.patch} (profile=${STUDIO_PROFILE_ID})`)
    out('下一步：')
    out('  node blast_live_voice/scripts/deploy-studio-live.mjs --status')
    out('  node blast_engineering_ui/tools/install-demo-profile.mjs --install   # 刷新 blast-demo（含 Live 闸门工具行）')
    out('  powershell -File blast_live_voice/scripts/start-studio.ps1 -Restart  # 冷启动并自检')
    break
  }

  case 'uninstall': {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    if (fs.existsSync(paths.patch)) {
      const current = fs.readFileSync(paths.patch, 'utf8')
      fs.copyFileSync(paths.patch, `${paths.patch}.bak-live-voice-uninstall-${stamp}`)
      fs.writeFileSync(paths.patch, stripManaged(current), 'utf8')
      out(`managed block removed from ${paths.patch} (backup: .bak-live-voice-uninstall-${stamp})`)
    }
    for (const linkPath of [
      path.join(paths.sharedNodeModules, LIVE_PACKAGE_NAME),
      path.join(paths.nodeModules, LIVE_PACKAGE_NAME),
    ]) {
      if (fs.existsSync(linkPath)) { fs.rmSync(linkPath, { recursive: true, force: true }); out(`removed ${linkPath}`) }
    }
    out('note: 实时语音 provider 的 junction 未删除（它由首次安装建立；需要时手动删除）')
    break
  }

  default:
    out('unknown mode')
    process.exitCode = 2
}
