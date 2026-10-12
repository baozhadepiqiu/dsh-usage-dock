// Shared domain types for dsh-usage-dock (server payload shapes + client i18n).

/** One quota window lane (Zhipu 5h / weekly). Counts are null when the vendor omits them. */
export interface QuotaWindow {
  usedPct: number
  used: number | null
  total: number | null
  remaining: number | null
  resetAt: number | null
}

export interface ZhipuStatus {
  ok: true
  vendor: 'zhipu'
  vendorLabel: string
  keyRef: string | null
  fiveHour: QuotaWindow | null
  weekly: QuotaWindow | null
  level: string
  fetchedAt: number
}

export interface DeepSeekStatus {
  ok: true
  vendor: 'deepseek'
  vendorLabel: string
  keyRef: string | null
  currency: string
  balance: number | null
  granted: number | null
  fetchedAt: number
}

/** Failed status; code ∈ NO_KEY | HTTP | BIZ | PARSE | NO_PLAN | UNSUPPORTED | ERROR. */
export interface ErrorStatus {
  ok: false
  code: string
  error: string
}

export type DockStatus = ZhipuStatus | DeepSeekStatus | ErrorStatus

/** Locale seat `t` handed to slot entries that declare a locale namespace. */
export type Translate = (key: string, params?: Record<string, string>) => string
