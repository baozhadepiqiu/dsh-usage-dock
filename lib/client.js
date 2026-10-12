window.__ModuleLoader__.load({
	id: "dsh-usage-dock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "usage-dock";
var CSS = (
  // Turn the composer-dock anchor from `display:contents` (inline style) into
  // a real wrapping centered flex row — !important is the only way a
  // stylesheet beats an inline style. Every dock entry (the built-in `stats`
  // row and this one) then flows on one shared, centered line; the row wraps
  // back to centered lines on narrow viewports.
  'div[data-slot="conversation.composer.dock"]{display:flex !important;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 12px;width:100%;max-width:var(--dsh-chat-content-width);box-sizing:border-box;margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}div[data-slot="conversation.composer.dock"]>*{width:auto;max-width:100%;padding:0;margin:0}.udRoot{align-items:center;flex-wrap:wrap;justify-content:center;gap:4px 14px;font-variant-numeric:tabular-nums;display:inline-flex}.udLane{color:var(--dsw-alias-label-tertiary);font:inherit;white-space:nowrap;align-items:center;gap:6px;display:inline-flex}.udLaneWarn{color:var(--dsw-alias-state-warn-primary)}.udLaneDanger{color:var(--dsw-alias-state-error-primary)}.udTag{flex:none;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace);font-size:10px;line-height:14px;letter-spacing:.1em;padding:0 4px;border:1px solid color-mix(in srgb,currentColor 45%,transparent);border-radius:3px;opacity:.9}.udCells{flex:none;display:inline-flex;gap:2px;padding:2px;border:1px solid color-mix(in srgb,currentColor 30%,transparent);border-radius:4px;background:color-mix(in srgb,currentColor 5%,transparent)}.udCell{width:6px;height:9px;border-radius:1px;background:currentColor;opacity:.13}.udCellOn{opacity:1}.udNum{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace)}.udReset{opacity:.85}button.udGroup{cursor:pointer;background:0 0;border:none;border-radius:24px;padding:1px 8px;font:inherit;color:inherit;align-items:center;flex-wrap:wrap;justify-content:center;gap:4px 14px;display:inline-flex;transition:opacity .15s ease}button.udGroup:hover{background:var(--dsw-alias-interactive-bg-hover)}button.udGroup.udBusy{opacity:.55}.udQuotaError{color:var(--dsw-alias-state-warn-primary)}.udQuotaError .udLane{color:inherit}'
);
if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="usage-dock"]') === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-usage-dock";
  tag.dataset.pluginCss = "usage-dock";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
var zh = {
  "lane.5h": "5H",
  "lane.wk": "\u5468",
  "lane.ds": "DS",
  "quota.5h": "5 \u5C0F\u65F6\u7A97\u53E3",
  "quota.weekly": "\u6BCF\u5468\u7A97\u53E3",
  "quota.remaining": "\u5269\u4F59 {pct}%\uFF08\u5269 {remaining} / {total}\uFF0C\u5DF2\u7528 {used}\uFF09",
  "quota.reset": "\u91CD\u7F6E {time}",
  "quota.level": "\u6863\u4F4D {level}",
  "quota.error": "\u8D39\u7528\u67E5\u8BE2\u5931\u8D25",
  "quota.nokey": "\u672A\u914D\u7F6E\u5BC6\u94A5",
  "quota.refresh": "\u70B9\u51FB\u7ACB\u5373\u5237\u65B0",
  "quota.refreshing": "\u6B63\u5728\u67E5\u8BE2\u6700\u65B0\u989D\u5EA6\u2026",
  "quota.deepseek": "\u4F59\u989D {mark}{balance}",
  "quota.granted": "\uFF08\u542B\u8D60\u9001 {mark}{granted}\uFF09",
  "quota.key": "\u5BC6\u94A5 {ref}"
};
var en = {
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
  "quota.refreshing": "Querying latest quota\u2026",
  "quota.deepseek": "Balance {mark}{balance}",
  "quota.granted": " (incl. granted {mark}{granted})",
  "quota.key": "Key {ref}"
};
var two = (n) => String(n).padStart(2, "0");
function resetLabel(resetAt, weekly) {
  if (resetAt === null || resetAt === void 0) return "";
  const ms = typeof resetAt === "number" ? resetAt : Date.parse(resetAt);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (!weekly) return clock;
  try {
    return `${new Intl.DateTimeFormat(void 0, { weekday: "short" }).format(d)} ${clock}`;
  } catch {
    return clock;
  }
}
function exactInt(value) {
  if (value === null || !Number.isFinite(value)) return "\u2014";
  try {
    return value.toLocaleString(void 0);
  } catch {
    return String(value);
  }
}
var CELLS = 10;
function Cells({ total, filled }) {
  const cells = [];
  for (let i = 0; i < total; i++) {
    cells.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: i < filled ? "udCell udCellOn" : "udCell" }, i));
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "udCells", "aria-hidden": "true", children: cells });
}
function toneFor(remainingPct) {
  return remainingPct <= 10 ? "udLaneDanger" : remainingPct <= 30 ? "udLaneWarn" : "";
}
function remainingPctOf(window) {
  if (window.remaining != null && window.total) {
    return Math.max(0, Math.min(100, Math.round(window.remaining / window.total * 100)));
  }
  const used = Math.max(0, Math.min(100, Math.round(window.usedPct ?? 0)));
  return 100 - used;
}
function windowLane(window, tag, weekly, t) {
  if (!window) return null;
  const remainingPct = remainingPctOf(window);
  const filled = remainingPct <= 0 ? 0 : Math.max(1, Math.round(remainingPct / 100 * CELLS));
  const reset = resetLabel(window.resetAt, weekly);
  const tooltip = [
    t("quota.remaining", {
      pct: String(remainingPct),
      used: exactInt(window.used),
      total: exactInt(window.total),
      remaining: exactInt(window.remaining)
    }),
    reset ? t("quota.reset", { time: reset }) : ""
  ].filter(Boolean).join(" \xB7 ");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "span",
    {
      className: `udLane ${toneFor(remainingPct)}`.trim(),
      title: tooltip,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "udTag", children: tag }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cells, { total: CELLS, filled }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "udNum", children: [
          remainingPct,
          "%"
        ] }),
        reset && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "udNum udReset", children: [
          "\u21BB",
          reset
        ] })
      ]
    },
    tag
  );
}
var POLL_MS = 5 * 60 * 1e3;
function QuotaGroup({ provider, model, refreshSignal, onRefresh, t }) {
  const [state, setState] = (0, import_react.useState)({ loading: false, data: null });
  const generation = (0, import_react.useRef)(0);
  (0, import_react.useEffect)(() => {
    const gen = ++generation.current;
    let cancelled = false;
    const load = async (refresh) => {
      setState((s) => ({ ...s, loading: true }));
      let data2;
      try {
        const qs = `provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}${refresh ? "&refresh=1" : ""}`;
        const res = await fetch(`/dsh-usage-dock/status?${qs}`, { headers: { Accept: "application/json" } });
        data2 = await res.json();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        data2 = { ok: false, code: "HTTP", error: message };
      }
      if (!cancelled && gen === generation.current) setState({ loading: false, data: data2 });
    };
    if (provider !== "" || model !== "") void load(refreshSignal > 0);
    const timer = setInterval(() => void load(false), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [provider, model, refreshSignal]);
  const data = state.data;
  if (data && !data.ok && data.code === "UNSUPPORTED") return null;
  let body;
  let tooltip;
  let error = false;
  if (data == null) {
    body = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "udLane", children: t("quota.refresh") });
    tooltip = t("quota.refresh");
  } else if (!data.ok) {
    error = true;
    const label = data.code === "NO_KEY" ? t("quota.nokey") : t("quota.error");
    body = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "udLane", children: label });
    tooltip = `${data.error ?? ""}
${t("quota.refresh")}`.trim();
  } else if (data.vendor === "zhipu") {
    const ds = data;
    body = [
      windowLane(ds.fiveHour, t("lane.5h"), false, t),
      windowLane(ds.weekly, t("lane.wk"), true, t)
    ];
    const lines = [`${ds.vendorLabel ?? "\u667A\u8C31 GLM Coding Plan"}${ds.level ? ` \xB7 ${t("quota.level", { level: ds.level })}` : ""}`];
    if (ds.fiveHour) lines.push(`${t("quota.5h")}\uFF1A${t("quota.remaining", { pct: String(remainingPctOf(ds.fiveHour)), used: exactInt(ds.fiveHour.used), total: exactInt(ds.fiveHour.total), remaining: exactInt(ds.fiveHour.remaining) })}${ds.fiveHour.resetAt != null ? ` \xB7 ${t("quota.reset", { time: resetLabel(ds.fiveHour.resetAt, false) })}` : ""}`);
    if (ds.weekly) lines.push(`${t("quota.weekly")}\uFF1A${t("quota.remaining", { pct: String(remainingPctOf(ds.weekly)), used: exactInt(ds.weekly.used), total: exactInt(ds.weekly.total), remaining: exactInt(ds.weekly.remaining) })}${ds.weekly.resetAt != null ? ` \xB7 ${t("quota.reset", { time: resetLabel(ds.weekly.resetAt, true) })}` : ""}`);
    if (ds.keyRef) lines.push(t("quota.key", { ref: ds.keyRef }));
    lines.push(state.loading ? t("quota.refreshing") : t("quota.refresh"));
    tooltip = lines.join("\n");
  } else {
    const ds = data;
    const mark = ds.currency === "USD" ? "$" : "\xA5";
    const balance = typeof ds.balance === "number" ? ds.balance.toFixed(2) : "\u2014";
    const granted = typeof ds.granted === "number" && ds.granted > 0 ? t("quota.granted", { mark, granted: ds.granted.toFixed(2) }) : "";
    body = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "udLane", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "udTag", children: t("lane.ds") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "udNum", children: [
        t("quota.deepseek", { mark, balance }),
        granted && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "udReset", children: [
          " ",
          granted
        ] })
      ] })
    ] });
    const lines = [`${ds.vendorLabel ?? "DeepSeek"}`];
    if (granted) lines.push(granted.trim());
    lines.push(state.loading ? t("quota.refreshing") : t("quota.refresh"));
    tooltip = lines.join("\n");
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      className: `udGroup${state.loading ? " udBusy" : ""}${error ? " udQuotaError" : ""}`.trim(),
      title: tooltip,
      "aria-label": t("quota.refresh"),
      onClick: () => onRefresh?.(),
      children: body
    }
  );
}
function UsageDock({ useProjection, t }) {
  const selection = useProjection("modelSelection");
  const [refreshKey, setRefreshKey] = (0, import_react.useState)(0);
  const current = selection?.next ?? selection?.lastUsed ?? null;
  const provider = current?.provider ?? "";
  const model = current?.model ?? "";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "udRoot", "data-plugin": "dsh-usage-dock", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    QuotaGroup,
    {
      provider,
      model,
      refreshSignal: refreshKey,
      onRefresh: () => setRefreshKey((k) => k + 1),
      t
    }
  ) });
}
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "usage-dock: locale dictionaries");
  ctx.slots.inject(
    "conversation.composer.dock",
    () => ctx.slots.register(
      {
        name: "conversation.composer.dock",
        id: "usage-dock",
        order: 10,
        locale: NS
      },
      UsageDock
    ),
    "usage-dock: composer dock entry"
  );
}

		return module.exports;
	}
});
