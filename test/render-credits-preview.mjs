// 底栏积分胶囊的视觉验证：
// 用真实 client.js 的组件代码（含真实 CSS）渲染进 Chromium，截图看效果。
//
// 关键点：**不重写组件**。这里把 lib/client.js 原样 load 出来，只把 React 换成
// 一个最小实现，再把组件产出的 element 树挂到 DOM 上 —— 于是样式、类名、
// title 文案、千分位格式都来自产品代码本身，截图才算证据。
//
// 宿主 CSS 变量（--dsw-alias-* / --dsh-content-*）这里按真实浅色主题的取值注入，
// 缺失的一律回落到插件自己写在 CSS 里的 fallback，所以即使取值略有偏差，
// 看到的也是「产品代码在缺变量时的样子」，而不是我编的样子。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

// ── 最小 React：把 element 树渲染成真实 DOM ──────────────────────
function makeReact() {
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}] },
    useRef(init) { return { current: init } },
    useMemo(fn) { return fn() },
    useCallback(fn) { return fn },
    useEffect() { return undefined },
    useSyncExternalStore(_s, getSnapshot) { return getSnapshot() },
    Fragment: 'Fragment'
  }
  return react
}

/** element 树 → HTML 字符串（类名/样式/title 原样保留）。 */
function toHtml(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')
  const { type, props, children } = node
  if (type === 'Fragment') return children.map(toHtml).join('')
  const attrs = []
  // React 的 props 叫 className / htmlFor；写进 HTML 字符串必须换成 class / for，
  // 否则预览页里一个类名都不会生效（第一版就是这样，截图看上去"完全没样式"）。
  const rename = { className: 'class', htmlFor: 'for', tabIndex: 'tabindex' }
  for (const [rawKey, value] of Object.entries(props)) {
    const key = rename[rawKey] ?? rawKey
    if (value === undefined || value === null || value === false) continue
    if (key === 'children') continue
    if (key === 'style' && typeof value === 'object') {
      attrs.push(`style="${Object.entries(value).map(([k, v]) => `${k}:${v}`).join(';')}"`)
      continue
    }
    if (typeof value === 'boolean') { if (value) attrs.push(key); continue }
    if (typeof value === 'function') continue
    attrs.push(`${key}="${String(value).replace(/"/g, '&quot;')}"`)
  }
  const inner = children.map(toHtml).join('')
  return `<${type} ${attrs.join(' ')}>${inner}</${type}>`
}

function loadModule(react) {
  let registered = null
  new Function('window', 'fetch', source)(
    { __ModuleLoader__: { load: (entry) => { registered = entry } } },
    () => new Promise(() => {})
  )
  return registered.factory((spec) => {
    if (spec === 'react') return react
    throw new Error('未预期的 require: ' + spec)
  })
}

/** 取 CSS 常量（`const CSS = \`...\``）原样搬进页面。 */
function extractCss() {
  const match = /const CSS = `([\s\S]*?)`;/.exec(source)
  if (match === null) throw new Error('没能从 client.js 里取到 CSS')
  return match[1]
}

function captureDock(exports) {
  let dock = null
  const slots = {
    inject(_n, cb) { return cb() },
    register(options, component) {
      if (options && options.name === 'conversation.composer.dock') dock = component
      return () => {}
    }
  }
  exports.apply({
    effect() {},
    inject(_names, cb) {
      cb({
        slots,
        modelDirectories: { directoryFor: () => ({ store: { subscribe: () => () => {}, getSnapshot: () => ({}) }, load() {}, select: () => Promise.resolve({}) }) },
        sessions: { subagentAddress: () => undefined }
      })
    },
    slots,
    locale: { register() { return () => {} }, bind() { return (k) => k } }
  })
  if (dock === null) throw new Error('没能捕获 conversation.composer.dock 组件')
  return dock
}

/** 已知的四种状态，全部来自真实上游读数的形状。 */
const cases = [
  {
    name: '正常（今日 190.73 / 剩余 5759.9）',
    data: { balance: 5759.9000063, today: 190.7299997500002, plan: '标准版', todayRequests: 308, groups: [{ total: 2000, remain: 0 }, { total: 2000, remain: 1378 }, { total: 6300, remain: 4381 }], account: { nickname: '夜空～最亮的星' } }
  },
  {
    name: '低余额（剩余 120 / 共 10300 → 1.2%）',
    data: { balance: 120.4, today: 88.13, groups: [{ total: 10300, remain: 120.4 }], account: { nickname: '夜空～最亮的星' } }
  },
  {
    name: '零余额',
    data: { balance: 0, today: 0, groups: [{ total: 2000, remain: 0 }], account: { nickname: '夜空～最亮的星' } }
  },
  {
    name: '取数失败（错误原文照抄）',
    error: 'http 401 code 10001 token expired'
  }
]

function renderCase(Chip, item) {
  const react = makeReact()
  // 通过 useState 的初值注入状态：data / error / busy
  let call = 0
  react.useState = (init) => {
    call += 1
    if (call === 1) return [item.data ?? null, () => {}]
    if (call === 2) return [item.error ?? null, () => {}]
    if (call === 3) return [false, () => {}]
    return [typeof init === 'function' ? init() : init, () => {}]
  }
  const exports = loadModule(react)
  const Component = captureDock(exports)
  return toHtml(Component({}))
}

const react = makeReact()
const exports = loadModule(react)
const Chip = captureDock(exports)
const css = extractCss()

const cells = cases.map((item) => `
    <div class="cell">
      <div class="cell-label">${item.name}</div>
      <div class="dock-row">
        ${renderCase(Chip, item)}
        <span class="host-pill"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 11a5 5 0 0 1 10 0" stroke="currentColor" fill="none" stroke-width="1.4"/></svg><span>3 轮 122 步</span></span>
        <span class="host-pill"><svg viewBox="0 0 16 16" width="14" height="14"><ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" stroke="currentColor" fill="none" stroke-width="1.4"/></svg><span>23.8M tok</span><span class="host-sep">·</span><span>缓存命中 99%</span></span>
        <span class="host-pill"><span>24%</span></span>
      </div>
    </div>`).join('')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
/* 真实浅色主题下的宿主变量（取值来自 tokens 的设计稿；缺的都落回插件自己的 fallback） */
:root {
  --dsw-radius-sm: 6px;
  --dsw-alias-label-primary: #1f2126;
  --dsw-alias-label-secondary: #6b7280;
  --dsw-alias-label-tertiary: #8b919c;
  --dsw-alias-label-dimmed: #aab0ba;
  --dsw-alias-separator-primary: rgba(31,33,38,.22);
  --dsw-alias-interactive-bg-hover: rgba(31,33,38,.06);
  --dsw-alias-state-error-primary: #c0304a;
  --dsw-alias-state-warn-label: #b8790a;
  --dsw-alias-state-business-primary: #4a7dff;
  --dsh-content-font-size-secondary: 13px;
  --dsh-content-font-delta-secondary: 0px;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 32px; display: flex; flex-direction: column; align-items: flex-start;
  background: #f7f8fa;
  font-family: "Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.sub { font-size: 12px; color: #6b7280; margin: 0 0 22px; }
.cell { margin-bottom: 20px; }
.cell-label { font-size: 12px; color: #6b7280; margin-bottom: 7px; }
/* 宿主 composer.dock 的真实形状：居中一行、gap 12px、padding-top 4px。
 * 宽度按真实的 composer 卡宽（--dsh-composer-card-max-width 取 768px）来，
 * 否则「四个胶囊挤不挤」这个判断会被一个假的窄容器扭曲。 */
.dock-row {
  display: flex; justify-content: center; align-items: center; gap: 12px;
  width: 768px; max-width: 100%; padding: 6px 12px;
  background: #fff; border-radius: 10px;
  border: 1px solid rgba(31,33,38,.09);
  box-shadow: 0 1px 2px rgba(31,33,38,.04);
}
/* 宿主自己的统计胶囊：用同一套变量，验证「看起来是同一行的一部分」 */
.host-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 1px 8px; border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-tertiary);
  font-size: calc(var(--dsh-content-font-size-secondary) - 1px);
  line-height: 20px; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.host-pill svg { width: 14px; height: 14px; flex: none; }
.host-sep { color: var(--dsw-alias-separator-primary); margin: 0 2px; }
/* 插件自己的 CSS，原样来自 lib/client.js */
${css}
</style></head>
<body>
  <h1>输入框下方那一行 · CodeBuddy 积分读数</h1>
  <p class="sub">左侧为插件新增的读数，右侧三个是与宿主自己的统计胶囊（轮次 / token / 上下文）并排的效果。样式与文案全部来自 lib/client.js，未在页面里重写。</p>
  ${cells}
</body></html>`

const outDir = join(root, 'preview')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'credits-chip.html')
writeFileSync(outFile, html, 'utf8')
console.log('wrote', outFile)
console.log('component:', Chip.name || '(anonymous)')
