// dsh-usage-dock — server half.
//
// Registers HTTP routes on the Web host that the browser client bundle calls:
//
//   GET /dsh-usage-dock/status?provider=<routeId>&model=<modelId>[&refresh=1]
//
// The vendor is detected from the provider/model pair the Web workspace has
// selected (the client reads it from the `modelSelection` session projection):
//
//   - Zhipu (智谱, CN)  → GLM Coding Plan quota  (open.bigmodel.cn)
//     two windows per the reference doc (zhipu-coding-plan-balance-query.md):
//     limits[] rows with unit=3 → 5h window, unit=6 → weekly window
//   - DeepSeek          → account balance         (api.deepseek.com)
//
// Keys come from the DSH credential seam (`ctx.credentials`), never from this
// file, resolved per provider route: the route's own `apiKeyEnv` (e.g. the
// shipped zai-coding-cn route declares ZAI_CODING_CN_API_KEY) first, then
// vendor fallbacks (ZHIPU_API_KEY / GLM_API_KEY, DEEPSEEK_API_KEY), then a
// pi-ai login record (`llm-pi-ai/<provider>`). Responses are cached 60s per
// vendor+endpoint; `refresh=1` bypasses the cache.

import dns from 'node:dns'

// Node's fetch (undici) may prefer IPv6: some CN endpoints (open.bigmodel.cn)
// publish AAAA records that are unreachable on hosts without IPv6 routing,
// which surfaces as "fetch failed" while curl happily falls back to IPv4.
// Pin IPv4-first like the reference plugins do.
try { dns.setDefaultResultOrder('ipv4first') } catch {}

/** Stable Cordis plugin name. */
export const name = 'usage-dock'

// ---------------------------------------------------------------------------
// Vendor registry
// ---------------------------------------------------------------------------

const ZHIPU_KEY_REFS = ['ZHIPU_API_KEY', 'GLM_API_KEY']
const DEEPSEEK_KEY_REFS = ['DEEPSEEK_API_KEY']

const ZHIPU_ENDPOINTS = {
  cn: {
    url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    label: '智谱 GLM Coding Plan',
  },
  intl: {
    url: 'https://api.z.ai/api/monitor/usage/quota/limit',
    label: '智谱 GLM Coding Plan（国际 z.ai）',
  },
}

/** Which Zhipu platform a provider route targets (CN mainland vs z.ai intl). */
function zhipuEndpoint(provider) {
  const p = String(provider ?? '').toLowerCase()
  const intl = p.includes('intl') || (p.includes('z.ai') && !p.includes('cn'))
  return intl ? ZHIPU_ENDPOINTS.intl : ZHIPU_ENDPOINTS.cn
}

const DEEPSEEK_ENDPOINT = {
  url: 'https://api.deepseek.com/user/balance',
  label: 'DeepSeek',
}

const VENDORS = {
  zhipu: {
    keyRefs: ZHIPU_KEY_REFS,
    missingKeyHint: '未找到该模型的 API 密钥（按 provider 的 apiKeyEnv（如 ZAI_CODING_CN_API_KEY）、ZHIPU_API_KEY、GLM_API_KEY 顺序解析；可在 设置 → API 密钥 配置）',
  },
  deepseek: {
    keyRefs: DEEPSEEK_KEY_REFS,
    missingKeyHint: '未设置 DEEPSEEK_API_KEY（设置 → API 密钥，或环境变量）',
  },
}

/** Map a provider/model pair onto a known vendor, or null when unsupported. */
function detectVendor(provider, model) {
  const s = `${provider ?? ''} ${model ?? ''}`.toLowerCase()
  // glm-* models, zhipu/bigmodel hosts, and the shipped zai-coding(-cn/-intl) routes.
  if (/(^|[^a-z])(glm|zai)([^a-z]|$)/.test(s) || s.includes('zhipu') || s.includes('bigmodel') || s.includes('z.ai') || s.includes('z-ai')) return 'zhipu'
  if (s.includes('deepseek')) return 'deepseek'
  return null
}

// ---------------------------------------------------------------------------
// Quota fetching
// ---------------------------------------------------------------------------

const HTTP_TIMEOUT_MS = 8000
const RETRY_DELAY_MS = 700
const CACHE_TTL_MS = 60_000

/** Zhipu: the account has no Coding Plan subscription (e.g. token packs). */
function zhipuPlanMissing(data) {
  const msg = `${data?.msg ?? data?.message ?? ''}`
  const code = String(data?.code ?? '')
  if (msg.includes('coding plan') || msg.includes('不存在') || msg.includes('未订阅')) return msg
  if (code && code !== '0' && code !== '200' && msg) return msg
  return null
}

/**
 * Read one Zhipu quota window (`limits[]` entry) into a display lane.
 * Field semantics per the vendored reference doc (zhipu-coding-plan-balance-
 * query.md §1.3): `percentage` = used%, `usage` = total, `currentValue` =
 * used, `remaining`, `nextResetTime` = epoch ms.
 */
function zhipuLane(entry) {
  if (!entry || typeof entry !== 'object') return null
  const used = Number(entry.currentValue)
  const total = Number(entry.usage)
  let pct = Number(entry.percentage)
  if (!Number.isFinite(pct) && Number.isFinite(used) && total > 0) pct = (used / total) * 100
  if (!Number.isFinite(pct)) return null
  const remaining = Number(entry.remaining)
  const resetAt = Number(entry.nextResetTime)
  return {
    usedPct: Math.max(0, Math.min(100, Math.round(pct))),
    used: Number.isFinite(used) ? used : null,
    total: Number.isFinite(total) && total > 0 ? total : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetAt: Number.isFinite(resetAt) ? resetAt : null,
  }
}

/**
 * Read Zhipu Coding Plan usage as two windows: the 5-hour credit window and
 * the weekly one. Window encoding (reference doc §1.3): `unit=3` → 5h,
 * `unit=6` → weekly; rows are `CREDIT_LIMIT` (current credit plans) with
 * `TOKENS_LIMIT` as the token-plan shape, so token rows win when both exist.
 * `TIME_LIMIT` rows (MCP tool calls) are not plan windows and are ignored.
 * When unit codes do not match anything known, fall back to reset order:
 * soonest reset = 5h window, latest = weekly.
 */
function parseZhipuQuota(data) {
  const limits = Array.isArray(data?.data?.limits) ? data.data.limits.filter((e) => e && typeof e === 'object') : []
  const windows = limits.filter((e) => e.type !== 'TIME_LIMIT')
  if (windows.length === 0) return { ok: false, code: 'PARSE', error: '额度接口返回无法解析（limits 为空）' }

  const pools = [
    windows.filter((e) => e.type === 'TOKENS_LIMIT'),
    windows.filter((e) => e.type === 'CREDIT_LIMIT'),
    windows,
  ]
  const pickByUnit = (unit) => {
    for (const pool of pools) {
      const hit = pool.find((e) => Number(e.unit) === unit)
      if (hit) return hit
    }
    return null
  }
  let fiveHour = zhipuLane(pickByUnit(3))
  let weekly = zhipuLane(pickByUnit(6))
  if (!fiveHour || !weekly) {
    const byReset = [...windows]
      .filter((e) => Number.isFinite(Number(e.nextResetTime)))
      .sort((a, b) => Number(a.nextResetTime) - Number(b.nextResetTime))
    if (!fiveHour && byReset.length >= 1) fiveHour = zhipuLane(byReset[0])
    if (!weekly && byReset.length >= 2) weekly = zhipuLane(byReset[byReset.length - 1])
  }
  if (!fiveHour && !weekly) return { ok: false, code: 'PARSE', error: '额度接口返回无法解析（未识别额度窗口）' }

  const level = data?.data?.level != null ? String(data.data.level) : (data?.data?.planName ?? '')
  return { ok: true, fiveHour, weekly, level }
}

/** Read DeepSeek balance fields. */
function parseDeepSeekBalance(data) {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
  const info = infos.find((x) => x && typeof x === 'object') ?? null
  if (!info) return { ok: false, code: 'PARSE', error: '余额接口返回无法解析（缺少 balance_infos）' }
  const total = Number(info.total_balance)
  const granted = Number(info.granted_balance)
  return {
    ok: true,
    currency: typeof info.currency === 'string' && info.currency ? info.currency : 'CNY',
    balance: Number.isFinite(total) ? total : null,
    granted: Number.isFinite(granted) ? granted : null,
  }
}

async function fetchJson(url, headers) {
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
      const text = await res.text()
      let body = null
      try { body = JSON.parse(text) } catch { body = null }
      if (!res.ok) {
        const detail = body ? String(body.msg ?? body.message ?? '') : ''
        return { status: res.status, body, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 140)}` : ''}` }
      }
      return { status: res.status, body, error: null }
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
  return { status: 0, body: null, error: `请求失败: ${String(lastErr?.message ?? lastErr).slice(0, 140)}` }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function apply(root) {
  // No object-level inject: register nothing service-dependent up front, then
  // wait for the two services we need inside a scoped fiber (mirrors the
  // desktop-race lesson documented by the reference plugins).
  root.inject(['webServer', 'credentials'], (ctx) => {
    const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
    const disposers = []
    root.effect(() => () => { for (const d of disposers) { try { d() } catch {} } })

    // ---- Browser trust fence (same-origin / loopback only) -----------------
    const TRUSTED_HOSTS = String(process.env.DSH_USAGE_DOCK_TRUSTED_HOSTS ?? '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

    function isLoopbackHostname(hn) {
      const h = String(hn ?? '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
      if (!h) return false
      if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
      if (!m || Number(m[1]) !== 127) return false
      return [m[2], m[3], m[4]].every((x) => Number(x) <= 255)
    }

    /** Returns a rejection status code, or null when the request is trusted. Fail-closed. */
    function selfRejection(req) {
      try {
        const headers = req?.headers ?? {}
        let hostUrl
        try { hostUrl = new URL('http://' + String(headers.host ?? '')) } catch { return 403 }
        const hostname = hostUrl.hostname
        const authority = hostUrl.host.toLowerCase()
        if (!isLoopbackHostname(hostname) && !TRUSTED_HOSTS.includes(authority) && !TRUSTED_HOSTS.includes(hostname.toLowerCase())) return 403
        const site = String(headers['sec-fetch-site'] ?? '').toLowerCase()
        if (site === 'cross-site') return 403
        const origin = headers.origin
        if (typeof origin === 'string' && origin && origin !== 'null') {
          let originUrl
          try { originUrl = new URL(origin) } catch { return 403 }
          if (originUrl.host.toLowerCase() !== authority) return 403
        }
        return null
      } catch {
        return 403
      }
    }

    // ---- Credential resolution ---------------------------------------------
    /** The settings service, when one is mounted (optional). */
    function settingsService() {
      try { return ctx.get('settings') ?? null } catch { return null }
    }

    /**
     * One plugin's live config section through the settings service. DSH
     * 0.2.0-rc.2 replaced the old `settings.get(ns)` getter with
     * `SettingsForms`, whose `describe()` returns live values keyed by
     * profile entry id — read that first, keep the getter for older builds.
     * `apiKeyEnv` is a credential *reference* (an env-var name), not a
     * secret, so it survives `redactSecrets` and is safe to read here.
     */
    function settingsSection(ns) {
      const settings = settingsService()
      if (!settings) return null
      if (typeof settings.describe === 'function') {
        try {
          const row = settings.describe().find((d) => d?.ns === ns)
          return row?.value ?? null
        } catch { return null }
      }
      if (typeof settings.get === 'function') {
        try { return settings.get(ns) ?? null } catch { return null }
      }
      return null
    }

    /**
     * Credential refs to try for one provider route, most specific first:
     * the route's own `apiKeyEnv` (llm-pi-ai / llm-deepseek settings), then
     * the vendor-generic fallbacks.
     */
    function keyRefsFor(vendor, provider) {
      const refs = []
      const piAi = settingsSection('llm-pi-ai')
      const env = piAi?.providers?.[provider]?.apiKeyEnv
      if (typeof env === 'string' && env) refs.push(env)
      if (vendor === 'deepseek') {
        const env = settingsSection('llm-deepseek')?.apiKeyEnv
        if (typeof env === 'string' && env) refs.push(env)
      }
      refs.push(...VENDORS[vendor].keyRefs)
      return refs
    }

    /** A pi-ai login record (`llm-pi-ai/<provider>`) as a last-resort key. */
    async function recordKey(provider) {
      try {
        if (typeof ctx.credentials.readRecord !== 'function') return null
        const record = await ctx.credentials.readRecord(`llm-pi-ai/${provider}`)
        if (!record || typeof record !== 'object') return null
        if (typeof record.key === 'string' && record.key) return record.key
        const env = record.env
        if (env && typeof env === 'object') {
          for (const value of Object.values(env)) {
            if (typeof value === 'string' && value) return value
          }
        }
      } catch {}
      return null
    }

    async function resolveKey(vendor, provider) {
      // The credential service can race service startup; one short retry
      // separates "not ready yet" from "really not configured".
      const refs = keyRefsFor(vendor, provider)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          for (const ref of refs) {
            const hit = await ctx.credentials.resolve(ref)
            if (hit && typeof hit.value === 'string' && hit.value) return { key: hit.value, ref }
          }
          const fromRecord = await recordKey(provider)
          if (fromRecord) return { key: fromRecord, ref: `llm-pi-ai/${provider}` }
          return { key: null, ref: null }
        } catch (err) {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, RETRY_DELAY_MS)); continue }
          return { key: null, ref: null, error: String(err?.message ?? err).slice(0, 160) }
        }
      }
      return { key: null, ref: null }
    }

    // ---- Cached vendor status ----------------------------------------------
    const cache = new Map() // `${vendor}:${endpointUrl}` -> { at, payload }
    const inFlight = new Map() // cache key -> Promise

    async function computeStatus(vendor, provider) {
      const spec = VENDORS[vendor]
      const endpoint = vendor === 'zhipu' ? zhipuEndpoint(provider) : DEEPSEEK_ENDPOINT
      const { key, ref, error } = await resolveKey(vendor, provider)
      if (error) return { ok: false, code: 'NO_KEY', error: `凭据读取失败: ${error}` }
      if (!key) return { ok: false, code: 'NO_KEY', error: spec.missingKeyHint }

      // Zhipu's monitor endpoint takes the RAW key; DeepSeek wants Bearer.
      const headers = vendor === 'zhipu' ? { Authorization: key } : { Authorization: `Bearer ${key}` }
      const { body, error: httpError } = await fetchJson(endpoint.url, headers)
      if (httpError && body === null) return { ok: false, code: 'HTTP', error: httpError }

      if (vendor === 'zhipu') {
        const noPlan = zhipuPlanMissing(body)
        if (noPlan) return { ok: false, code: 'NO_PLAN', error: `该账号没有 Coding Plan 订阅（${noPlan.slice(0, 120)}）` }
        if (!body?.data) {
          // code:200 with empty data per the reference doc §4: a plain API key
          // (not a Coding Plan key) or a team plan missing type=2/org headers.
          return { ok: false, code: 'NO_PLAN', error: '额度接口返回为空（可能用普通 API Key 查询套餐，或团队版缺少 type=2 / 组织请求头）' }
        }
        if (httpError) {
          const friendly = httpError.startsWith('HTTP 401')
            ? `${httpError}（API key 无效或不是该平台的 key）`
            : httpError
          return { ok: false, code: 'HTTP', error: friendly }
        }
        const parsed = parseZhipuQuota(body)
        if (!parsed.ok) return parsed
        return { ok: true, vendor, vendorLabel: endpoint.label, keyRef: ref, ...parsed, fetchedAt: Date.now() }
      }

      // deepseek
      if (httpError) {
        const friendly = httpError.startsWith('HTTP 401')
          ? `${httpError}（API key 无效、已过期，或不是官方端点的 key）`
          : httpError
        return { ok: false, code: 'HTTP', error: friendly }
      }
      if (body && typeof body.code === 'string' && body.code !== '0' && body.msg) {
        return { ok: false, code: 'BIZ', error: String(body.msg).slice(0, 140) }
      }
      const parsed = parseDeepSeekBalance(body)
      if (!parsed.ok) return parsed
      return { ok: true, vendor, vendorLabel: DEEPSEEK_ENDPOINT.label, keyRef: ref, ...parsed, fetchedAt: Date.now() }
    }

    async function getStatus(vendor, provider, refresh) {
      const endpoint = vendor === 'zhipu' ? zhipuEndpoint(provider) : DEEPSEEK_ENDPOINT
      const cacheKey = `${vendor}:${endpoint.url}`
      if (refresh) cache.delete(cacheKey)
      const hit = cache.get(cacheKey)
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload
      let p = inFlight.get(cacheKey)
      if (!p) {
        p = computeStatus(vendor, provider)
          .catch((err) => ({ ok: false, code: 'ERROR', error: String(err?.message ?? err).slice(0, 160) }))
          .then((payload) => { cache.set(cacheKey, { at: Date.now(), payload }); return payload })
          .finally(() => { inFlight.delete(cacheKey) })
        inFlight.set(cacheKey, p)
      }
      return p
    }

    // ---- Route ---------------------------------------------------------------
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-usage-dock/status',
      handler: async (req, res) => {
        const reject = selfRejection(req)
        if (reject !== null) {
          res.writeHead(reject, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('forbidden')
          return
        }
        try {
          const params = new URL(req.url ?? '/', 'http://localhost').searchParams
          const provider = params.get('provider') ?? ''
          const model = params.get('model') ?? ''
          const refresh = params.get('refresh') === '1'
          const vendor = detectVendor(provider, model)
          if (!vendor) {
            res.writeHead(200, JSON_HEADERS)
            res.end(JSON.stringify({
              ok: false,
              code: 'UNSUPPORTED',
              error: `未支持的费用查询厂商（provider=${provider || '?'}, model=${model || '?'}；第一版仅支持智谱 GLM Coding Plan 与 DeepSeek）`,
            }))
            return
          }
          const payload = await getStatus(vendor, provider, refresh)
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify(payload))
        } catch (err) {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, code: 'ERROR', error: String(err?.message ?? err).slice(0, 200) }))
        }
      },
    }))

    try {
      console.log('[usage-dock] ready: GET /dsh-usage-dock/status?provider=<id>&model=<id>')
    } catch {}
  })
}
