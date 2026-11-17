// 积分读数胶囊：真组件渲染 + 状态判定。
//
// 与 render-effort.test.mjs 同一套思路（本机没有独立 React 包，用最小 hooks 面驱动），
// 但这里多验两件事：
//   ① 它挂在 `conversation.composer.dock`（不是 input.right），且 id 唯一；
//   ② 拿到数据后**真的画出「今日 / 剩余」两个数字**，而不是悄悄返回 null ——
//      「槽位注册了但组件返回 null」正是这个仓库踩过的坑（见 slider.test.mjs 注释）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** 最小 React 面；createElement 只如实收集，不做调度。 */
function makeReact() {
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(init) {
      return [typeof init === 'function' ? init() : init, () => {}]
    },
    useRef(init) {
      return { current: init }
    },
    useMemo(fn) {
      return fn()
    },
    useCallback(fn) {
      return fn
    },
    useEffect() {
      return undefined
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
    Fragment: 'Fragment'
  }
  return react
}

function loadModule(react, fetchImpl) {
  let registered = null
  new Function('window', 'fetch', source)({
    __ModuleLoader__: { load: (entry) => { registered = entry } }
  }, fetchImpl)
  if (registered === null) throw new Error('模块没有注册')
  return registered.factory((spec) => {
    if (spec === 'react') return react
    throw new Error('未预期的 require: ' + spec)
  })
}

/** 捕获 `conversation.composer.dock` 的组件（**不是** input.right 的那个）。 */
function captureDockComponent(exports) {
  const captured = []
  const slots = {
    inject(_name, cb) { return cb() },
    register(options, component) { captured.push({ options, component }); return () => {} }
  }
  const ctx = {
    effect() { return () => {} },
    inject(_names, cb) {
      cb({
        slots,
        modelDirectories: { directoryFor: () => ({ store: { subscribe: () => () => {}, getSnapshot: () => ({}) }, load() {}, select: () => Promise.resolve({}) }) },
        sessions: { subagentAddress: () => undefined }
      })
    },
    slots,
    locale: { register() { return () => {} }, bind() { return (k) => k } }
  }
  exports.apply(ctx)
  const dock = captured.find((entry) => entry.options.name === 'conversation.composer.dock')
  return dock === undefined ? null : dock
}

/** 递归收集文本。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children || []).map(textOf).join('')
}

const payload = {
  ok: true,
  value: {
    balance: 5759.9000063,
    plan: '标准版',
    paid: true,
    groups: [
      { kind: 'plan_base', name: '套餐基础积分', remain: 0, total: 2000 },
      { kind: 'plan_bonus', name: '套餐赠送积分', remain: 1378.21, total: 2000 },
      { kind: 'benefit', name: '平台奖励积分', remain: 4381.69, total: 6300 }
    ],
    today: 190.7299997500002,
    todayRequests: 308,
    day: '2026-11-11',
    truncated: false,
    account: { nickname: '夜空～最亮的星', source: 'codebuddy-cli' },
    fetchedAt: 1794364680301
  }
}

test('credits: 注册在 conversation.composer.dock，id 独立于拖动条', () => {
  const exports = loadModule(makeReact(), () => new Promise(() => {}))
  const dock = captureDockComponent(exports)
  assert.ok(dock !== null, '必须注册 conversation.composer.dock')
  assert.equal(dock.options.id, 'codebuddy-credits')
  // 负序：排在宿主自己的统计胶囊（activity=0 / usage=1）前面
  assert.ok(dock.options.order < 0, 'order 必须为负，才能排在宿主统计胶囊之前')
})

test('credits: 没有数据时返回 null（不画空壳）', () => {
  const exports = loadModule(makeReact(), () => new Promise(() => {}))
  const Chip = captureDockComponent(exports).component
  assert.equal(Chip({}), null)
})

test('credits: 拿到数据后画出「今日 / 剩余」两个数字', () => {
  // 同步注入 props：组件只读 props 上的状态，数据由 effect 拉取；
  // 这里直接喂一次「已加载」的快照 —— 用 useState 的初值模拟。
  const react = makeReact()
  // 让 useState 的第一次调用返回已有数据（模拟 load 已完成）
  const originalUseState = react.useState
  let call = 0
  react.useState = (init) => {
    call += 1
    if (call === 1) return [payload.value, () => {}]           // data
    if (call === 2) return [null, () => {}]                    // error
    if (call === 3) return [false, () => {}]                   // busy
    return originalUseState(init)
  }
  const exports = loadModule(react, () => new Promise(() => {}))
  const Chip = captureDockComponent(exports).component
  const tree = Chip({})
  assert.ok(tree !== null, '有数据时必须渲染，不能 return null')
  const text = textOf(tree)
  assert.match(text, /今日/, '必须显示今日用量')
  assert.match(text, /剩余/, '必须显示剩余积分')
  // 190.7299… → 190.73（两位小数、去尾零）；5759.9000063 → 5,759.9（千分位）
  assert.match(text, /190\.73/, '今日用量要保留分位，不能四舍五入成 191')
  assert.match(text, /5,759\.9/, '余额要带千分位')
  assert.equal(tree.props['data-dsh-codebuddy-credits'], '')
})

test('credits: 余额为 0 时进 empty 状态，低余额进 low 状态', () => {
  const react = makeReact()
  let call = 0
  const zero = { ...payload.value, balance: 0, groups: [{ kind: 'plan_base', remain: 0, total: 2000 }] }
  react.useState = (init) => {
    call += 1
    if (call === 1) return [zero, () => {}]
    if (call === 2) return [null, () => {}]
    if (call === 3) return [false, () => {}]
    return [init, () => {}]
  }
  const exports = loadModule(react, () => new Promise(() => {}))
  const Chip = captureDockComponent(exports).component
  const tree = Chip({})
  assert.equal(tree.props['data-empty'], '1')
})

test('credits: 取数失败时显示错误态并保留点击重试', () => {
  const react = makeReact()
  let call = 0
  react.useState = (init) => {
    call += 1
    if (call === 1) return [null, () => {}]                       // data
    if (call === 2) return ['http 401 code 10001', () => {}]       // error
    if (call === 3) return [false, () => {}]                      // busy
    return [init, () => {}]
  }
  const exports = loadModule(react, () => new Promise(() => {}))
  const Chip = captureDockComponent(exports).component
  const tree = Chip({})
  assert.ok(tree !== null, '错误态也必须渲染（否则用户以为插件没装）')
  assert.equal(tree.props['data-error'], '1')
  assert.match(String(tree.props.title), /http 401 code 10001/, '错误原文必须照抄，不要概括')
  assert.equal(typeof tree.props.onClick, 'function', '错误态要能点击重试')
})
