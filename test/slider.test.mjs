/**
 * 推理等级拖动条 —— 纯逻辑测试（零 DOM、零 React、零网络）。
 *
 * ── 为什么值得写 ───────────────────────────────────────────────
 * 拖动条的**唯一**难题不是样式，是「它必须和弹框说同一件事」：
 *   · 默认档位要和弹框一致（否则新会话一打开两边就对着干）
 *   · 拖动 → 弹框要跟着变；弹框改 → 拖动条要跟着变
 * 这件事完全由 `effortSliderModel()` 的取值表达式决定，所以把它抽成纯函数
 * 单独钉住。浏览器里再手动验一遍「拖动是否只发一次请求」，那部分这里测不到。
 *
 * ── 判定基准 ───────────────────────────────────────────────────
 * 弹框（dsh-client-ui-model-selection/lib/client.js 的 ModelSelect）用的是:
 *
 *     const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
 *     const effortChoices = reasoning.defaultEffort === undefined
 *       ? [{ effort: undefined, label: t("effort.providerDefault") }, ...efforts]
 *       : [...efforts];
 *
 * 下面每一条断言都在复刻这两行，任何漂移都会让测试红。
 *
 * 运行方式同其它测试（本文件不 import lib/index.js，所以在仓库里也能跑）：
 *   node --test "test/*.test.mjs"
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * 在 Node 里执行 client.js：它只认 `window.__ModuleLoader__.load({id, factory})`，
 * 所以我们塞一个只捕获 factory 的假 loader，再用假 React 把 factory 跑出来。
 *
 * 假 React 只提供 factory 顶层用到的面：模块体里会 `require("react")` 并解构
 * 若干 hook —— 那些 hook 在**模块体阶段**不会被调用，所以给一组会抛错的桩就够，
 * 一旦谁在模块层误调 hook，测试会立刻炸而不是静默通过。
 */
function loadClientModule() {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  let registered = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) { registered = entry }
      }
    }
  }
  const notCalled = (name) => () => {
    throw new Error(`client.js 在模块求值阶段调用了 React.${name}()，这是不该发生的`)
  }
  const react = {
    createElement: () => ({}),
    useState: notCalled('useState'),
    useEffect: notCalled('useEffect'),
    useLayoutEffect: notCalled('useLayoutEffect'),
    useCallback: notCalled('useCallback'),
    useRef: notCalled('useRef'),
    useMemo: notCalled('useMemo'),
    useSyncExternalStore: notCalled('useSyncExternalStore')
  }
  const require = (specifier) => {
    if (specifier === 'react') return react
    throw new Error('client.js 请求了未预期的模块：' + specifier)
  }

  // 用 Function 而不是 vm：bundle 顶层是普通脚本，不需要 ESM 语义。
  new Function('window', source)(sandbox.window)
  assert.ok(registered !== null, 'client.js 没有调用 __ModuleLoader__.load')
  assert.equal(registered.id, 'dsh-codebuddy', '注册的模块 id 必须等于包名')
  const exports = registered.factory(require)
  return exports
}

const { __test__ } = loadClientModule()
const { effortChoicesOf, effortSliderModel } = __test__

// ── 档位序列：必须与弹框构造的 effortChoices 完全同形 ─────────────

test('slider: 声明了 defaultEffort 时，档位列表就是 efforts（不插 Default 项）', () => {
  const reasoning = {
    efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
    defaultEffort: 'high'
  }
  assert.deepEqual(effortChoicesOf(reasoning), [
    { effort: 'off', label: 'Off' },
    { effort: 'low', label: 'Low' },
    { effort: 'high', label: 'High' }
  ])
})

test('slider: 没声明 defaultEffort 时，首项是 effort=undefined（弹框的「Default」）', () => {
  const reasoning = { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] }
  assert.deepEqual(effortChoicesOf(reasoning), [
    { effort: undefined, label: 'Default' },
    { effort: 'high', label: 'High' },
    { effort: 'max', label: 'Max' }
  ])
})

test('slider: 没有 reasoning 元数据的模型 → 空序列（拖动条不渲染）', () => {
  assert.deepEqual(effortChoicesOf(undefined), [])
  assert.deepEqual(effortChoicesOf(null), [])
  assert.deepEqual(effortChoicesOf({ efforts: [] }), [])
})

// ── 默认档位：与弹框的 effectiveEffort 同一条取值链 ───────────────

test('slider: 未选择过时停在适配器给的 defaultEffort（CodeBuddy 的次高档语义）', () => {
  const reasoning = {
    efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
    defaultEffort: 'high'
  }
  const slider = effortSliderModel(reasoning, { provider: 'codebuddy-native', model: 'deepseek-v4.1-flash' })
  assert.equal(slider.effectiveEffort, 'high', '默认档位必须等于适配器声明的 defaultEffort')
  assert.equal(slider.effectiveIndex, 2)
  assert.equal(slider.lastIndex, 3)
  assert.equal(slider.fixed, false)
})

test('slider: 会话里已选过 → reasoningEffort 覆盖 defaultEffort（与弹框一致）', () => {
  const reasoning = {
    efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
    defaultEffort: 'high'
  }
  const slider = effortSliderModel(reasoning, {
    provider: 'codebuddy-native', model: 'deepseek-v4.1-flash', reasoningEffort: 'max'
  })
  assert.equal(slider.effectiveEffort, 'max')
  assert.equal(slider.effectiveIndex, 2)
})

test('slider: 未声明 defaultEffort 且未选择 → 落到 Default 项（index 0）', () => {
  const reasoning = { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] }
  const slider = effortSliderModel(reasoning, { provider: 'p', model: 'm' })
  assert.equal(slider.effectiveEffort, undefined)
  assert.equal(slider.effectiveIndex, 0)
})

test('slider: 宿主给了列表外档位 → 停在首项，不抛错（弹框同款兜底）', () => {
  const reasoning = {
    efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }],
    defaultEffort: 'high'
  }
  const slider = effortSliderModel(reasoning, { provider: 'p', model: 'm', reasoningEffort: 'xhigh' })
  assert.equal(slider.effectiveIndex, 0, '无法定位时退回首项，与 ModelSelect 的 at < 0 ? 0 : at 一致')
})

// ── 单档模型 ─────────────────────────────────────────────────────

test('slider: 只有一个档位 → fixed=true（渲染静态标签，不给假拖动条）', () => {
  const single = effortSliderModel({ efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' }, { provider: 'p', model: 'm' })
  assert.equal(single.fixed, true)
  assert.equal(single.lastIndex, 0)

  // 有 Default 项 + 一个真档位 = 两个位置，此时是可拖的
  const two = effortSliderModel({ efforts: [{ id: 'high', name: 'High' }] }, { provider: 'p', model: 'm' })
  assert.equal(two.fixed, false)
  assert.equal(two.lastIndex, 1)
})

test('slider: 没有当前模型（current 为空）时不炸，也不给出可拖序列', () => {
  for (const current of [null, undefined]) {
    const slider = effortSliderModel({ efforts: [{ id: 'high', name: 'High' }] }, current)
    assert.equal(slider.effectiveIndex, 0)
    assert.equal(slider.effectiveEffort, undefined)
  }
})

// ── 注册面：必须挂在 right 槽且不改宿主模型座位 ────────────────────

test('slider: 插件只注册 settings.section 与 conversation.input.right 两个槽', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const slots = [...source.matchAll(/\.(?:slots\.)?register\(\{\s*\n?\s*name:\s*"([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(slots.sort(), ['conversation.input.right', 'settings.section'])
  // 绝不能顶掉宿主自己的模型选择器：那是 replaceRisk 最高的槽
  assert.ok(!source.includes('name: "conversation.input.model"'), '不能注册 conversation.input.model')
})

test('slider: inject 里必须声明 modelDirectories（取宿主同一份每会话目录）', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(
    /ctx\.inject\(\[[^\]]*"modelDirectories"[^\]]*\]/.test(source),
    '拖动条必须通过 ctx.inject 拿 modelDirectories，否则会另起一套状态'
  )
})

// ── v1.1.7 线上故障的回归护栏 ─────────────────────────────────────
//
// 故障现象：拖动条完全不出现，而且控制台干净。
//
// 实测根因（用真实 cordis 重放本文件结构得出，不是推测）：
//   首版写的是 `ctx.inject(["slots","modelDirectories"], scope => { … })`，
//   但回调体第一行就读了 `scope.sessions`。
//   cordis 对**未声明**的服务访问直接抛
//   `cannot get property "sessions" without inject`，于是回调中断、
//   `slots.register(...)` 一次都没被调用 —— 槽位连注册都没发生。
//   重放结果：漏 sessions → apply 执行了但 register 调用 0 次；
//             含 sessions → register 调用 1 次。
//
// 为什么必须测：这条链路的异常没有冒到浏览器控制台（被记进 cordis fiber），
// 属于「什么都没发生、也什么都没说」的故障，只能靠静态断言守住。

/**
 * 取出所有**真正的** `ctx.inject([...], …)` 调用，连同从匹配点到「下一个同级
 * 调用」之间的正文。
 *
 * 两个坑（都踩过）：
 *  1. 必须行首锚定，否则会匹配到注释里说明用的 `ctx.inject([...])` 文本。
 *  2. 正文切分要从 `m.index + m[0].length` 之后找下一个 `ctx.inject(`，
 *     否则 `indexOf('ctx.inject(', 1)` 会立刻命中本次匹配自身的开头，
 *     正文被切成空串 —— 那样所有作用域都会「看不出问题」，护栏变成摆设。
 */
function outerInjectScopes(source) {
  const out = []
  const re = /^[ \t]*ctx\.inject\(\[([^\]]*)\]/gm
  let m
  while ((m = re.exec(source)) !== null) {
    out.push({
      names: [...m[1].matchAll(/"([^"]+)"/g)].map((n) => n[1]),
      bodyStart: m.index + m[0].length,
    })
  }
  for (let i = 0; i < out.length; i += 1) {
    const end = i + 1 < out.length ? out[i + 1].bodyStart : source.length
    out[i].body = source.slice(out[i].bodyStart, end)
  }
  return out
}

test('slider: 顶层 inject 必须声明 sessions', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const declared = /const inject = \[([^\]]*)\]/.exec(source)
  assert.ok(declared !== null, '找不到顶层 `const inject = [...]`')
  for (const required of ['slots', 'locale', 'sessions']) {
    assert.ok(
      declared[1].includes(`"${required}"`),
      `顶层 inject 必须包含 "${required}"，当前是 [${declared[1].trim()}]`
    )
  }
})

test('slider: 调 directoryFor 的作用域必须声明 remote / remote.session', () => {
  // 回归 v1.1.8 那个「界面上完全不出现」的故障。
  //
  // ModelDirectoryResolver.directoryFor() 内部读 `this.ctx.remote.session`，
  // 而 cordis 的 Service 代理把 `this.ctx` 绑成**调用方 fiber** 的 ctx ——
  // 于是这一读校验的是本插件的注入表。cordis 对未声明服务直接抛错
  // （`cannot get property "remote.session" without inject`），
  // 异常落进 inject 回调的 try/catch → {available:false} → 组件静默不渲染。
  //
  // 现场报错（用户 DevTools）：
  //   [dsh-codebuddy] 推理等级拖动条：取模型目录失败
  //   Error: Cannot get property "remote.session" without inject
  //       at Proxy.directoryFor (client.js:1034)
  //
  // 所以两处（顶层 + 作用域）都必须有这两个名字，少一处就复现。
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const required = ['remote', 'remote.session']

  const declared = /const inject = \[([^\]]*)\]/.exec(source)
  assert.ok(declared !== null, '找不到顶层 `const inject = [...]`')
  for (const name of required) {
    assert.ok(
      declared[1].includes(`"${name}"`),
      `顶层 inject 必须包含 "${name}"（directoryFor 会用它校验），当前是 [${declared[1].trim()}]`
    )
  }

  const scopes = outerInjectScopes(source).filter((scope) => scope.body.includes('directoryFor'))
  assert.ok(scopes.length > 0, '找不到调用 directoryFor 的 ctx.inject 作用域')
  for (const scope of scopes) {
    for (const name of required) {
      assert.ok(
        scope.names.includes(name),
        `调 directoryFor 的作用域必须声明 "${name}"，当前是 [${scope.names.join(', ')}]`
      )
    }
  }
})

test('slider: 每个 ctx.inject 作用域都必须声明它回调体里读到的服务', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const scopes = outerInjectScopes(source)
  assert.ok(scopes.length > 0, '找不到任何 ctx.inject([...]) 调用')

  const problems = []
  for (const scope of scopes) {
    const reads = new Set([...scope.body.matchAll(/\bscope\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
    const declaredSet = new Set(scope.names)
    for (const read of reads) {
      if (read === 'slots') continue // slots 由 ctx.inject 自身保证
      if (!declaredSet.has(read)) {
        problems.push(
          `ctx.inject([${scope.names.join(', ')}]) 的回调读了 scope.${read}，但没声明它`
        )
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    '这些作用域会抛 `cannot get property "..." without inject` 并让 register 静默不执行：\n' +
      problems.map((p) => '  · ' + p).join('\n')
  )
})

test('slider: 取目录失败时不能静默吞掉（只允许「会话未绑定」这一种安静返回）', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  assert.ok(
    /console\.error\(\s*"\[dsh-codebuddy\]/.test(source),
    'catch 里必须有 console.error 分支，否则真实故障会被伪装成「不可用」'
  )
  assert.ok(
    /resolved no \(scope\|binding\)/.test(source),
    '只应对 resolved no scope / resolved no binding 安静返回，其它异常必须外泄'
  )
})

/**
 * 按花括号配平从源码里切出一个具名函数。
 *
 * 不能用 /function X\([\s\S]*?\n\}/ —— 非贪婪会停在函数体内部第一个顶格 `}`，
 * 抠出来的是残缺函数：能运行、数值看着像对的，但逻辑缺了一半。
 * （写呼吸窗口测试时正是这样被误导过一次，首档窗口宽度算出 0 却没察觉。）
 * @param source - 完整源码
 * @param name - 函数名
 * @returns 函数源码文本
 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`找不到函数 ${name}`)
  let i = source.indexOf('{', start)
  if (i === -1) throw new Error(`${name} 之后没有 {`)
  let depth = 0
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${name} 的花括号没有配平`)
}

test('slider: 呼吸幅度必须肉眼可辨（辉光摆幅不能跟着亮度被压扁）', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const fn = extractFunction(source, 'effortGlowWindow')
  // eslint-disable-next-line no-new-func
  const glow = new Function(`return (${fn})`)()

  // 亮度窗口被用户约束限死在 [前一档峰值, 本档峰值]，4 档时只有 0.18，
  // 折算到视觉约 15% —— 单靠亮度"看不出在呼吸"。
  // 所以必须另有足够大的独立摆幅（辉光/光晕）。这条断言就是在守它。
  for (const last of [1, 2, 3, 4]) {
    for (let i = 0; i <= last; i += 1) {
      const w = glow(i, last)
      const glowSpan = w.glowHi - w.glowLo
      const haloSpan = w.haloHi - w.haloLo
      assert.ok(
        glowSpan >= 12,
        `lastIndex=${last} 第 ${i} 档辉光摆幅仅 ${glowSpan.toFixed(1)}px，太不明显（需 >= 12px）`
      )
      assert.ok(
        haloSpan >= 0.4,
        `lastIndex=${last} 第 ${i} 档光晕浓度摆幅仅 ${haloSpan.toFixed(2)}，太不明显（需 >= 0.4）`
      )
      // 且辉光随档位递增（越右越亮）
      assert.ok(w.glowHi > 0 && w.glowLo > 0, '辉光半径必须为正')
    }
    // 高档的辉光必须强于低档
    assert.ok(glow(last, last).glowHi > glow(0, last).glowHi, '最高档辉光应强于最低档')
  }
})

test('slider: 轨道必须够粗（细线看不清，用户明确反馈过）', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const rail = /\.cb-effort-rail\s*\{[^}]*height:\s*(\d+)px/.exec(source)
  const fill = /\.cb-effort-fill\s*\{[^}]*height:\s*(\d+)px/.exec(source)
  assert.ok(rail !== null, '找不到 .cb-effort-rail 的高度')
  assert.ok(fill !== null, '找不到 .cb-effort-fill 的高度')
  assert.ok(Number(rail[1]) >= 5, `轨道只有 ${rail[1]}px，太细（需 >= 5px）`)
  assert.ok(Number(fill[1]) >= 5, `填充条只有 ${fill[1]}px，太细（需 >= 5px）`)
  // 填充与轨道必须同高，否则视觉上错位
  assert.equal(fill[1], rail[1], '填充条与轨道高度必须一致')
})

test('slider: 样式注入必须替换旧标签（否则热更新后仍用旧 CSS）', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const start = source.indexOf('ctx.effect(() => {')
  assert.ok(start !== -1, '找不到样式注入的 ctx.effect')
  const end = source.indexOf('"dsh-codebuddy: styles"', start)
  assert.ok(end !== -1, '找不到样式注入的 effect 标签')
  const body = source.slice(start, end)

  // 曾经这里写的是「查到标签就直接 return」，于是插件重新挂载时新 CSS 被整段跳过：
  // 改了样式看不到变化，现象像"代码没生效"，实际是样式没换。
  assert.ok(
    !/querySelector\([^)]*\)\s*\)\s*return/.test(body),
    '不允许「标签已存在就提前 return」——必须替换旧标签，否则新 CSS 永远不生效'
  )
  assert.ok(
    /replaceWith\(/.test(body) || /removeChild\(/.test(body),
    '必须显式替换或移除旧样式标签'
  )
})

test('slider: 每档的呼吸窗口必须非零宽度，且相邻档首尾相接', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  const fn = extractFunction(source, 'effortGlowWindow')
  // eslint-disable-next-line no-new-func
  const glow = new Function(`return (${fn})`)()

  for (const last of [1, 2, 3, 4]) {
    const wins = []
    for (let i = 0; i <= last; i += 1) wins.push(glow(i, last))

    // ① 每档都要真的在呼吸（宽度 > 0）
    //    这里踩过真 bug：峰值写成 FLOOR+STEP*i 时首档宽度为 0，
    //    静态看数值都对，但首档纹丝不动。
    for (const [i, w] of wins.entries()) {
      assert.ok(
        w.lumHi - w.lumLo > 0.05,
        `lastIndex=${last} 第 ${i} 档窗口宽度只有 ${(w.lumHi - w.lumLo).toFixed(3)}，呼吸灯会静止`
      )
    }

    // ② 用户约束：下限 = 前一档的上限
    for (let i = 1; i <= last; i += 1) {
      assert.ok(
        Math.abs(wins[i].lumLo - wins[i - 1].lumHi) < 1e-9,
        `lastIndex=${last} 第 ${i} 档下限 ${wins[i].lumLo.toFixed(3)} 应等于前一档上限 ${wins[i - 1].lumHi.toFixed(3)}`
      )
    }

    // ③ 亮度随档位递增，且不越界
    for (let i = 0; i < last; i += 1) {
      assert.ok(
        wins[i + 1].lumHi > wins[i].lumHi,
        `lastIndex=${last} 档位越高上限应越高`
      )
    }
    assert.ok(wins[last].lumHi <= 1.3401, '最高档上限不得超过 CEIL')
    assert.ok(wins[0].lumLo >= 0.6199, '最低不得暗过 FLOOR')
  }
})

test('slider: 拖动路径不得把位置量化到档位格点（原生 range 的卡顿根源）', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  // 不能再出现原生 range 的 step 量化配置
  assert.ok(!/step:\s*1\s*,/.test(source) || !/type:\s*"range"/.test(source),
    '不应再用原生 input[type=range] 承载拖动位置 —— 它按 step 量化，必然一格一格跳')
  // pointermove 里必须是直接改 CSS 变量，而不是 setState
  const move = /pointermove[\s\S]{0,400}?\}\s*\)/.exec(source)
  assert.ok(move !== null, '找不到 pointermove 处理逻辑')
  assert.ok(
    /paintAt\(/.test(source) && /--cb-effort-pos/.test(source),
    '拖动必须通过写 --cb-effort-pos 直接改 DOM，不能走 React state'
  )
})

test('slider: 拖动中的 pointermove 处理不得调用 setState', () => {
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  // 抠出 onMove 的函数体
  const start = source.indexOf('const onMove = ')
  assert.ok(start !== -1, '找不到 onMove')
  const end = source.indexOf('const onUp = ', start)
  const body = source.slice(start, end)
  const offenders = ['setDragIndex', 'setSettling', 'setRevision'].filter((fn) => body.includes(fn))
  assert.deepEqual(
    offenders,
    [],
    `onMove 里出现了 ${offenders.join(', ')} —— 每帧 setState 会让拖动掉帧。` +
      '拖动期间只能改 CSS 变量，松手后再 setState。'
  )
})
