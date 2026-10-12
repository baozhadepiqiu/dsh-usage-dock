// dsh-usage-dock — browser client.
//
// Registers one entry in the `conversation.composer.dock` slot and renders it
// ON THE SAME CENTERED LINE as the built-in stats row (the cache-hit pills):
//
//        缓存命中 34% · 12轮30步   ·   5H ▕▓▓▓▓▓▓▓▓▓░▏89% ↻16:23   周 ▕▓▓▓▓░░░░░░▏39% ↻周二09:36
//
// The dock anchor the renderer emits is inline-styled `display:contents`, so
// each entry would normally own a full-width row of its own. The injected
// stylesheet flips the anchor into a real wrapping centered flex row
// (!important is the only declaration that beats an inline style) and
// neutralizes the entries' width:100% shells. Specificity note: the built-in
// stats row's own rules are injected AFTER this plugin's stylesheet, so ties
// would go to it — these selectors therefore carry an element part ((0,1,1)
// vs its (0,1,0) class-only) and win regardless of injection order.
//
// Display is retro segmented meters — one cell per decile, LCD-style framed
// cell bank + monospace numerals — no battery icon. Cells and the percentage
// show the REMAINING quota (the bank drains as the window is consumed);
// ≤30% remaining turns warn, ≤10% danger. Used/total detail is hover-only.
//
//   - 5H / 周: Zhipu GLM Coding Plan windows served by this plugin's host
//     route — unit=3 → 5-hour window, unit=6 → weekly window (fallback:
//     nextResetTime order). Auto-switched by the `modelSelection` projection.
//   - DS: DeepSeek account balance (pay-as-you-go, no windows).
//   - Click the group to re-query the vendor API immediately (refresh=1
//     bypasses the server's 60s cache); values dim while in flight.
//
// The slot system hands session-scoped entries a `useProjection` hook and a
// locale seat `t` (because the entry declares a locale namespace).

import { useEffect, useRef, useState } from "react";

const NS = "usage-dock";

// Injected once when the browser loads the bundle.
const CSS =
  // Turn the composer-dock anchor from `display:contents` (inline style) into
  // a real wrapping centered flex row — !important is the only way a
  // stylesheet beats an inline style. Every dock entry (the built-in `stats`
  // row and this one) then flows on one shared, centered line; the row wraps
  // back to centered lines on narrow viewports.
  'div[data-slot="conversation.composer.dock"]{display:flex !important;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 12px;width:100%;max-width:var(--dsh-chat-content-width);box-sizing:border-box;margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}' +
  // Neutralize the entry shells' width:100%/padding (the anchor row owns the
  // chrome now). The element part keeps specificity (0,1,1) above the
  // built-in row's class-only (0,1,0) regardless of stylesheet order.
  'div[data-slot="conversation.composer.dock"]>*{width:auto;max-width:100%;padding:0;margin:0}' +
  // Retro meters.
  ".udRoot{align-items:center;flex-wrap:wrap;justify-content:center;gap:4px 14px;font-variant-numeric:tabular-nums;display:inline-flex}" +
  ".udLane{color:var(--dsw-alias-label-tertiary);font:inherit;white-space:nowrap;align-items:center;gap:6px;display:inline-flex}" +
  ".udLaneWarn{color:var(--dsw-alias-state-warn-primary)}" +
  ".udLaneDanger{color:var(--dsw-alias-state-error-primary)}" +
  ".udTag{flex:none;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,\"Liberation Mono\",monospace);font-size:10px;line-height:14px;letter-spacing:.1em;padding:0 4px;border:1px solid color-mix(in srgb,currentColor 45%,transparent);border-radius:3px;opacity:.9}" +
  ".udCells{flex:none;display:inline-flex;gap:2px;padding:2px;border:1px solid color-mix(in srgb,currentColor 30%,transparent);border-radius:4px;background:color-mix(in srgb,currentColor 5%,transparent)}" +
  ".udCell{width:6px;height:9px;border-radius:1px;background:currentColor;opacity:.13}" +
  ".udCellOn{opacity:1}" +
  ".udNum{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,\"Liberation Mono\",monospace)}" +
  ".udReset{opacity:.85}" +
  "button.udGroup{cursor:pointer;background:0 0;border:none;border-radius:24px;padding:1px 8px;font:inherit;color:inherit;align-items:center;flex-wrap:wrap;justify-content:center;gap:4px 14px;display:inline-flex;transition:opacity .15s ease}" +
  "button.udGroup:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
  "button.udGroup.udBusy{opacity:.55}" +
  ".udQuotaError{color:var(--dsw-alias-state-warn-primary)}" +
  ".udQuotaError .udLane{color:inherit}";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"usage-dock\"]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-usage-dock";
  tag.dataset.pluginCss = "usage-dock";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const zh = {
  "lane.5h": "5H",
  "lane.wk": "周",
  "lane.ds": "DS",
  "quota.5h": "5 小时窗口",
  "quota.weekly": "每周窗口",
  "quota.remaining": "剩余 {pct}%（剩 {remaining} / {total}，已用 {used}）",
  "quota.reset": "重置 {time}",
  "quota.level": "档位 {level}",
  "quota.error": "费用查询失败",
  "quota.nokey": "未配置密钥",
  "quota.refresh": "点击立即刷新",
  "quota.refreshing": "正在查询最新额度…",
  "quota.deepseek": "余额 {mark}{balance}",
  "quota.granted": "（含赠送 {mark}{granted}）",
  "quota.key": "密钥 {ref}",
};
const en = {
  "lane.5h": "5H",
  "lane.wk": "WK",
  "lane.ds": "DS",
  "quota.5h": "5-hour window",
  "quota.weekly": "Weekly window",
  "quota.remaining": "{pct}% left ({remaining} / {total} left, {used} used)",
  "quota.reset": "resets {time}",
  "quota.level": "Tier {level}",
  "quota.error": "Quota query failed",
  "quota.nokey": "No API key",
  "quota.refresh": "Click to refresh now",
  "quota.refreshing": "Querying latest quota…",
  "quota.deepseek": "Balance {mark}{balance}",
  "quota.granted": " (incl. granted {mark}{granted})",
  "quota.key": "Key {ref}",
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const two = (n) => String(n).padStart(2, "0");

/** Reset stamp: HH:MM for the 5h window, weekday + HH:MM for the weekly one. */
function resetLabel(resetAt, weekly) {
  if (resetAt === null || resetAt === undefined) return "";
  const ms = typeof resetAt === "number" ? resetAt : Date.parse(resetAt);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (!weekly) return clock;
  try {
    return `${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d)} ${clock}`;
  } catch {
    return clock;
  }
}

/** Localized exact integer for tooltips. */
function exactInt(value) {
  if (!Number.isFinite(value)) return "—";
  try {
    return value.toLocaleString(undefined);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Retro segmented meter
// ---------------------------------------------------------------------------

const CELLS = 10;

/** LCD-style cell bank: `total` cells, `filled` of them lit. */
function Cells({ total, filled }) {
  const cells = [];
  for (let i = 0; i < total; i++) {
    cells.push(<span key={i} className={i < filled ? "udCell udCellOn" : "udCell"} />);
  }
  return <span className="udCells" aria-hidden="true">{cells}</span>;
}

/** Low-remaining alarm tint: ≤10% remaining is danger, ≤30% is warn. */
function toneFor(remainingPct) {
  return remainingPct <= 10 ? "udLaneDanger" : remainingPct <= 30 ? "udLaneWarn" : "";
}

/** Remaining share of a window: from raw counts when available, else 100 − used%. */
function remainingPctOf(window) {
  if (window?.remaining != null && window?.total) {
    return Math.max(0, Math.min(100, Math.round((window.remaining / window.total) * 100)));
  }
  const used = Math.max(0, Math.min(100, Math.round(window?.usedPct ?? 0)));
  return 100 - used;
}

/**
 * One retro window lane. Cells and the percentage show the REMAINING quota
 * (cells drain as the window is consumed); the reset clock rides along. The
 * used/total detail lives in the hover tooltip only.
 */
function windowLane(window, tag, weekly, t) {
  if (!window) return null;
  const remainingPct = remainingPctOf(window);
  const filled = remainingPct <= 0 ? 0 : Math.max(1, Math.round((remainingPct / 100) * CELLS));
  const reset = resetLabel(window.resetAt, weekly);
  const tooltip = [
    t("quota.remaining", {
      pct: String(remainingPct),
      used: exactInt(window.used),
      total: exactInt(window.total),
      remaining: exactInt(window.remaining),
    }),
    reset ? t("quota.reset", { time: reset }) : "",
  ].filter(Boolean).join(" · ");
  return (
    <span
      className={`udLane ${toneFor(remainingPct)}`.trim()}
      title={tooltip}
      key={tag}
    >
      <span className="udTag">{tag}</span>
      <Cells total={CELLS} filled={filled} />
      <span className="udNum">{remainingPct}%</span>
      {reset && <span className="udNum udReset">↻{reset}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Quota group (Zhipu windows / DeepSeek balance), click to refresh
// ---------------------------------------------------------------------------

const POLL_MS = 5 * 60 * 1000;

function QuotaGroup({ provider, model, refreshSignal, onRefresh, t }) {
  const [state, setState] = useState({ loading: false, data: null });
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    let cancelled = false;

    const load = async (refresh) => {
      setState((s) => ({ ...s, loading: true }));
      let data;
      try {
        const qs = `provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}${refresh ? "&refresh=1" : ""}`;
        const res = await fetch(`/dsh-usage-dock/status?${qs}`, { headers: { Accept: "application/json" } });
        data = await res.json();
      } catch (err) {
        data = { ok: false, code: "HTTP", error: String(err?.message ?? err) };
      }
      if (!cancelled && gen === generation.current) setState({ loading: false, data });
    };

    if (provider !== "" || model !== "") load(refreshSignal > 0);
    const timer = setInterval(() => load(false), POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [provider, model, refreshSignal]);

  const data = state.data;
  if (data && data.code === "UNSUPPORTED") return null;

  let body;
  let tooltip;
  let error = false;
  if (data == null) {
    body = <span className="udLane">{t("quota.refresh")}</span>;
    tooltip = t("quota.refresh");
  } else if (!data.ok) {
    error = true;
    const label = data.code === "NO_KEY" ? t("quota.nokey") : t("quota.error");
    body = <span className="udLane">{label}</span>;
    tooltip = `${data.error ?? ""}\n${t("quota.refresh")}`.trim();
  } else if (data.vendor === "zhipu") {
    body = [
      windowLane(data.fiveHour, t("lane.5h"), false, t),
      windowLane(data.weekly, t("lane.wk"), true, t),
    ];
    const lines = [`${data.vendorLabel ?? "智谱 GLM Coding Plan"}${data.level ? ` · ${t("quota.level", { level: data.level })}` : ""}`];
    if (data.fiveHour) lines.push(`${t("quota.5h")}：${t("quota.remaining", { pct: String(remainingPctOf(data.fiveHour)), used: exactInt(data.fiveHour.used), total: exactInt(data.fiveHour.total), remaining: exactInt(data.fiveHour.remaining) })}${data.fiveHour.resetAt != null ? ` · ${t("quota.reset", { time: resetLabel(data.fiveHour.resetAt, false) })}` : ""}`);
    if (data.weekly) lines.push(`${t("quota.weekly")}：${t("quota.remaining", { pct: String(remainingPctOf(data.weekly)), used: exactInt(data.weekly.used), total: exactInt(data.weekly.total), remaining: exactInt(data.weekly.remaining) })}${data.weekly.resetAt != null ? ` · ${t("quota.reset", { time: resetLabel(data.weekly.resetAt, true) })}` : ""}`);
    if (data.keyRef) lines.push(t("quota.key", { ref: data.keyRef }));
    lines.push(state.loading ? t("quota.refreshing") : t("quota.refresh"));
    tooltip = lines.join("\n");
  } else {
    const mark = data.currency === "USD" ? "$" : "¥";
    const balance = typeof data.balance === "number" ? data.balance.toFixed(2) : "—";
    const granted = typeof data.granted === "number" && data.granted > 0
      ? t("quota.granted", { mark, granted: data.granted.toFixed(2) })
      : "";
    body = (
      <span className="udLane">
        <span className="udTag">{t("lane.ds")}</span>
        <span className="udNum">
          {t("quota.deepseek", { mark, balance })}
          {granted && <span className="udReset"> {granted}</span>}
        </span>
      </span>
    );
    const lines = [`${data.vendorLabel ?? "DeepSeek"}`];
    if (granted) lines.push(granted.trim());
    lines.push(state.loading ? t("quota.refreshing") : t("quota.refresh"));
    tooltip = lines.join("\n");
  }

  return (
    <button
      type="button"
      className={`udGroup${state.loading ? " udBusy" : ""}${error ? " udQuotaError" : ""}`.trim()}
      title={tooltip}
      aria-label={t("quota.refresh")}
      onClick={() => onRefresh?.()}
    >
      {body}
    </button>
  );
}

// Click-to-refresh: bump a signal that makes QuotaGroup re-query with
// refresh=1 (the host route bypasses its 60s cache for that call).
function UsageDock({ useProjection, t }) {
  const selection = useProjection("modelSelection");
  const [refreshKey, setRefreshKey] = useState(0);
  const current = selection?.next ?? selection?.lastUsed ?? null;
  const provider = current?.provider ?? "";
  const model = current?.model ?? "";

  return (
    <div className="udRoot" data-plugin="dsh-usage-dock">
      <QuotaGroup
        provider={provider}
        model={model}
        refreshSignal={refreshKey}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        t={t}
      />
    </div>
  );
}

export const inject = ["slots", "locale"];

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "usage-dock: locale dictionaries");
  ctx.slots.inject(
    "conversation.composer.dock",
    () =>
      ctx.slots.register(
        {
          name: "conversation.composer.dock",
          id: "usage-dock",
          order: 10,
          locale: NS,
        },
        UsageDock
      ),
    "usage-dock: composer dock entry"
  );
}
