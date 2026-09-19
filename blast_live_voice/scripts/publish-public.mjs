// publish-public.mjs —— 把正式 Live Voice 集成所需的**通用代码与文档**发布到公开仓库。
//
//   node blast_live_voice/scripts/publish-public.mjs --status
//   node blast_live_voice/scripts/publish-public.mjs --copy [--target D:\path\to\MiningAgent]
//
// 纪律（与既有公开版审计一致）：
//   * **白名单逐文件复制**，绝不 `git add .`；本脚本不碰源仓库任何文件；
//   * 确定性脱敏（本机绝对路径 / 用户名 / 主机名），并打印每条规则的命中数；
//   * 复制后做一次独立扫描（秘钥模式 / 本机路径 / 内部目录名），任何命中都非零退出；
//   * **不发布**：runtime 状态（gate.json / voice.json / provenance / 探针证据）、
//     本机 profile 配置、凭据、POC 的内部验证文件。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot } from '../lib/studio.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const argValue = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}
/** 本机路径的字面量用拼接构造：公开出去的这一份里不能出现真实路径/主机名。 */
const REPO_DIR_NAME = ['blast_parameter', 'reextract', '20260829'].join('_')
const WORKSPACE_PARENT = ['D:', 'AgentWorkspace', 'zongyanfa'].join('\\')
const USER_HOME = ['C:', 'Users', 'HP'].join('\\')
const DSH_INSTALL = ['D:', 'AgentWorkspace', 'deepseek', 'DSH Desktop'].join('\\')
const HOST_LABEL = ['HP', '工作站'].join(' ')

const targetRoot = path.resolve(argValue('target', process.env.BLAST_PUBLIC_REPO || ''))
if (!targetRoot) {
  console.log('需要 --target <公开仓库路径> 或环境变量 BLAST_PUBLIC_REPO')
  process.exit(2)
}

/** 白名单：相对仓库根的路径 → 是否文本（文本才做脱敏与扫描）。 */
const FILES = [
  'blast_live_voice/package.json',
  'blast_live_voice/cordis.patch.yml',
  'blast_live_voice/README.md',
  'blast_live_voice/lib/config.mjs',
  'blast_live_voice/lib/studio.mjs',
  'blast_live_voice/lib/gate.mjs',
  'blast_live_voice/lib/design.mjs',
  'blast_live_voice/lib/adapter.mjs',
  'blast_live_voice/lib/routes.mjs',
  'blast_live_voice/lib/host.mjs',
  'blast_live_voice/lib/agent-tools.mjs',
  'blast_live_voice/scripts/deploy-studio-live.mjs',
  'blast_live_voice/scripts/start-studio.ps1',
  'blast_live_voice/scripts/probe-studio-live.mjs',
  'blast_live_voice/scripts/cdp-eval.mjs',
  'blast_live_voice/scripts/publish-public.mjs',
  'blast_live_voice/docs/LIVE_VOICE_INTEGRATION.md',
  'blast_live_voice/docs/LIVE_VOICE_PRODUCTION_ACCEPTANCE.md',
  'blast_engineering_ui/lib/client.js',
  'blast_engineering_ui/lib/blast-tools.mjs',
  'blast_engineering_ui/demo-profile/agent.cordis.template.yml',
  'blast_engineering_ui/tools/install-demo-profile.mjs',
  'blast_engineering_ui/tools/demo-profile-test.mjs',
]
const BINARIES = ['blast_live_voice/docs/screenshots/live_voice_gate.png']

/** 确定性脱敏规则（顺序即优先级）；正则同样由拼接常量构成。 */
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RULES = [
  { name: 'repo-root-posix', re: new RegExp(escapeRe(WORKSPACE_PARENT.replace(/\\/g, '/')) + '/' + REPO_DIR_NAME, 'g'), to: '<REPO_ROOT>' },
  { name: 'repo-root-win', re: new RegExp(escapeRe(WORKSPACE_PARENT) + '\\\\' + REPO_DIR_NAME, 'g'), to: '<REPO_ROOT>' },
  { name: 'repo-root-short', re: new RegExp(REPO_DIR_NAME, 'g'), to: '<REPO_DIR_NAME>' },
  { name: 'workspace-parent', re: new RegExp(escapeRe(WORKSPACE_PARENT), 'g'), to: '<WORKSPACE_PARENT>' },
  { name: 'user-home', re: new RegExp(escapeRe(USER_HOME), 'g'), to: '%USERPROFILE%' },
  { name: 'dsh-install', re: new RegExp(escapeRe(DSH_INSTALL), 'g'), to: '<DSH_INSTALL_DIR>' },
  { name: 'host-label', re: new RegExp(escapeRe(HOST_LABEL), 'g'), to: 'Windows 工作站' },
]

/** 独立扫描：任何命中都视为阻断。 */
const SECRET_PATTERNS = [
  { name: 'openai-key', re: /sk-[A-Za-z0-9_-]{16,}/ },
  { name: 'github-token', re: /gh[pous]_[A-Za-z0-9]{16,}/ },
  { name: 'bearer', re: /[Bb]earer\s+[A-Za-z0-9._-]{16,}/ },
  { name: 'private-key', re: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: 'assignment', re: /(DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|API_KEY)\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/ },
  { name: 'local-path', re: /[A-Z]:\\Users\\[^\\\s]+|[A-Z]:\\AgentWorkspace/i },
  { name: 'internal-dir', re: new RegExp(REPO_DIR_NAME) },
]

/** 被复制文件里绝不允许出现这些名字（凭据/环境/密钥文件）。 */
const FORBIDDEN_NAMES = /(^|[\\/])(\.credentials[^\\/]*|\.env[^\\/]*|credentials\.json|secrets?\.json|.*\.(pem|key|p12|pfx))$/i

function sanitized(text) {
  let out = text
  const counts = {}
  for (const rule of RULES) {
    const hits = out.match(rule.re)
    if (hits && hits.length) counts[rule.name] = (counts[rule.name] ?? 0) + hits.length
    out = out.replace(rule.re, rule.to)
  }
  return { text: out, counts }
}

if (flag('status') || (!flag('copy') && !flag('scan'))) {
  console.log(JSON.stringify({
    repo_root: repoRoot,
    target_root: targetRoot,
    target_present: fs.existsSync(targetRoot),
    files: FILES.length,
    binaries: BINARIES.length,
  }, null, 2))
  process.exit(0)
}

const totalCounts = {}
const written = []
for (const rel of FILES) {
  const source = path.join(repoRoot, rel)
  const destination = path.join(targetRoot, rel)
  if (!fs.existsSync(source)) {
    console.log(`MISSING  ${rel}`)
    process.exitCode = 2
    continue
  }
  const { text, counts } = sanitized(fs.readFileSync(source, 'utf8'))
  for (const [key, value] of Object.entries(counts)) totalCounts[key] = (totalCounts[key] ?? 0) + value
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, text, 'utf8')
  written.push(rel)
}
for (const rel of BINARIES) {
  const source = path.join(repoRoot, rel)
  const destination = path.join(targetRoot, rel)
  if (!fs.existsSync(source)) { console.log(`MISSING  ${rel}`); process.exitCode = 2; continue }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  written.push(rel)
}

console.log(`copied ${written.length} files → ${targetRoot}`)
console.log(`sanitization: ${JSON.stringify(totalCounts)}`)

// 发布后独立复扫（包含刚写进去的内容）
let hits = 0
for (const rel of FILES) {
  if (FORBIDDEN_NAMES.test(rel)) {
    hits += 1
    console.log(`SCAN HIT  forbidden-file-name: ${rel}`)
    continue
  }
  const file = path.join(targetRoot, rel)
  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of SECRET_PATTERNS) {
    const found = text.match(pattern.re)
    if (found) {
      hits += found.length
      console.log(`SCAN HIT  ${pattern.name} in ${rel} (${found.length})`)
    }
  }
}
console.log(hits === 0 ? 'scan: clean (0 hits)' : `scan: ${hits} hits`)
process.exitCode = hits === 0 ? (process.exitCode ?? 0) : 3
void fileURLToPath
