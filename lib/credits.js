/**
 * dsh-codebuddy — 积分读数（host 半）
 *
 * 给底栏那颗积分胶囊供数的只读模块。两个**都不扣积分**的计费查询：
 *
 *   POST https://www.codebuddy.cn/billing/meter/get-user-resource-summary
 *        body {}
 *        -> data.TotalCredits            "5784.29000627"   ← 当前剩余总积分
 *           data.SubscriptionPackageName "标准版"
 *           data.CreditGroups[]          { Kind, CycleRemainCapacity, ... }
 *
 *   POST https://www.codebuddy.cn/billing/meter/get-user-request-usage
 *        body { startTime, endTime, pageNum, pageSize }
 *        -> data.total                    当天请求条数
 *           data.data[].credit            每条请求扣掉的积分（可带小数）
 *
 * 两点必须说清（都是实测结论，不是推测）：
 *
 *   ① 路径**没有** `/v2` 前缀。
 *      `dsh-connect-workbuddy` 读余额走的是 `/v2/billing/meter/get-user-resource`，
 *      但同一个 host 上 `/billing/meter/get-user-resource-summary` 才是汇总口径，
 *      而 `/v2/...-summary` 实测 404。两者不是同一条路由的两个版本。
 *
 *   ② `get-user-resource` 的 `CapacityRemain` 是**逐包**口径，且会把已过期
 *      （Status=3）的包一起返回，自己求和会把作废的积分算进余额。汇总接口
 *      直接给 TotalCredits，不必也不该自己加。
 *
 * 凭据来源（按优先级，逐条试到能答 200 为止）：
 *   1. `$DSH_HOME/.codebuddy-cli-accounts.json` 的 activeId —— 即 CodeBuddy CLI 的登录态
 *   2. `$DSH_HOME/workbuddy-vault/{cn,global}/*.json` 的 auth.accessToken
 *
 * 401 时若这条凭据带 refreshToken，就在**内存里**换一次再试一次；不写回 vault，
 * 避免和 dsh-connect-workbuddy / dsh-model-meta 抢同一份文件的写权。
 *
 * 浏览器侧永远拿不到 token：这里只暴露一个聚合后的 JSON。
 *
 * @module dsh-codebuddy/credits
 */

import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 与 dsh-codebuddy 适配器同一套客户端自称（计费域也认这几个头）。 */
const CLIENT_UA = 'CLI/2.180.0 CodeBuddy/2.180.0'
const CN_BILLING_BASE = 'https://www.codebuddy.cn'
const GLOBAL_BILLING_BASE = 'https://www.workbuddy.ai'
const CN_REFRESH = 'https://copilot.tencent.com/v2/plugin/auth/token/refresh'
const GLOBAL_REFRESH = 'https://www.workbuddy.ai/v2/plugin/auth/token/refresh'

/** 单条上游请求的超时：设置页/底栏读数不能因为一条悬挂请求一直转圈。 */
const REQUEST_TIMEOUT_MS = 8000
/** 读数缓存：积分动得慢，底栏每 5 分钟刷一次就够，别把只读接口当心跳打。 */
const CACHE_TTL_MS = 60 * 1000
/** request-usage 一页最多 1000 条（实测），翻页上限防止把一天几万条拉爆。 */
const PAGE_SIZE = 1000
const MAX_PAGES = 20

const state = {
  cached: null,
  cachedAt: 0,
  inflight: null,
  lastError: null
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function billingBase(domain) {
  return typeof domain === 'string' && /workbuddy\.ai|codebuddy\.ai/iu.test(domain)
    ? GLOBAL_BILLING_BASE
    : CN_BILLING_BASE
}

function headersFor(credential) {
  const base = billingBase(credential.domain)
  const headers = {
    Authorization: `Bearer ${credential.accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Client-Platform': 'web',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': CLIENT_UA,
    Origin: base,
    Referer: `${base}/`
  }
  if (credential.uid) headers['X-User-Id'] = credential.uid
  if (credential.domain) headers['X-Domain'] = credential.domain
  return headers
}

/** 读 CodeBuddy CLI 的登录态（`accounts[activeId]`），读不到就返回空数组。 */
async function readCliAccounts() {
  const path = join(dshHome(), '.codebuddy-cli-accounts.json')
  let raw
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return []
  }
  const active = raw && raw.accounts ? raw.accounts[raw.activeId] : undefined
  const out = []
  if (active && typeof active.accessToken === 'string' && active.accessToken.length > 0) {
    out.push({
      source: 'codebuddy-cli',
      nickname: typeof active.nickname === 'string' ? active.nickname : '',
      accessToken: active.accessToken,
      refreshToken: typeof active.refreshToken === 'string' ? active.refreshToken : undefined,
      expiresAtMs: typeof active.expiresAtMs === 'number' ? active.expiresAtMs : 0,
      uid: typeof active.uid === 'string' ? active.uid : '',
      domain: typeof active.domain === 'string' ? active.domain : ''
    })
  }
  return out
}

/** 读 WorkBuddy / CodeBuddy 桌面端的凭据库（每个区域可能各有一个账号）。 */
async function readVaultAccounts() {
  const root = join(dshHome(), 'workbuddy-vault')
  const out = []
  for (const region of ['cn', 'global']) {
    const dir = join(root, region)
    let files
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      let record
      try {
        record = JSON.parse(await readFile(join(dir, file), 'utf8'))
      } catch {
        continue
      }
      const auth = record?.auth
      if (typeof auth?.accessToken !== 'string' || auth.accessToken.length === 0) continue
      out.push({
        source: `workbuddy-vault:${region}`,
        nickname: typeof record?.account?.nickname === 'string' ? record.account.nickname : '',
        accessToken: auth.accessToken,
        refreshToken: typeof auth.refreshToken === 'string' ? auth.refreshToken : undefined,
        // vault 里 expiresAt 是**秒**，CLI 那份是毫秒 —— 这里统一成毫秒再比大小。
        expiresAtMs: typeof auth.expiresAt === 'number'
          ? (auth.expiresAt > 1e12 ? auth.expiresAt : auth.expiresAt * 1000)
          : 0,
        uid: typeof record?.account?.uid === 'string' ? record.account.uid : '',
        domain: typeof auth.domain === 'string' ? auth.domain : (region === 'global' ? 'www.workbuddy.ai' : 'www.codebuddy.cn'),
        region
      })
    }
  }
  return out
}

/** CLI 登录态优先：它就是本机 DSH 正在用来调模型的账号。 */
async function candidates() {
  const [cli, vault] = await Promise.all([readCliAccounts(), readVaultAccounts()])
  return [...cli, ...vault]
}

async function postJson(path, credential, body) {
  const response = await fetch(billingBase(credential.domain) + path, {
    method: 'POST',
    headers: headersFor(credential),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  return { status: response.status, ok: response.ok, payload }
}

/**
 * 401 时在内存里换一次 token（不落盘）。
 *
 * 换成功就只改这一份内存凭据：vault 文件同时被 dsh-connect-workbuddy 与
 * dsh-model-meta 读写，多写一份就多一次互相覆盖的机会；而这里只需要撑过
 * 这一次读数。
 */
async function refreshInMemory(credential) {
  if (!credential.refreshToken) return null
  const base = /global/u.test(credential.source) ? GLOBAL_REFRESH : CN_REFRESH
  try {
    const response = await fetch(base, {
      method: 'POST',
      headers: {
        ...headersFor(credential),
        'X-Refresh-Token': credential.refreshToken,
        'X-Auth-Refresh-Source': 'workbuddy'
      },
      body: JSON.stringify({ refreshToken: credential.refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) return null
    const payload = await response.json()
    const data = payload?.data ?? payload
    const accessToken = data?.accessToken ?? data?.access_token
    if (typeof accessToken !== 'string' || accessToken.length === 0) return null
    return {
      ...credential,
      accessToken,
      refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : credential.refreshToken
    }
  } catch {
    return null
  }
}

/** 调一条只读接口；401 就换 token 重试一次，其它失败直接抛。 */
async function callWithCredential(credential, path, body) {
  let answer = await postJson(path, credential, body)
  if (answer.status === 401) {
    const renewed = await refreshInMemory(credential)
    if (renewed !== null) {
      const retry = await postJson(path, renewed, body)
      if (retry.ok) return retry
      answer = retry
    }
  }
  if (!answer.ok) {
    const code = answer.payload && typeof answer.payload.code === 'number' ? answer.payload.code : undefined
    const message = answer.payload && typeof answer.payload.msg === 'string' ? answer.payload.msg : ''
    const error = new Error(`http ${answer.status}${code === undefined ? '' : ` code ${code}`}${message ? ` ${message}` : ''}`)
    error.status = answer.status
    throw error
  }
  return answer
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** 当天 00:00:00 ~ 23:59:59（**本机时区**：上游按这个字符串切日，不给时区）。 */
function dayRange(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return { startTime: `${ymd} 00:00:00`, endTime: `${ymd} 23:59:59`, day: ymd }
}

/** 剩余总积分 + 套餐名。 */
async function fetchBalance(credential) {
  const answer = await callWithCredential(credential, '/billing/meter/get-user-resource-summary', {})
  const data = answer.payload?.data ?? {}
  const total = toNumber(data.TotalCredits)
  if (total === null) throw new Error('余额响应里没有可读的 TotalCredits')
  const groups = Array.isArray(data.CreditGroups)
    ? data.CreditGroups.map((group) => ({
        kind: typeof group?.Kind === 'string' ? group.Kind : '',
        name: typeof group?.Name === 'string' ? group.Name : '',
        remain: toNumber(group?.CycleRemainCapacity),
        total: toNumber(group?.CycleTotalCapacity)
      }))
    : []
  return {
    total,
    plan: typeof data.SubscriptionPackageName === 'string' ? data.SubscriptionPackageName : '',
    paid: data.IsPaidUser === true,
    groups
  }
}

/**
 * 今天累计消耗的积分。
 *
 * 逐条累加 `credit` 而不是拿 `total`（条数）当答案：一条请求的 credit 是
 * 0.45 / 0.42 这种小数，积分账要么精确到分位、要么别显示。
 */
async function fetchTodayUsage(credential, now = new Date()) {
  const range = dayRange(now)
  let page = 1
  let rows = 0
  let total = 0
  let sum = 0
  let truncated = false
  while (page <= MAX_PAGES) {
    const answer = await callWithCredential(credential, '/billing/meter/get-user-request-usage', {
      startTime: range.startTime,
      endTime: range.endTime,
      pageNum: page,
      pageSize: PAGE_SIZE
    })
    const data = answer.payload?.data ?? {}
    const list = Array.isArray(data.data) ? data.data : []
    const reported = toNumber(data.total)
    if (reported !== null) total = reported
    for (const row of list) {
      const credit = toNumber(row?.credit)
      if (credit !== null) sum += credit
    }
    rows += list.length
    // 已拿满 / 拿空 / 到底 → 停。`total` 缺失时按「本页不满」判断到底。
    if (list.length === 0) break
    if (total > 0 && rows >= total) break
    if (total === 0 && list.length < PAGE_SIZE) break
    if (list.length < PAGE_SIZE) break
    if (page === MAX_PAGES) { truncated = true; break }
    page += 1
  }
  return { day: range.day, credits: sum, requests: total || rows, truncated }
}

/**
 * 一次完整读数：余额 + 今日消耗。
 *
 * `force` 为 false 时走 60 秒缓存 —— 底栏每 5 分钟自动刷、用户也可能连点，
 * 缓存挡住的是「连点」而不是「刷新」。
 */
export async function readCredits(options = {}) {
  const force = options.force === true
  const now = Date.now()
  if (!force && state.cached !== null && now - state.cachedAt < CACHE_TTL_MS) {
    return { ...state.cached, cached: true }
  }
  if (state.inflight !== null) return state.inflight

  state.inflight = (async () => {
    const list = await candidates()
    if (list.length === 0) {
      const error = new Error('没有可用的 CodeBuddy 登录态（CLI 账号文件与 WorkBuddy vault 都读不到）')
      state.lastError = error.message
      throw error
    }
    // ⚠️ 顺序**不**按 expiresAt 排：本机同时有国内版与国际版两份登录态
    // （vault/cn 与 vault/global 是两个不同账号、两本独立的积分账）。
    // 按过期时间排序会把国际版排前面，于是底栏显示的是另一个账号的余额 ——
    // 数字看着合理，但回答的是「谁剩多少」里错误的那个人。
    // 固定优先级：CLI（本机 DSH 实际在调模型的那个）→ vault CN → vault global。
    let lastError = null
    for (const credential of list) {
      try {
        const balance = await fetchBalance(credential)
        const today = await fetchTodayUsage(credential)
        const value = {
          balance: balance.total,
          plan: balance.plan,
          paid: balance.paid,
          groups: balance.groups,
          today: today.credits,
          todayRequests: today.requests,
          day: today.day,
          truncated: today.truncated,
          account: { nickname: credential.nickname, source: credential.source },
          fetchedAt: Date.now()
        }
        state.cached = value
        state.cachedAt = Date.now()
        state.lastError = null
        return { ...value, cached: false }
      } catch (error) {
        lastError = error
        // 401/403 才换下一条凭据；5xx / 网络错换号也没用，直接把它抛出去。
        if (error?.status !== 401 && error?.status !== 403) break
      }
    }
    state.lastError = lastError instanceof Error ? lastError.message : String(lastError)
    throw lastError instanceof Error ? lastError : new Error(state.lastError)
  })()

  try {
    return await state.inflight
  } finally {
    state.inflight = null
  }
}

/** 供设置页/诊断读的最近一次错误原文（不翻译、不概括）。 */
export function lastCreditsError() {
  return state.lastError
}
