// dsh-usage-dock — server half (TypeScript source; compiled to lib/index.js).
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
import type { DeepSeekStatus, DockStatus, QuotaWindow, ZhipuStatus } from './types'

// Node's fetch (undici) may prefer IPv6: some CN endpoints (open.bigmodel.cn)
// publish AAAA records that are unreachable on hosts without IPv6 routing,
// which surfaces as "fetch failed" while curl happily falls back to IPv4.
// Pin IPv4-first like the reference plugins do.
try { dns.setDefaultResultOrder('ipv4first') } catch {}

/** Stable Cordis plugin name. */
export const name = 'usage-dock'

// ---------------------------------------------------------------------------
// Structural types for the host services this plugin consumes. The plugin is
// loaded by the DSH runtime; these interfaces describe only the surface it
// actually touches, so it stays compatible across minor host drift.
// ---------------------------------------------------------------------------

interface LikeIncomingMessage { url?: string | null; headers?: Record<string, string | string[] | undefined> }
interface LikeServerResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(chunk?: string): unknown
}
interface WebServerRoute { kind: 'exact'; path: string; handler: (req: LikeIncomingMessage, res: LikeServerResponse) => void | Promise<void> }
interface WebServerService { register(route: WebServerRoute): () => void }
interface CredentialHit { value?: string }
interface CredentialRecord { key?: string; env?: Record<string, string> }
interface CredentialsService {
  resolve(ref: string): Promise<CredentialHit | null>
  readRecord?(id: string): Promise<CredentialRecord | null>
}
interface SettingsDescriptorRow { ns?: string; value?: unknown }
interface SettingsService {
  describe?(): SettingsDescriptorRow[]
  get?(ns: string): unknown
}
interface ScopedContext {
  get(name: string): unknown
  webServer: WebServerService
  credentials: CredentialsService
}
interface RootContext {
  inject(deps: string[], fn: (ctx: ScopedContext) => void): unknown
  effect(setup: () => () => void): unknown
}

// ---------------------------------------------------------------------------
// Small unknown-JSON helpers (vendor APIs are parsed defensively).
// ---------------------------------------------------------------------------

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}

// ---------------------------------------------------------------------------
// Vendor registry
// ---------------------------------------------------------------------------

type Vendor = 'zhipu' | 'deepseek'

const ZHIPU_KEY_REFS = ['ZHIPU_API_KEY', 'GLM_API_KEY']
const DEEPSEEK_KEY_REFS = ['DEEPSEEK_API_KEY']

interface ZhipuEndpointSpec { url: string; label: string }

const ZHIPU_ENDPOINTS = {
  cn: {
    url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    label: '智谱 GLM Coding Plan',
  },
  intl: {
    url: 'https://api.z.ai/api/monitor/usage/quota/limit',
    label: '智谱 GLM Coding Plan（国际 z.ai）',
  },
} satisfies Record<string, ZhipuEndpointSpec>

/** Which Zhipu platform a provider route targets (CN mainland vs z.ai intl). */
function zhipuEndpoint(provider: string | null | undefined): ZhipuEndpointSpec {
  const p = String(provider ?? '').toLowerCase()
  const intl = p.includes('intl') || (p.includes('z.ai') && !p.includes('cn'))
  return intl ? ZHIPU_ENDPOINTS.intl : ZHIPU_ENDPOINTS.cn
}

const DEEPSEEK_ENDPOINT: ZhipuEndpointSpec = {
  url: 'https://api.deepseek.com/user/balance',
  label: 'DeepSeek',
}

interface VendorSpec { keyRefs: string[]; missingKeyHint: string }

const VENDORS: Record<Vendor, VendorSpec> = {
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
function detectVendor(provider: string | null | undefined, model: string | null | undefined): Vendor | null {
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
function zhipuPlanMissing(data: unknown): string | null {
  const obj = rec(data)
  const msg = `${str(obj?.['msg']) || str(obj?.['message'])}`
  const code = String(obj?.['code'] ?? '')
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
function zhipuLane(entry: unknown): QuotaWindow | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Record<string, unknown>
  const used = num(e['currentValue'])
  const total = num(e['usage'])
  let pct = num(e['percentage'])
  if (!Number.isFinite(pct) && Number.isFinite(used) && total > 0) pct = (used / total) * 100
  if (!Number.isFinite(pct)) return null
  const remaining = num(e['remaining'])
  const resetAt = num(e['nextResetTime'])
  return {
    usedPct: Math.max(0, Math.min(100, Math.round(pct))),
    used: Number.isFinite(used) ? used : null,
    total: Number.isFinite(total) && total > 0 ? total : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetAt: Number.isFinite(resetAt) ? resetAt : null,
  }
}

type ZhipuParsed =
  | { ok: true; fiveHour: QuotaWindow | null; weekly: QuotaWindow | null; level: string }
  | { ok: false; code: 'PARSE'; error: string }

/**
 * Read Zhipu Coding Plan usage as two windows: the 5-hour credit window and
 * the weekly one. Window encoding (reference doc §1.3): `unit=3` → 5h,
 * `unit=6` → weekly; rows are `CREDIT_LIMIT` (current credit plans) with
 * `TOKENS_LIMIT` as the token-plan shape, so token rows win when both exist.
 * `TIME_LIMIT` rows (MCP tool calls) are not plan windows and are ignored.
 * When unit codes do not match anything known, fall back to reset order:
 * soonest reset = 5h window, latest = weekly.
 */
function parseZhipuQuota(data: unknown): ZhipuParsed {
  const root = rec(rec(data)?.['data'])
  const rawLimits = root?.['limits']
  const limits = Array.isArray(rawLimits)
    ? rawLimits.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    : []
  const windows = limits.filter((e) => e['type'] !== 'TIME_LIMIT')
  if (windows.length === 0) return { ok: false, code: 'PARSE', error: '额度接口返回无法解析（limits 为空）' }

  const pools = [
    windows.filter((e) => e['type'] === 'TOKENS_LIMIT'),
    windows.filter((e) => e['type'] === 'CREDIT_LIMIT'),
    windows,
  ]
  const pickByUnit = (unit: number): Record<string, unknown> | null => {
    for (const pool of pools) {
      const hit = pool.find((e) => num(e['unit']) === unit)
      if (hit) return hit
    }
    return null
  }
  let fiveHour = zhipuLane(pickByUnit(3))
  let weekly = zhipuLane(pickByUnit(6))
  if (!fiveHour || !weekly) {
    const byReset = [...windows]
      .filter((e) => Number.isFinite(num(e['nextResetTime'])))
      .sort((a, b) => num(a['nextResetTime']) - num(b['nextResetTime']))
    if (!fiveHour && byReset.length >= 1) fiveHour = zhipuLane(byReset[0])
    if (!weekly && byReset.length >= 2) weekly = zhipuLane(byReset[byReset.length - 1]!)
  }
  if (!fiveHour && !weekly) return { ok: false, code: 'PARSE', error: '额度接口返回无法解析（未识别额度窗口）' }

  const level = root?.['level'] != null ? String(root['level']) : str(root?.['planName'])
  return { ok: true, fiveHour, weekly, level }
}

type DeepSeekParsed =
  | { ok: true; currency: string; balance: number | null; granted: number | null }
  | { ok: false; code: 'PARSE'; error: string }

/** Read DeepSeek balance fields. */
function parseDeepSeekBalance(data: unknown): DeepSeekParsed {
  const root = rec(data)
  const infos = Array.isArray(root?.['balance_infos']) ? root!['balance_infos']! : []
  const info = rec(infos.find((x) => !!x && typeof x === 'object'))
  if (!info) return { ok: false, code: 'PARSE', error: '余额接口返回无法解析（缺少 balance_infos）' }
  const total = num(info['total_balance'])
  const granted = num(info['granted_balance'])
  return {
    ok: true,
    currency: typeof info['currency'] === 'string' && info['currency'] ? info['currency'] : 'CNY',
    balance: Number.isFinite(total) ? total : null,
    granted: Number.isFinite(granted) ? granted : null,
  }
}

interface FetchResult { status: number; body: Record<string, unknown> | null; error: string | null }

async function fetchJson(url: string, headers: Record<string, string>): Promise<FetchResult> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
      const text = await res.text()
      let body: Record<string, unknown> | null = null
      try { body = JSON.parse(text) as Record<string, unknown> } catch { body = null }
      if (!res.ok) {
        const detail = body ? String(body['msg'] ?? body['message'] ?? '') : ''
        return { status: res.status, body, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 140)}` : ''}` }
      }
      return { status: res.status, body, error: null }
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr)
  return { status: 0, body: null, error: `请求失败: ${message.slice(0, 140)}` }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function apply(root: RootContext): void {
  // No object-level inject: register nothing service-dependent up front, then
  // wait for the two services we need inside a scoped fiber (mirrors the
  // desktop-race lesson documented by the reference plugins).
  root.inject(['webServer', 'credentials'], (ctx) => {
    const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
    const disposers: Array<() => void> = []
    root.effect(() => () => { for (const d of disposers) { try { d() } catch {} } })

    // ---- Browser trust fence (same-origin / loopback only) -----------------
    const TRUSTED_HOSTS = String(process.env['DSH_USAGE_DOCK_TRUSTED_HOSTS'] ?? '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

    function isLoopbackHostname(hn: unknown): boolean {
      const h = String(hn ?? '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
      if (!h) return false
      if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
      if (!m || Number(m[1]) !== 127) return false
      return [m[2], m[3], m[4]].every((x) => Number(x) <= 255)
    }

    /** Returns a rejection status code, or null when the request is trusted. Fail-closed. */
    function selfRejection(req: LikeIncomingMessage): number | null {
      try {
        const headers = rec(req?.headers) ?? {}
        let hostUrl: URL
        try { hostUrl = new URL('http://' + String(headers['host'] ?? '')) } catch { return 403 }
        const hostname = hostUrl.hostname
        const authority = hostUrl.host.toLowerCase()
        if (!isLoopbackHostname(hostname) && !TRUSTED_HOSTS.includes(authority) && !TRUSTED_HOSTS.includes(hostname.toLowerCase())) return 403
        const site = String(headers['sec-fetch-site'] ?? '').toLowerCase()
        if (site === 'cross-site') return 403
        const origin = headers['origin']
        if (typeof origin === 'string' && origin && origin !== 'null') {
          let originUrl: URL
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
    function settingsService(): SettingsService | null {
      try { return (ctx.get('settings') as SettingsService | undefined) ?? null } catch { return null }
    }

    /**
     * One plugin's live config section through the settings service. DSH
     * 0.2.0-rc.2 replaced the old `settings.get(ns)` getter with
     * `SettingsForms`, whose `describe()` returns live values keyed by
     * profile entry id — read that first, keep the getter for older builds.
     * `apiKeyEnv` is a credential *reference* (an env-var name), not a
     * secret, so it survives `redactSecrets` and is safe to read here.
     */
    function settingsSection(ns: string): Record<string, unknown> | null {
      const settings = settingsService()
      if (!settings) return null
      if (typeof settings.describe === 'function') {
        try {
          const row = settings.describe().find((d) => d?.ns === ns)
          return rec(row?.value)
        } catch { return null }
      }
      if (typeof settings.get === 'function') {
        try { return rec(settings.get(ns)) } catch { return null }
      }
      return null
    }

    /**
     * Credential refs to try for one provider route, most specific first:
     * the route's own `apiKeyEnv` (llm-pi-ai / llm-deepseek settings), then
     * the vendor-generic fallbacks.
     */
    function keyRefsFor(vendor: Vendor, provider: string): string[] {
      const refs: string[] = []
      const providers = rec(settingsSection('llm-pi-ai')?.['providers'])
      const env = str(rec(providers?.[provider])?.['apiKeyEnv'])
      if (env) refs.push(env)
      if (vendor === 'deepseek') {
        const env = str(settingsSection('llm-deepseek')?.['apiKeyEnv'])
        if (env) refs.push(env)
      }
      refs.push(...VENDORS[vendor]!.keyRefs)
      return refs
    }

    /** A pi-ai login record (`llm-pi-ai/<provider>`) as a last-resort key. */
    async function recordKey(provider: string): Promise<string | null> {
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

    interface ResolvedKey { key: string | null; ref: string | null; error?: string }

    async function resolveKey(vendor: Vendor, provider: string): Promise<ResolvedKey> {
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
          const message = err instanceof Error ? err.message : String(err)
          return { key: null, ref: null, error: message.slice(0, 160) }
        }
      }
      return { key: null, ref: null }
    }

    // ---- Cached vendor status ----------------------------------------------
    interface CacheEntry { at: number; payload: DockStatus }
    const cache = new Map<string, CacheEntry>() // `${vendor}:${endpointUrl}` -> { at, payload }
    const inFlight = new Map<string, Promise<DockStatus>>() // cache key -> Promise

    async function computeStatus(vendor: Vendor, provider: string): Promise<DockStatus> {
      const spec = VENDORS[vendor]!
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
        if (!rec(body?.['data'])) {
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
        const payload: ZhipuStatus = { ...parsed, vendor, vendorLabel: endpoint.label, keyRef: ref, fetchedAt: Date.now() }
        return payload
      }

      // deepseek
      if (httpError) {
        const friendly = httpError.startsWith('HTTP 401')
          ? `${httpError}（API key 无效、已过期，或不是官方端点的 key）`
          : httpError
        return { ok: false, code: 'HTTP', error: friendly }
      }
      if (body && typeof body['code'] === 'string' && body['code'] !== '0' && body['msg']) {
        return { ok: false, code: 'BIZ', error: String(body['msg']).slice(0, 140) }
      }
      const parsed = parseDeepSeekBalance(body)
      if (!parsed.ok) return parsed
      const payload: DeepSeekStatus = { ...parsed, vendor, vendorLabel: DEEPSEEK_ENDPOINT.label, keyRef: ref, fetchedAt: Date.now() }
      return payload
    }

    async function getStatus(vendor: Vendor, provider: string, refresh: boolean): Promise<DockStatus> {
      const endpoint = vendor === 'zhipu' ? zhipuEndpoint(provider) : DEEPSEEK_ENDPOINT
      const cacheKey = `${vendor}:${endpoint.url}`
      if (refresh) cache.delete(cacheKey)
      const hit = cache.get(cacheKey)
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload
      let p = inFlight.get(cacheKey)
      if (!p) {
        p = computeStatus(vendor, provider)
          .catch((err: unknown): DockStatus => {
            const message = err instanceof Error ? err.message : String(err)
            return { ok: false, code: 'ERROR', error: message.slice(0, 160) }
          })
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
          const message = err instanceof Error ? err.message : String(err)
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, code: 'ERROR', error: message.slice(0, 200) }))
        }
      },
    }))

    try {
      console.log('[usage-dock] ready: GET /dsh-usage-dock/status?provider=<id>&model=<id>')
    } catch {}
  })
}
