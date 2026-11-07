// 用真实组件代码跑一次渲染，验证它到底产出 DOM、返回 null、还是抛错。
//
// 为什么必须这么做：前几轮症状都是"拖动条完全没出现、控制台也没东西"，
// 只读代码无法区分三种可能（return null / 渲染期抛错 / 模块没加载）。
// 只有真的调一次组件函数才知道。
//
// 本机没有独立 React 包（被打进前端 bundle），所以用一张极小的 hooks 实现
// 驱动组件：不模拟 React 调度，只如实记录渲染结果与异常 —— 对
// "会不会产出 DOM" 这个问题已经足够。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/**
 * 造一张最小 React 面，并把每次 createElement 收集起来。
 * @returns {{react:object, elements:Array, effects:Array}}
 */
function makeReact() {
  const elements = []
  const effects = []
  let hookSeq = 0
  const react = {
    createElement(type, props, ...children) {
      const el = { type, props: props ?? {}, children }
      elements.push(el)
      return el
    },
    useState(init) {
      hookSeq += 1
      return [typeof init === 'function' ? init() : init, () => {}]
    },
    useRef(init) {
      hookSeq += 1
      return { current: init }
    },
    useMemo(fn) {
      hookSeq += 1
      return fn()
    },
    useCallback(fn) {
      hookSeq += 1
      return fn
    },
    useEffect(fn) {
      hookSeq += 1
      effects.push(fn)
      return undefined
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      hookSeq += 1
      return getSnapshot()
    },
    Fragment: 'Fragment',
  }
  return { react, elements, effects }
}

/** 求值 client.js 的工厂体，返回它的 exports。 */
function loadModule(react) {
  let registered = null
  new Function('window', source)({
    __ModuleLoader__: { load: (entry) => { registered = entry } },
  })
  if (registered === null) throw new Error('模块没有注册')
  return registered.factory((spec) => {
    if (spec === 'react') return react
    throw new Error('未预期的 require: ' + spec)
  })
}

/** 通过 apply 的 register 调用捕获组件本体。 */
function captureComponent(exports) {
  let captured = null
  const slots = {
    inject(_name, cb) { return cb() },
    register(_opts, comp) { captured = comp; return () => {} },
  }
  const directory = {
    store: { subscribe: () => () => {}, getSnapshot: () => ({}) },
    load() {},
    select() { return Promise.resolve({ ok: true }) },
  }
  const ctx = {
    effect() { return () => {} },
    inject(_names, cb) {
      cb({
        slots,
        modelDirectories: { directoryFor: () => directory },
        sessions: { subagentAddress: () => undefined },
      })
    },
    slots,
    locale: { register() { return () => {} }, bind() { return (k) => k } },
  }
  exports.apply(ctx)
  return captured
}

/** 行为对齐 ModelDirectory.store 的最小 store。 */
function makeStore(snapshot) {
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
  }
}

// ── 场景 ────────────────────────────────────────────────────────
const reasoning4 = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
}

const base = {
  current: { provider: 'codebuddy-native', model: 'deepseek-v4.1-flash' },
  groups: [{ id: 'codebuddy-native', models: [{ id: 'deepseek-v4.1-flash', reasoning: reasoning4 }] }],
  pending: null,
  error: null,
  status: 'ready',
}

const scenarios = [
  { name: '正常：4 档 / 默认 High', snapshot: base, expectRender: true },
  { name: 'groups 为空（catalog 未就绪）', snapshot: { ...base, groups: [] }, expectRender: false },
  { name: 'current 为 null', snapshot: { ...base, current: null }, expectRender: false },
  {
    name: '模型只有单档（fixed）',
    snapshot: {
      ...base,
      groups: [{ id: 'codebuddy-native', models: [{ id: 'deepseek-v4.1-flash', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }] }],
    },
    expectRender: true,
  },
]

const { react, elements } = makeReact()
const exports = loadModule(react)
const Slider = captureComponent(exports)

console.log('捕获组件:', Slider ? Slider.name : '(失败)')
console.log('')

// 外层 EffortSlider 只是守卫（available 不为 true 就 return null），
// 真正画 UI 的是它内部创建的 EffortControl。这里通过伪造 createElement
// 把 EffortControl 截下来，然后用完整 props 直接调用它。
let Control = null
{
  const probe = makeReact()
  const origCreate = probe.react.createElement
  probe.react.createElement = (type, props, ...children) => {
    if (typeof type === 'function' && type.name === 'EffortControl') Control = type
    return origCreate(type, props, ...children)
  }
  const probeExports = loadModule(probe.react)
  const S = captureComponent(probeExports)
  // 触发外层，让它走到 h(EffortControl, ...)
  try {
    S({ available: true, directory: makeStore(base), load() {}, select: () => Promise.resolve({ ok: true }) })
  } catch { /* 只为了捕获组件引用 */ }
}
if (Control === null) throw new Error('没能捕获 EffortControl')
console.log('内层组件:', Control.name)
console.log('')

let failures = 0
for (const sc of scenarios) {
  elements.length = 0
  let out
  let err = null
  try {
    out = Control({ directory: makeStore(sc.snapshot), load() {}, select: () => Promise.resolve({ ok: true }) })
  } catch (e) {
    err = e
  }

  let verdict
  if (err !== null) verdict = 'THROW: ' + err.message
  else if (out === null || out === undefined) verdict = 'return null'
  else verdict = 'RENDERED'

  const rendered = verdict === 'RENDERED'
  const ok = rendered === sc.expectRender
  if (!ok) failures += 1

  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${sc.name}`)
  console.log(`       => ${verdict}`)
  if (rendered) {
    const root = out
    console.log(`       root.className = ${root.props.className}`)
    console.log(`       data-effort-index = ${root.props['data-effort-index']} / count = ${root.props['data-effort-count']}`)
    console.log(`       style = ${JSON.stringify(root.props.style)}`)
    // 子元素结构：label + track(rail/fill/knob)
    const kids = root.children.flat()
    console.log(`       children = ${kids.map((k) => (k && k.props ? k.props.className : String(k))).join(' | ')}`)
  }
}

console.log('')
console.log(failures === 0 ? '>>> 组件渲染行为符合预期' : `>>> ${failures} 项不符合预期`)
process.exit(failures === 0 ? 0 : 1)
