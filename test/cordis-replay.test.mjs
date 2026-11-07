// 真 cordis 回放：把 lib/client.js 原样挂到 dsh 自带的那份 cordis 上，
// 用真实的 fiber / inject 校验，而不是只做字符串匹配。
//
// 存在理由：v1.1.7 的拖动条「界面上完全不出现」，链条是
//
//   ModelDirectoryResolver.directoryFor() 读 this.ctx.remote.session
//     → cordis 的 Service tracker（associate: 服务名）把 `remote.session`
//       当成**服务名**去 ctx.reflect.props 里找
//     → 于是这一读的 inject 校验用的是**调用方 fiber**
//     → 插件 inject 少写 "remote.session" → cordis 直接抛
//        `cannot get property "remote.session" without inject`
//     → 异常落进 inject 回调的 try/catch → {available:false}
//     → slots.register 里画出来的是 null → DOM 里一个节点都没有
//
// 纯字符串测试守不住这条链（前三次诊断都跑偏了），所以这里让 cordis 自己说话。
//
// 依赖本机能找到 dsh 安装目录里的 @deepseek-ai/cordis；找不到就跳过并说明，
// 不静默通过。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname

/**
 * 找 `@deepseek-ai/cordis`。三种来源，按可靠度排：
 *
 * 1. **裸包名** —— CI 会 `npm i -D @deepseek-ai/cordis@4.0.5`（公开 npm 上有，和
 *    DSH app 内置的同一代），这条在 CI 稳定命中；
 * 2. `DSH_CORDIS_PATH` 环境变量 —— 本地没有 node_modules 时指到 DSH 安装目录里那份：
 *    `DSH_CORDIS_PATH="<dsh app>/node_modules/@deepseek-ai/cordis/lib/index.js" node --test "test/*.test.mjs"`
 * 3. `~/.dsh/profiles/<profile>/node_modules/...` —— 插件被装进 profile 时自然命中。
 *
 * 全都没有 → **跳过**（不是通过），并在跳过原因里写清怎么指路。
 * 之前这里硬编码了本机两个绝对路径，写进仓库既脏又只在一台机器上有效。
 */
function profileCordisPaths() {
  const profiles = join(homedir(), '.dsh', 'profiles')
  if (!existsSync(profiles)) return []
  return readdirSync(profiles)
    .map((name) => join(profiles, name, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'))
    .filter((candidate) => existsSync(candidate))
}

async function loadCordis() {
  try {
    return { cordis: await import('@deepseek-ai/cordis'), source: '@deepseek-ai/cordis' }
  } catch {}
  const explicit = process.env.DSH_CORDIS_PATH
  const candidates = explicit === undefined ? profileCordisPaths() : [explicit, ...profileCordisPaths()]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      return { cordis: await import(pathToFileURL(candidate).href), source: candidate }
    } catch {}
  }
  return null
}

/**
 * 这套回放模型依赖 cordis 的 `Service` tracker 语义：读 `svc.a.b` 时，若
 * `ctx.reflect.props["a.b"]` 存在，就把它当**服务名**解析（associate）。
 *
 * 该语义在 cordis 4.0.x 上成立；万一换到不成立的那一版，回放测试的结论就没意义了
 * —— 这时必须是「跳过」而不是「红」，所以先探一下再决定跑不跑。
 */
async function hasAssociateSemantics(cordis) {
  const { Context, Service } = cordis
  const root = new Context()
  let observed
  await root.plugin({
    name: 'probe-provider',
    inject: [],
    apply(ctx) {
      ctx.provide('probe.target', { from: 'service' })
      class Probe extends Service {
        static inject = []
      }
      const service = new Probe(ctx, 'probe')
      service.target = 'instance'
    },
  })
  await root.plugin({
    name: 'probe-consumer',
    inject: ['probe'],
    apply(ctx) {
      try {
        observed = ctx.probe.target
      } catch (error) {
        observed = 'threw:' + String((error && error.message) || error)
      }
    },
  })
  return typeof observed === 'string' && observed.startsWith('threw:') && observed.includes('probe.target')
}

const loaded = await loadCordis()
const hasAssociate = loaded === null ? null : await hasAssociateSemantics(loaded.cordis)
const skipReason = loaded === null
  ? '找不到 @deepseek-ai/cordis：CI 装 @deepseek-ai/cordis@4.0.5，或设 DSH_CORDIS_PATH 指向 DSH 安装目录里的 lib/index.js'
  : hasAssociate
    ? false
    : '这份 cordis 没有 Service.associate 语义（版本差异），回放模型不适用'

/** 极简 DOM：插件只用到 createElement / head.appendChild / querySelector。 */
function stubDocument() {
  const head = []
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({
      dataset: {},
      textContent: '',
      remove() {},
    }),
    head: {
      appendChild(node) {
        head.push(node)
      },
    },
  }
  return head
}

/** 载入插件源码，返回 { apply, inject }。 */
function loadPlugin(transform) {
  let source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  if (transform !== undefined) {
    const next = transform(source)
    assert.notEqual(next, source, '源码变换没有生效（正则失配），否则负向用例会假通过')
    source = next
  }
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: {
      load({ factory }) {
        captured = factory
      },
    },
  }
  const fakeRequire = (name) => {
    if (name === 'react') {
      return {
        createElement: () => null,
        useState: () => [undefined, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
        useRef: () => ({ current: undefined }),
        useMemo: (fn) => fn(),
        useSyncExternalStore: () => undefined,
      }
    }
    throw new Error('unexpected require: ' + name)
  }
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'module', 'exports', 'require', source)
  const mod = { exports: {} }
  run(fakeWindow, mod, mod.exports, fakeRequire)
  if (captured === null) throw new Error('插件没有调用 window.__ModuleLoader__.load')
  const exports = captured(fakeRequire)
  assert.equal(typeof exports.apply, 'function', '插件必须导出 apply')
  assert.ok(Array.isArray(exports.inject), '插件必须导出 inject 数组')
  return exports
}

/**
 * 按 dsh 的真实形状搭一个最小宿主：
 *
 * ⚠️ 服务必须由**另一个插件 fiber**（root 的子节点）提供，不能直接 provide 到 root 上。
 * 原因在 cordis 的解析顺序（lib/index.js 的 reflect.handler.get）：
 *
 *   1. 沿 fiber 链往上找 `fiber.store[prop]`；
 *   2. `fiber.inject` 里有这个名字但当前 fiber 未激活 → 抛 "inactive context"；
 *   3. 走到 root（无 runtime）还找不到 → 抛 `cannot get property "X" without inject`。
 *
 * 而 `ctx.provide` 只写**自己的** fiber.store，跨插件靠 Inject 把 impl 复制进
 * 消费方 fiber 的 `_store`（`_checkImpl`）。所以服务挂在兄弟 fiber 上时，
 * inject 声明就是能否看见它的**唯一**通道 —— 这才是线上真实拓扑。
 * 之前把服务直接 provide 到 root，任何 fiber 都能沿链找到，负向用例就假通过了。
 */
async function mountHost(cordis, plugin) {
  const { Context, Service } = cordis
  const root = new Context()

  const registrations = []

  await root.plugin({
    name: 'host-fixture',
    inject: [],
    apply(hostCtx) {
      hostCtx.provide('slots', {
        inject(name, callback) {
          callback()
          return () => {}
        },
        register(options, Component) {
          registrations.push({ options, Component })
          return () => {}
        },
      })
      hostCtx.provide('locale', { current: 'zh-CN', t: (key) => key })
      hostCtx.provide('sessions', { subagentAddress: () => undefined })
      hostCtx.provide('remote.session', { modelCatalog: async () => ({ models: [] }) })

      class Remote extends Service {
        static inject = []
        session = { modelCatalog: async () => ({ models: [] }) }
      }
      new Remote(hostCtx, 'remote')

      class ModelDirectories extends Service {
        static inject = ['sessions', 'remote', 'remote.session']
        directoryFor(sessionId) {
          // 关键一行：与官方 ModelDirectoryResolver 完全同形
          const sessionApi = this.ctx.remote.session
          if (sessionApi === undefined) throw new Error('no remote.session')
          return {
            store: { sessionId, snapshot: {} },
            load: async () => ({ groups: [] }),
            select: async () => {},
          }
        }
      }
      new ModelDirectories(hostCtx, 'modelDirectories')
    },
  })

  await root.inject(plugin.inject, plugin.apply)
  return { root, registrations }
}

test(
  'cordis 回放：真实 fiber 下槽位必须注册成功，且 inject() 返回 available',
  { skip: skipReason },
  async () => {
    stubDocument()
    const cordis = loaded.cordis
    const plugin = loadPlugin()
    const { registrations } = await mountHost(cordis, plugin)

    const names = registrations.map((r) => r.options.name)
    assert.ok(
      names.includes('conversation.input.right'),
      'conversation.input.right 必须注册；实际注册了 [' + names.join(', ') + ']'
    )
    const slot = registrations.find((r) => r.options.name === 'conversation.input.right')

    const result = slot.options.inject('session-1')
    assert.equal(
      result.available,
      true,
      'inject("session-1") 必须 available —— 否则组件渲染成 null，界面上什么都没有'
    )
    assert.equal(result.directory.sessionId, 'session-1')
    assert.equal(typeof result.load, 'function')
    assert.equal(typeof result.select, 'function')
  }
)

test(
  'cordis 回放：作用域漏声明 remote.session 必须复现「注册不上」——证明上面的测试有敏感度',
  { skip: skipReason },
  async () => {
    stubDocument()
    const cordis = loaded.cordis
    // 复刻 v1.1.7 的现场：两处 inject 都没有 remote / remote.session。
    //
    // 两处都得去掉：`models` 是 `scope.modelDirectories` 读出来的 traceable 代理，
    // 它把作用域 ctx 捕获进去了（槽位回调时沿用它），所以作用域那份是决定性的；
    // 但顶层也声明的话，作用域 fiber 的父链上仍有 impl，能兜住错误 —— 假通过。
    const plugin = loadPlugin((source) =>
      source
        .replace(
          'const inject = ["slots", "locale", "sessions", "remote", "remote.session"]',
          'const inject = ["slots", "locale", "sessions", "remote"]'
        )
        .replace(
          'ctx.inject(["slots", "modelDirectories", "sessions", "remote", "remote.session"]',
          'ctx.inject(["slots", "modelDirectories", "sessions", "remote"]'
        )
    )
    const { registrations } = await mountHost(cordis, plugin)

    const slot = registrations.find((r) => r.options.name === 'conversation.input.right')
    assert.ok(slot !== undefined, '槽位本身还是会注册（异常在 inject 回调里，不在 register）')
    const result = slot.options.inject('session-1')
    assert.equal(
      result.available,
      false,
      '这正是线上症状：inject 抛错被 catch 成 {available:false}'
    )
  }
)
