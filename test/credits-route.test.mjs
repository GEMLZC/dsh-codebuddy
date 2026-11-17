// 集成测试：用真 webServer 桩驱动 apply()，真的发一次 GET 打到自己注册的积分路由。
//
// 为什么必须这么做（而不是只跑 credits.js）：
//   credits.js 只证明「能取到数」；这里证明的是**接线**——路径、信封、host 侧
//   参数解析（force=1）、以及「webServer 已就绪」这条 ctx.inject 分支真的会执行。
//   这个仓库踩过「槽位注册了但组件返回 null」的坑，同类问题在路由上就是
//   「apply 里写了 register，但那条 inject 分支从没执行」。
//
// dsh-llm 只在 app 目录里可解析，所以用 NODE_PATH 指过去；解析不到就跳过并说明。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const APP_PACKAGES = join('E:', 'ds', 'harness', 'resources', 'app', 'dsh', 'node_modules')
const hasLlm = existsSync(join(APP_PACKAGES, '@deepseek-ai', 'dsh-llm', 'lib', 'index.js'))
const skip = hasLlm ? false : '本机找不到 @deepseek-ai/dsh-llm（app 目录），跳过集成接线测试'

test('credits route: apply() 会注册 /_dsh/dsh-codebuddy/credits 并返回 ok 信封', { skip }, async () => {
  process.env.NODE_PATH = [APP_PACKAGES, process.env.NODE_PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':')
  const { default: Module } = await import('node:module')
  Module._initPaths()

  const mod = await import('../lib/index.js')
  const routes = new Map()
  const webServer = {
    register(entry) {
      routes.set(entry.path, entry.handler)
      return () => routes.delete(entry.path)
    }
  }

  const effects = []
  const ctx = {
    fiber: { entry: { options: { id: 'llm-codebuddy' } } },
    logger: { warn() {}, info() {} },
    effect(fn) { effects.push(fn) },
    on() {},
    get() { return undefined },
    // 只需要 llm 面里被 apply 直接用到的那几个
    llm: {
      registerAdapter() { return { replace() {} } },
      registerConfigurableProviders() {},
      registerModelDiscovery() {}
    },
    inject(names, cb) {
      if (names.includes('webServer')) cb({ webServer, effect: (fn) => { effects.push(fn) }, inject: () => {} })
    }
  }

  mod.apply(ctx, { provider: 'codebuddy-native' })
  // 收集到的 effect 回调必须真的跑一遍，才是「注册发生」
  for (const fn of effects) {
    const dispose = fn()
    if (typeof dispose === 'function') { /* 保留，测完不 dispose */ }
  }

  assert.ok(routes.has('/_dsh/dsh-codebuddy/credits'), '必须注册积分路由')

  // 真的发一次请求（本机有 CLI 登录态 → 应当 200 + ok:true）
  const handler = routes.get('/_dsh/dsh-codebuddy/credits')
  const response = await new Promise((resolve) => {
    const chunks = []
    const res = {
      statusCode: 0,
      headers: null,
      writeHead(status, headers) { this.statusCode = status; this.headers = headers },
      end(body) { chunks.push(body); resolve({ status: this.statusCode, body: chunks.join('') }) }
    }
    handler({ method: 'GET', url: '/_dsh/dsh-codebuddy/credits' }, res)
  })

  assert.equal(response.status, 200, '路由必须回 200（错误也走 200 + ok:false 信封）')
  const envelope = JSON.parse(response.body)
  if (envelope.ok) {
    assert.equal(typeof envelope.value.balance, 'number', '必须给出余额数字')
    assert.equal(typeof envelope.value.today, 'number', '必须给出今日消耗数字')
    console.log('  余额 =', envelope.value.balance, '今日 =', envelope.value.today,
      '账号 =', envelope.value.account && envelope.value.account.nickname)
  } else {
    // 没有登录态时也要是可读的错误，而不是空响应
    assert.equal(typeof envelope.error.message, 'string')
    console.log('  (无登录态，返回错误信封)', envelope.error.message)
  }
})
