// Install / remove the `blast-demo` Agent preset — the minimal-permission Demo
// Profile for the local BLAST engineering workspace.
//
//   node blast_engineering_ui/tools/install-demo-profile.mjs [--status]
//   node blast_engineering_ui/tools/install-demo-profile.mjs --install [--set-default]
//   node blast_engineering_ui/tools/install-demo-profile.mjs --uninstall
//
// What it touches (nothing else, ever):
//   <DSH_HOME>/.agent-presets/blast-demo/agent.cordis.yml   generated from
//                                                           ../demo-profile/agent.cordis.template.yml
//   <DSH_HOME>/.agent-presets/blast-demo/preset.yml         copied from ../demo-profile/preset.yml
//   <DSH_HOME>/settings.yaml                                ONLY with --set-default, and only by
//                                                           appending `agent-presets: {default: blast-demo}`
//                                                           to a file that has no `agent-presets:` block yet
//   (a backup settings.yaml.bak-blast-demo is written before that edit)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const repoRoot = path.resolve(pluginRoot, '..')
const templateFile = path.join(pluginRoot, 'demo-profile', 'agent.cordis.template.yml')
const presetFile = path.join(pluginRoot, 'demo-profile', 'preset.yml')
// The preset names this file as the bare subpath `blast-engineering-ui/blast-tools`
// (see `exports` in package.json) so the harness package resolver — not a bare file
// URL — imports it and its own `@deepseek-ai/dsh-tools` import can resolve. The path
// below is kept for `--status` (the file has to exist for that subpath to resolve)
// and for the legacy `{{PLUGIN_FILE}}` placeholder, which the template no longer uses.
const pluginFile = path.join(pluginRoot, 'lib', 'blast-tools.mjs')

const PRESET_ID = 'blast-demo'
const dshHome = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
const presetsRoot = path.join(dshHome, '.agent-presets')
const targetDir = path.join(presetsRoot, PRESET_ID)
const targetAssembly = path.join(targetDir, 'agent.cordis.yml')
const settingsFile = path.join(dshHome, 'settings.yaml')
const settingsBackup = path.join(dshHome, 'settings.yaml.bak-blast-demo')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const mode = flag('status') ? 'status' : flag('uninstall') ? 'uninstall' : 'install'

const out = (line) => console.log(line)

function renderAssembly() {
  const template = fs.readFileSync(templateFile, 'utf8')
  return template
    .replace(/\{\{PLUGIN_FILE\}\}/g, pluginFile.split(path.sep).join('/'))
    .replace(/\{\{REPO_ROOT\}\}/g, repoRoot.split(path.sep).join('/'))
}

function describe() {
  return {
    dsh_home: dshHome,
    preset_id: PRESET_ID,
    preset_dir: targetDir,
    assembly_present: fs.existsSync(targetAssembly),
    plugin_file: pluginFile,
    plugin_present: fs.existsSync(pluginFile),
    repo_root: repoRoot,
    settings_file: settingsFile,
    settings_has_agent_presets: fs.existsSync(settingsFile)
      && /^agent-presets:/m.test(fs.readFileSync(settingsFile, 'utf8')),
    settings_backup: fs.existsSync(settingsBackup),
  }
}

switch (mode) {
  case 'status':
    out(JSON.stringify(describe(), null, 2))
    break

  case 'install': {
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(targetAssembly, renderAssembly(), 'utf8')
    fs.copyFileSync(presetFile, path.join(targetDir, 'preset.yml'))
    out(`blast-demo preset written: ${targetAssembly}`)
    if (flag('set-default')) {
      if (!fs.existsSync(settingsFile)) {
        out(`no ${settingsFile}; skipped --set-default`)
        break
      }
      const text = fs.readFileSync(settingsFile, 'utf8')
      if (/^agent-presets:/m.test(text)) {
        out('settings.yaml already has an `agent-presets:` block — left untouched; set `default:` there by hand.')
        break
      }
      fs.writeFileSync(settingsBackup, text, 'utf8')
      const next = text.endsWith('\n') ? text : text + '\n'
      fs.writeFileSync(settingsFile, `${next}agent-presets:\n  default: ${PRESET_ID}\n`, 'utf8')
      out(`settings.yaml: agent-presets.default = ${PRESET_ID} (backup: ${settingsBackup})`)
    }
    out('restart DSH Desktop for the roster to pick the preset up, then choose 「BLAST Studio」 in the session preset selector.')
    break
  }

  case 'uninstall': {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
      out(`removed ${targetDir}`)
    } else {
      out(`nothing to remove at ${targetDir}`)
    }
    if (fs.existsSync(settingsBackup)) {
      fs.copyFileSync(settingsBackup, settingsFile)
      fs.rmSync(settingsBackup, { force: true })
      out('settings.yaml restored from the backup taken by --set-default')
    }
    break
  }

  default:
    out(`unknown mode`)
    process.exitCode = 2
}
