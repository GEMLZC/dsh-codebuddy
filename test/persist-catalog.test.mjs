/**
 * 目录落盘 / 回灌测试 —— 零网络、零额度。
 *
 * ── 为什么需要这条测试 ──────────────────────────────────────────
 * 用户的原始症状是「重启后模型列表又变回原来的样子」。根因是 discoveredModels
 * 只活在本进程内存里：点过「获取模型」→ 选择器有了新模型 → 重启 → 全部消失。
 *
 * 修法是把目录写到 `$DSH_HOME/codebuddy-models.json` 并在 apply() 时回灌。
 * 这条测试守的就是**这条链路本身**，因为它是纯副作用、且失败时完全静默：
 * 落盘失败只是少一次持久化，回灌失败只是少几个模型，全程不报错。
 *
 * ── 覆盖的四条边界 ─────────────────────────────────────────────
 *   ① 落盘内容只含模型元数据 + baseURL（**不含密钥指纹**）
 *   ② 端点一致才回灌
 *   ③ 端点不同则不回灌（换了端点不能串味）
 *   ④ 损坏的 JSON 不炸进程
 *
 * dsh-llm 只在 app 目录里可解析，所以用 NODE_PATH 指过去；解析不到就跳过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const APP_PACKAGES = join('E:', 'ds', 'harness', 'resources', 'app', 'dsh', 'node_modules')

/**
 * 探测本文件能否加载插件模块。
 *
 * 两个关卡都要过：
 *   ① `@deepseek-ai/dsh-llm` 可解析（ESM 不认 NODE_PATH，所以必须在插件目录里
 *      有 node_modules —— 开发时先 `mklink /J node_modules app/node_modules`）；
 *   ② 模块能真的 import 成功。
 *
 * 任一失败 → 整组 skip 并说明原因，绝不假绿。
 */
let pluginTest = null
let skip = false
try {
  if (!existsSync(join(APP_PACKAGES, '@deepseek-ai', 'dsh-llm', 'lib', 'index.js'))) {
    throw new Error('本机找不到 @deepseek-ai/dsh-llm（app 目录）')
  }
  const { default: Module } = await import('node:module')
  Module._initPaths()
  pluginTest = (await import('../lib/index.js')).__test__
} catch (error) {
  pluginTest = null
  skip = `${error?.message ?? error}；跳过落盘测试` +
    '（ESM 不认 NODE_PATH，需在插件目录建 node_modules 链接后重跑）'
}

/** 取插件测试出口；skip 时抛错而不是静默通过。 */
function needPlugin() {
  if (!pluginTest) throw new Error('plugin not loaded: ' + String(skip))
  return pluginTest
}

/** 建一个隔离的 DSH_HOME，返回目录与清理函数。 */
function sandboxHome() {
  const dir = mkdtempSync(join(tmpdir(), 'cb-catalog-'))
  return { dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } } }
}


test('catalog: 落盘只写 baseURL + 模型元数据，绝不写密钥指纹', { skip }, async () => {
  const { dir, cleanup } = sandboxHome()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const t = needPlugin()
    t.discoveredModels.clear()
    const known = new Map([
      ['m-a', { id: 'm-a', name: 'Model A', contextWindow: 500000, maxTokens: 4096, inputModalities: ['text', 'image'] }],
      ['m-b', { id: 'm-b', name: 'Model B', contextWindow: 1000000, maxTokens: 8192 }]
    ])
    t.rememberDiscovered(['m-a', 'm-b'], known)

    t.persistCatalog('https://copilot.tencent.com/v2', 'product-config')

    const file = join(dir, 'codebuddy-models.json')
    assert.ok(existsSync(file), '必须写到 $DSH_HOME/codebuddy-models.json')

    const raw = readFileSync(file, 'utf8')
    const doc = JSON.parse(raw)
    assert.equal(doc.version, 1)
    assert.equal(doc.baseURL, 'https://copilot.tencent.com/v2')
    assert.equal(doc.models.length, 2)

    // 语义边界：指纹是 sha256 前 16 位十六进制；落盘里不该出现任何 16 位十六进制串
    assert.equal(/[0-9a-f]{16}/u.test(raw), false, '落盘文件里不得出现密钥指纹形态的串')
    for (const key of Object.keys(doc)) {
      assert.ok(['version', 'baseURL', 'savedAt', 'source', 'models'].includes(key),
        `落盘多出了未预期字段：${key}`)
    }
    // 模型条目也只允许 listModels() 会消费的字段
    const allowed = ['id', 'name', 'contextWindow', 'maxTokens', 'inputModalities']
    for (const m of doc.models) {
      for (const key of Object.keys(m)) assert.ok(allowed.includes(key), `模型字段越界：${key}`)
    }
    assert.deepEqual(doc.models.find((m) => m.id === 'm-a').inputModalities, ['text', 'image'])
  } finally {
    process.env.DSH_HOME = prevHome
    cleanup()
  }
})

test('catalog: 端点一致才回灌，回灌后 listModels 立刻含新模型', { skip }, async () => {
  const { dir, cleanup } = sandboxHome()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const t = needPlugin()
    t.discoveredModels.clear()
    t.persistCatalog('https://copilot.tencent.com/v2', 'product-config')
    // 空目录不落盘 → 先塞一条再重落
    t.rememberDiscovered(['only-model'], new Map())
    t.persistCatalog('https://copilot.tencent.com/v2', 'product-config')

    // 模拟进程重启：清空内存，再从磁盘回灌
    t.discoveredModels.clear()
    const ok = t.hydratePersistedCatalog('https://copilot.tencent.com/v2')
    assert.equal(ok, true, '端点一致时必须回灌')
    assert.ok(t.discoveredModels.has('only-model'), '回灌后内存里必须有该模型')

    const merged = t.mergeModels([])
    assert.ok(merged.some((m) => m.id === 'only-model'), 'mergeModels 必须把它并进目录')
  } finally {
    process.env.DSH_HOME = prevHome
    cleanup()
  }
})

test('catalog: 端点不同（换了 baseURL）时不回灌', { skip }, async () => {
  const { dir, cleanup } = sandboxHome()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const t = needPlugin()
    t.discoveredModels.clear()
    t.rememberDiscovered(['cn-only'], new Map())
    t.persistCatalog('https://copilot.tencent.com/v2', 'product-config')

    t.discoveredModels.clear()
    const ok = t.hydratePersistedCatalog('https://www.codebuddy.ai/v2')
    assert.equal(ok, false, '端点不同必须拒绝回灌（否则旧端点的模型会被并进新端点，选中即 400）')
    assert.equal(t.discoveredModels.size, 0)
  } finally {
    process.env.DSH_HOME = prevHome
    cleanup()
  }
})

test('catalog: 损坏 / 缺失 / 版本不符的文件一律不炸，只是不回灌', { skip }, async () => {
  const { dir, cleanup } = sandboxHome()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const t = needPlugin()
    const file = join(dir, 'codebuddy-models.json')
    const base = 'https://copilot.tencent.com/v2'

    // ① 文件不存在
    t.discoveredModels.clear()
    assert.equal(t.hydratePersistedCatalog(base), false)

    // ② 非法 JSON
    writeFileSync(file, '{ this is not json', 'utf8')
    assert.equal(t.hydratePersistedCatalog(base), false)

    // ③ 版本不符
    writeFileSync(file, JSON.stringify({ version: 99, baseURL: base, models: [{ id: 'x' }] }), 'utf8')
    assert.equal(t.hydratePersistedCatalog(base), false)

    // ④ models 为空数组
    writeFileSync(file, JSON.stringify({ version: 1, baseURL: base, models: [] }), 'utf8')
    assert.equal(t.hydratePersistedCatalog(base), false)

    // ⑤ 正常内容 → true
    writeFileSync(file, JSON.stringify({
      version: 1, baseURL: base, models: [{ id: 'ok', name: 'OK', contextWindow: 1000, maxTokens: 100 }]
    }), 'utf8')
    assert.equal(t.hydratePersistedCatalog(base), true)
    assert.ok(t.discoveredModels.has('ok'))
  } finally {
    process.env.DSH_HOME = prevHome
    cleanup()
  }
})

test('catalog: clearPersistedCatalog 删得掉且二次调用不抛', { skip }, async () => {
  const { dir, cleanup } = sandboxHome()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const t = needPlugin()
    t.discoveredModels.clear()
    t.rememberDiscovered(['gone'], new Map())
    t.persistCatalog('https://copilot.tencent.com/v2', 'probe')
    assert.ok(existsSync(join(dir, 'codebuddy-models.json')))

    t.clearPersistedCatalog()
    assert.equal(existsSync(join(dir, 'codebuddy-models.json')), false, '必须删掉')
    t.clearPersistedCatalog() // 文件已不存在 → 不得抛
  } finally {
    process.env.DSH_HOME = prevHome
    cleanup()
  }
})

