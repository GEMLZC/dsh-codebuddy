/**
 * fetchProductModels / modelFromRemote 单测 —— 官方清单接口（GET /v3/config）。
 *
 * 不联网：fetch 全部替换成桩，只验证
 *   1. URL 由 baseURL 的 **origin** 派生（/v2 前缀必须被丢掉）
 *   2. 字段映射（maxInputTokens → contextWindow 等）
 *   3. 非对话模型（无 maxInputTokens / 视频模型）被跳过
 *   4. 失败路径都返回 { error } 而不抛（调用方据此降级探测）
 *   5. 缓存命中不再发请求
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  productConfigCache,
  fetchProductModels,
  modelFromRemote,
  PRODUCT_CONFIG_PATH,
  PRODUCT_CONFIG_TTL_MS
} from './_internal.mjs'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  productConfigCache.clear()
})

/** 装一个一次性的 fetch 桩，记录请求 URL。 */
function stubFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return calls
}

const jsonResponse = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
  text: async () => JSON.stringify(obj)
})

const SAMPLE = {
  code: 0,
  msg: 'OK',
  data: {
    models: [
      {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek-V4.1-Flash',
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
        supportsImages: true,
        supportsToolCall: true
      },
      {
        id: 'default',
        name: 'Default',
        maxInputTokens: 200000,
        maxOutputTokens: 24000,
        supportsImages: false
      },
      // 视频生成模型：没有 maxInputTokens，必须被剔除
      { id: 'kling-video-v3', name: 'Kling-Video-V3' },
      // 图片生成模型：同样没有 token 上限
      { id: 'hunyuan-image-alpha', name: 'Hunyuan Image Alpha' }
    ]
  }
}

describe('modelFromRemote', () => {
  it('把远端字段映射成本地模型条目', () => {
    const m = modelFromRemote({
      id: 'glm-5.3',
      name: 'GLM-5.3',
      maxInputTokens: 500000,
      maxOutputTokens: 64000,
      supportsImages: true
    })
    assert.deepEqual(m, {
      id: 'glm-5.3',
      name: 'GLM-5.3',
      contextWindow: 500000,
      maxTokens: 64000,
      inputModalities: ['text', 'image']
    })
  })

  it('contextWindow 按本机偏好 clamp 到 1M', () => {
    const m = modelFromRemote({ id: 'x', maxInputTokens: 4000000 })
    assert.equal(m.contextWindow, 1000000)
  })

  it('maxOutputTokens 缺失时回落到 8192', () => {
    const m = modelFromRemote({ id: 'x', maxInputTokens: 1000 })
    assert.equal(m.maxTokens, 8192)
  })

  it('supportsImages 不为 true 时不声明 image（保守，避免图片投影丢失）', () => {
    const m = modelFromRemote({ id: 'x', maxInputTokens: 1000, supportsImages: false })
    assert.equal(m.inputModalities, undefined)
  })

  it('无 maxInputTokens（视频/图片生成模型）返回 null', () => {
    assert.equal(modelFromRemote({ id: 'kling-video-v3' }), null)
    assert.equal(modelFromRemote({ id: 'x', maxInputTokens: 0 }), null)
    assert.equal(modelFromRemote({ id: 'x', maxInputTokens: 'abc' }), null)
  })

  it('空 id 返回 null', () => {
    assert.equal(modelFromRemote({ maxInputTokens: 1000 }), null)
    assert.equal(modelFromRemote(null), null)
  })
})

describe('fetchProductModels', () => {
  it('URL 从 baseURL 的 origin 派生，/v2 前缀被丢掉', async () => {
    const calls = stubFetch(() => jsonResponse(SAMPLE))
    await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `https://copilot.tencent.com${PRODUCT_CONFIG_PATH}`)
    assert.equal(calls[0].init.method, 'GET')
  })

  it('请求头带 Bearer 凭据与 CodeBuddy 客户端标识，且不带会触发拦截的 deepseek-harness UA', async () => {
    const calls = stubFetch(() => jsonResponse(SAMPLE))
    await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    const headers = calls[0].init.headers
    const lower = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    )
    assert.equal(lower.authorization, 'Bearer ck_test')
    assert.match(lower['user-agent'] ?? '', /CodeBuddy/u)
    assert.doesNotMatch(lower['user-agent'] ?? '', /deepseek-harness/iu)
    assert.equal(lower.accept, 'application/json')
  })

  it('解析清单并剔除非对话模型', async () => {
    stubFetch(() => jsonResponse(SAMPLE))
    const result = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    assert.equal(result.error, undefined)
    assert.equal(result.stats.raw, 4)
    assert.equal(result.stats.usable, 2)
    assert.equal(result.stats.skipped, 2)
    assert.deepEqual(result.models.map((m) => m.id), ['deepseek-v4.1-flash', 'default'])
  })

  it('业务码非 0 → 返回 error（交由调用方降级）', async () => {
    stubFetch(() => jsonResponse({ code: 11128, msg: 'request illegal' }))
    const result = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    assert.match(result.error, /11128/u)
  })

  it('HTTP 非 2xx → 返回 error', async () => {
    stubFetch(() => jsonResponse({}, 403))
    const result = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    assert.match(result.error, /HTTP 403/u)
  })

  it('data.models 缺失或为空 → 返回 error', async () => {
    stubFetch(() => jsonResponse({ code: 0, data: { models: [] } }))
    const r1 = await fetchProductModels('https://a.example/v2', 'k', { force: true })
    assert.match(r1.error, /清单为空/u)

    productConfigCache.clear()
    stubFetch(() => jsonResponse({ code: 0, data: {} }))
    const r2 = await fetchProductModels('https://a.example/v2', 'k', { force: true })
    assert.match(r2.error, /清单为空/u)
  })

  it('网络异常 → 返回 error 而不是抛出', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNRESET') }
    const result = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    assert.match(result.error, /ECONNRESET/u)
  })

  it('非法 URL → 返回 error', async () => {
    const result = await fetchProductModels('not-a-url', 'k', { force: true })
    assert.match(result.error, /合法 URL/u)
  })

  it('缓存命中后不再发第二次请求', async () => {
    const calls = stubFetch(() => jsonResponse(SAMPLE))
    const first = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    assert.equal(first.stats.cached, false)
    const second = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test')
    assert.equal(calls.length, 1, '第二次必须命中缓存')
    assert.equal(second.stats.cached, true)
    assert.deepEqual(second.models.map((m) => m.id), first.models.map((m) => m.id))
  })

  // 回归守卫：缓存分支曾漏回放 url / usable，导致调用方拼出 "GET undefined 返回 undefined 条"
  it('缓存命中的 stats 字段与首次一致（url/raw/usable/skipped 都要在）', async () => {
    stubFetch(() => jsonResponse(SAMPLE))
    const first = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    const second = await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test')
    for (const field of ['url', 'raw', 'usable', 'skipped']) {
      assert.notEqual(second.stats[field], undefined, `缓存分支缺 stats.${field}`)
      assert.equal(second.stats[field], first.stats[field], `stats.${field} 缓存前后不一致`)
    }
    assert.equal(second.stats.url, `https://copilot.tencent.com${PRODUCT_CONFIG_PATH}`)
  })

  it('force 绕过缓存', async () => {
    const calls = stubFetch(() => jsonResponse(SAMPLE))
    await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    await fetchProductModels('https://copilot.tencent.com/v2', 'ck_test', { force: true })
    assert.equal(calls.length, 2)
  })

  it('换密钥不命中缓存（不同凭据可能是不同账号的目录）', async () => {
    const calls = stubFetch(() => jsonResponse(SAMPLE))
    await fetchProductModels('https://copilot.tencent.com/v2', 'ck_a', { force: true })
    await fetchProductModels('https://copilot.tencent.com/v2', 'ck_b', { force: true })
    assert.equal(calls.length, 2)
  })

  it('TTL 与客户端自身缓存一致（480s）', () => {
    assert.equal(PRODUCT_CONFIG_TTL_MS, 480 * 1000)
  })
})
