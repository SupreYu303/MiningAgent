// blast-engineering-ui — browser-half contract test (offline, no DSH, no browser).
//
//   node blast_engineering_ui/tools/client-contract-test.mjs
//
// It loads the REAL shipped bundle (lib/client.js) in a Node VM with the minimum
// page surface it needs (a module loader, a React stub, a primitives stub) and
// drives the plugin's `apply()` against a fake DSH client context. Everything it
// asserts is a property of the shipped artifact:
//
//   * the seat map: exactly the seven seats of the conversation-native design,
//     and NO `shell.overlay` row any more (the overlay this round removed);
//   * the two shadowed columns keep `priority: -1`, everything else is additive;
//   * both chain seats carry a pure selector that returns null when idle, so
//     DSH's own produced-files row and approval panel keep their places;
//   * the bundle no longer reads or writes the `blast.ui.sidebar` localStorage
//     flag (the round-2 workaround whose failure was recorded as issue #1).
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const repoRoot = path.resolve(here, '..', '..')
const bundlePath = path.join(repoRoot, 'blast_engineering_ui', 'lib', 'client.js')
const source = fs.readFileSync(bundlePath, 'utf8')

const results = []
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  [' + detail + ']'}`)
}

// ── the page surface the bundle expects ─────────────────────────────────────
let loaderEntry = null
const styleTags = []

function makeElement() {
  const el = {
    dataset: {}, style: {}, textContent: '', children: [],
    setAttribute() {}, getAttribute() { return null },
    appendChild(child) { el.children.push(child); return child },
    remove() {}, querySelector() { return null }, querySelectorAll() { return [] },
  }
  return el
}

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Uint8Array, Math, JSON, Date, Number, String, Object, Array, RegExp, Error, Promise, Set, Map, WeakMap, Boolean,
  navigator: {},
  location: { protocol: 'file:', origin: 'http://127.0.0.1', href: 'file:///index.html' },
  fetch: () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
  document: {
    head: { appendChild(tag) { styleTags.push(tag) } },
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    addEventListener() {}, removeEventListener() {},
    documentElement: { style: {} },
  },
  MutationObserver: class { observe() {} disconnect() {} },
  KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
  cancelAnimationFrame: (handle) => clearTimeout(handle),
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.window.__ModuleLoader__ = { load(entry) { loaderEntry = entry } }
sandbox.window.__BLAST_ENGINEERING_API__ = 'http://127.0.0.1:43120/blast-engineering-api'

const context = vm.createContext(sandbox)
new vm.Script(source, { filename: bundlePath }).runInContext(context)

check('the bundle registers exactly one module-loader entry',
  Boolean(loaderEntry) && loaderEntry.id === 'blast-engineering-ui', loaderEntry && loaderEntry.id)

// ── React / primitives stubs (the factory only needs them to be present) ────
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (fn) => fn(), useRef: (value) => ({ current: value }),
  memo: (component) => component, Fragment: 'Fragment',
}
const moduleExports = loaderEntry.factory((name) => {
  if (name === 'react') return ReactStub
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: null }
  throw new Error('unexpected require: ' + name)
})

// ── the fake DSH client context ─────────────────────────────────────────────
const registrations = []
const injected = {}
const effects = []
const disposed = []

const scope = {
  slots: {
    inject(name, factory) {
      injected[name] = factory
      const dispose = factory()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => { disposed.push(options.id || options.name) }
    },
  },
  locale: { register() {} },
  layout: { openDetails() {}, closeDetails() {}, toggleSidebar() {} },
  sessions: { open() {} },
  workspaces: { startSession() {} },
  conversation: { input: { shell: () => ({ setDraft() {}, submit() {} }) } },
  get(name) { return scope[name] },
}

const ctx = {
  effect(fn, label) { effects.push({ label, dispose: fn() }); return () => {} },
  inject(names, callback) { callback(scope); return () => {} },
  get(name) { return scope[name] },
  logger: { info() {}, warn() {}, error() {} },
}

try {
  moduleExports.apply(ctx)
  check('apply() completes against the real bundle + a fake client context', true)
} catch (error) {
  check('apply() completes against the real bundle + a fake client context', false, error && error.message)
}

check('the plugin declares its inject list',
  Array.isArray(moduleExports.inject) && moduleExports.inject.includes('slots') && moduleExports.inject.includes('locale'),
  JSON.stringify(moduleExports.inject))

// ── seams ───────────────────────────────────────────────────────────────────
const byName = (name) => registrations.filter((row) => row.options.name === name)
const EXPECTED = [
  'sidebar',
  'details',
  'conversation.session.header.utilities',
  'conversation.composer.dock',
  'conversation.chat.turnTail',
  'conversation.input.right',
  'conversation.hero.brand.mark',
]
for (const seat of EXPECTED) {
  check(`seat ${seat} is occupied exactly once`, byName(seat).length === 1, byName(seat).length)
}
check('the bundle registers no seat outside the seven-seat map',
  registrations.length === EXPECTED.length, registrations.map((row) => row.options.name).join(', '))

check('the removed overlay seat shell.overlay is NOT registered', byName('shell.overlay').length === 0)
check('the source no longer mentions shell.overlay at all', !source.includes('shell.overlay'))
check('the source no longer reads/writes the sidebar localStorage flag',
  !source.includes('localStorage') && !source.includes('blast.ui.sidebar'))
check('the composer chain is NOT shadowed (the native approval panel keeps its seat)',
  byName('conversation.composer').length === 0)

const sidebar = byName('sidebar')[0]
const details = byName('details')[0]
check('the left column shadows the official sidebar (priority -1)',
  sidebar && sidebar.options.priority === -1, sidebar && sidebar.options.priority)
check('the right column shadows the official details panel (priority -1)',
  details && details.options.priority === -1, details && details.options.priority)
check('the two shadowed columns are the only priority overrides on the columns',
  registrations.filter((row) => row.options.priority !== undefined
    && (row.options.name === 'sidebar' || row.options.name === 'details')).length === 2
  && registrations.filter((row) => row.options.name === 'sidebar' || row.options.name === 'details')
    .every((row) => row.options.priority === -1),
  registrations.filter((row) => row.options.priority !== undefined)
    .map((row) => row.options.name + '=' + row.options.priority).join(', '))
check('the hero brand mark shadows the occupied hero cell from below (lowest renders)',
  byName('conversation.hero.brand.mark')[0].options.priority === -1)

check('the turn-tail chain carries a pure selector',
  typeof byName('conversation.chat.turnTail')[0].options.select === 'function')

const tailSelect = byName('conversation.chat.turnTail')[0].options.select
check('the turn-tail selector returns null for an unrelated turn',
  tailSelect({ turn: 1, seq: 1 }) === null, String(tailSelect({ turn: 1, seq: 1 })))
check('the turn-tail selector needs a numeric turn', tailSelect({ seq: 1 }) === null)

// ── rendered surface ────────────────────────────────────────────────────────
const components = registrations.map((row) => row.component)
check('every registered seat has a component',
  components.every((component) => typeof component === 'function'),
  components.map((component) => typeof component).join(','))

const collect = (node, out) => {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.texts.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) collect(child, out); return out }
  if (typeof node !== 'object') return out
  out.props.push(node.props || {})
  for (const child of node.children || []) collect(child, out)
  return out
}
const walk = (node) => collect(node, { props: [], texts: [] })

const sidebarTree = sidebar.component({ collapsed: false })
const railTree = sidebar.component({ collapsed: true })
const sidebarWalk = walk(sidebarTree)
check('the expanded sidebar renders the five documented sections',
  ['Project', 'Cases', 'Design versions', 'Threads / History', 'Artifacts']
    .every((label) => sidebarWalk.texts.includes(label)),
  sidebarWalk.texts.slice(0, 14).join(' | '))
check('the collapsed sidebar renders a rail, not a full tree',
  walk(railTree).props.some((props) => props['data-blast-action'] === 'sidebar-expand'))
check('the sidebar footer keeps the DSH-sidebar escape hatch',
  sidebarWalk.props.some((props) => props['data-blast-action'] === 'native-sidebar'))

const gate = byName('conversation.composer')[0]
check('there is no blast entry left on the composer chain', gate === undefined)

const tail = byName('conversation.chat.turnTail')[0].component({ matched: null })
check('the engineering block renders nothing without a matched turn', tail === null)

const dock = byName('conversation.composer.dock')[0].component({})
check('the composer dock renders nothing while the pipeline is idle and no change is pending', dock === null)

const previewWalk = walk(details.component({}))
check('the preview pane renders its five kind tabs',
  ['report', 'plan', '3d', 'charge', 'qc']
    .every((kind) => previewWalk.props.some((props) => props['data-preview-tab'] === kind)),
  previewWalk.props.filter((props) => props['data-preview-tab']).length)
check('the preview pane defaults to the design report',
  previewWalk.props.some((props) => props['data-preview-file'] === '1')
  && previewWalk.texts.includes('ONE_CLICK_REPORT.md'))
check('the preview pane offers its own collapse control',
  previewWalk.props.some((props) => props['data-blast-action'] === 'preview-close'))

const statusWalk = walk(byName('conversation.session.header.utilities')[0].component({}))
check('the header status seat renders nothing before the ledger answers', statusWalk.props.length + statusWalk.texts.length === 0,
  JSON.stringify(statusWalk.texts))

// ── the empty-session hero brand mark (the BS monogram) ─────────────────────
const hero = byName('conversation.hero.brand.mark')[0]
let heroTree = null
let heroError = ''
try { heroTree = hero.component({ size: 34, className: 'pXSMma_fish' }) } catch (error) { heroError = error && error.message }
check('the hero brand mark renders', heroTree !== null && heroError === '', heroError)
const heroWalk = heroTree === null ? { props: [], texts: [] } : walk(heroTree)
check('the hero brand mark is the BS monogram, never the harness fish',
  heroWalk.texts.join('') === 'BS' && !/fish|FishLogo/i.test(JSON.stringify(heroWalk.props))
  && !heroWalk.props.some((props) => props.className === 'pXSMma_fish'),
  heroWalk.texts.join('|'))
check('the hero brand mark marks itself for the acceptance probe',
  heroWalk.props.some((props) => props['data-blast-hero-mark'] === '1')
  && heroWalk.props.some((props) => props['data-blast-hero-mark-button'] === '1'))
check('the hero brand mark is a real button with an accessible name',
  heroWalk.props.some((props) => props.type === 'button' && props['aria-label'] === 'BLAST Studio'))

// the shipped stylesheet still carries the approved geometry untouched
const stylesheet = styleTags.length ? String(styleTags[0].textContent) : ''
check('the pulse origin is still the B/S junction (51% / 52%)',
  stylesheet.includes('.bs-logo-origin{position:absolute;z-index:3;left:51%;top:52%'),
  stylesheet.includes('left:51%;top:52%'))
check('the hero mark is scaled down to a supporting size, in the official 34px cell',
  stylesheet.includes('.beu-hero-mark{position:relative;width:34px;height:0')
  && /--bs-hero-scale:\.\d+/.test(stylesheet))
check('the hero mark cell is zero-tall, so the headline row and the composer cannot move',
  /\.beu-hero-mark\{position:relative;width:34px;height:0;/.test(stylesheet)
  && !/\.beu-hero-mark\{[^}]*height:3\dpx/.test(stylesheet))
check('the mark never loops, idles, glows on hover or rotates',
  !/infinite/.test(stylesheet) && !/rotate\(/.test(stylesheet)
  && !/bs-logo-button:hover[^{]*\{[^}]*box-shadow/.test(stylesheet))
check('the mark honours prefers-reduced-motion',
  /@media \(prefers-reduced-motion:reduce\)\{\.bs-logo-button \*/.test(stylesheet))

// ── effects ─────────────────────────────────────────────────────────────────
const labels = effects.map((row) => row.label)
check('a stylesheet effect is installed', labels.some((label) => /stylesheet/.test(String(label))), labels.join(' | '))
check('the local voice mirror effect is installed', labels.some((label) => /voice/.test(String(label))))
check('the plugin stylesheet is appended exactly once', styleTags.length === 1, styleTags.length)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} client-contract checks passed`)
if (failed.length) {
  console.log('failed: ' + failed.map((row) => row.label).join('; '))
  process.exit(1)
}


