/**
 * 独立验证：复刻 fetchProductModels 的取数 + 字段映射逻辑，
 * 不依赖 @deepseek-ai/dsh-llm（宿主运行时才注入）。
 *
 * 目的只有一个：确认「GET /v3/config → 36 条 → 派生成本地模型条目」这条链路真的成立。
 * 运行： node plugins/dsh-codebuddy/test/verify-product-models.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PRODUCT_CONFIG_PATH = '/v3/config'
const PROBE_TIMEOUT_MS = 8000

const fp = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 10)

function loadAccount() {
  const p = join(homedir(), '.dsh', '.codebuddy-cli-accounts.json')
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  const accounts = raw.accounts ?? {}
  const first = (raw.activeId && accounts[raw.activeId]) || Object.values(accounts)[0]
  if (!first?.accessToken) throw new Error('no accessToken in accounts file')
  return { token: first.accessToken, uid: first.uid ?? '', domain: first.domain ?? '' }
}

// —— 以下与 lib/index.js 的 modelFromRemote 保持一致 ——
function friendlyName(id) {
  return id
}

function modelFromRemote(entry) {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
  if (!id) return null
  const ctxIn = Number(entry?.maxInputTokens)
  if (!Number.isFinite(ctxIn) || ctxIn <= 0) return null
  const outRaw = Number(entry?.maxOutputTokens)
  const maxTokens = Number.isFinite(outRaw) && outRaw > 0 ? outRaw : 8192
  const model = {
    id,
    name: typeof entry?.name === 'string' && entry.name ? entry.name : friendlyName(id),
    contextWindow: Math.min(ctxIn, 1000000),
    maxTokens
  }
  if (entry?.supportsImages === true) model.inputModalities = ['text', 'image']
  return model
}

function clientIdentityHeaders() {
  return {
    'user-agent': 'CLI/2.180.0 CodeBuddy/2.180.0',
    'x-ide-type': 'CLI',
    'x-ide-name': 'CLI',
    'x-ide-version': '2.180.0',
    'x-product': 'SaaS',
    'x-agent-intent': 'craft',
    'x-agent-runtime': 'other',
    'x-agent-type': 'main',
    'x-agent-purpose': 'conversation',
    'x-private-data': 'false',
    'x-codebuddy-request': '1',
    'x-requested-with': 'XMLHttpRequest'
  }
}

async function fetchProductModels(baseURL, key) {
  let origin
  try {
    origin = new URL(String(baseURL).replace(/\/+$/u, '')).origin
  } catch {
    return { error: `端点不是合法 URL：${baseURL}` }
  }
  const url = `${origin}${PRODUCT_CONFIG_PATH}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  let resp
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: {
        ...clientIdentityHeaders(),
        Authorization: `Bearer ${key}`,
        'X-API-Key': key,
        'X-Request-ID': crypto.randomUUID(),
        Accept: 'application/json'
      },
      signal: ctrl.signal
    })
  } catch (error) {
    return { error: `网络错误：${error?.message ?? error}` }
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    let text = ''
    try { text = (await resp.text()).slice(0, 200) } catch { /* ignore */ }
    return { error: `HTTP ${resp.status}${text ? `：${text}` : ''}` }
  }
  let payload
  try { payload = await resp.json() } catch { return { error: '响应不是合法 JSON' } }
  const code = payload?.code
  if (typeof code === 'number' && code !== 0) {
    return { error: `业务码 ${code}：${payload?.msg ?? ''}` }
  }
  const raw = payload?.data?.models
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: '清单为空或结构不符（data.models 缺失）' }
  }
  const models = []
  const seen = new Set()
  let skipped = 0
  for (const entry of raw) {
    const m = modelFromRemote(entry)
    if (!m) { skipped += 1; continue }
    if (seen.has(m.id)) continue
    seen.add(m.id)
    models.push(m)
  }
  if (models.length === 0) return { error: '清单里的条目全部不适用于对话模型' }
  return { models, stats: { url, raw: raw.length, usable: models.length, skipped } }
}

const acct = loadAccount()
console.log(`token sha256=${fp(acct.token)} len=${acct.token.length} domain=${acct.domain}\n`)

for (const baseURL of ['https://copilot.tencent.com/v2', 'https://www.codebuddy.cn/v2']) {
  const t0 = Date.now()
  const result = await fetchProductModels(baseURL, acct.token)
  const ms = Date.now() - t0
  console.log(`--- ${baseURL}  (${ms} ms) ---`)
  if (result.error) {
    console.log(`  error: ${result.error}\n`)
    continue
  }
  const { models, stats } = result
  console.log(`  url       = ${stats.url}`)
  console.log(`  raw=${stats.raw}  usable=${stats.usable}  skipped=${stats.skipped}`)
  const withImage = models.filter((m) => m.inputModalities?.includes('image')).length
  console.log(`  image 可用 = ${withImage}/${models.length}`)
  console.log('  前 10 条:')
  for (const m of models.slice(0, 10)) {
    console.log(
      `    ${m.id.padEnd(26)} ctx=${String(m.contextWindow).padEnd(8)}`
      + ` max=${String(m.maxTokens).padEnd(7)} ${(m.inputModalities ?? ['text']).join('+')}`
    )
  }
  console.log()
}
