// Offline smoke test for the built client bundle (lib/client.js).
// Usage: node scripts/smoke-client.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

// --- module loader facade --------------------------------------------------
let captured = null;
globalThis.window = {
  __ModuleLoader__: { load: (def) => { captured = def; } },
};
new Function("window", src)(globalThis.window);
if (!captured) throw new Error("bundle did not call __ModuleLoader__.load");

// --- stub modules ------------------------------------------------------------
// Minimal hooks: per-call-order state cells (cursor resets each render pass)
// plus effect queue with cleanup handling so intervals don't wedge the process.
const hooks = { cells: [], cursor: 0, pending: [], cleanups: [] };
const react = {
  useEffect: (fn) => { hooks.pending.push(fn); },
  useRef: () => ({ current: 0 }),
  useState: (init) => {
    const i = hooks.cursor++;
    if (!(i in hooks.cells)) hooks.cells[i] = typeof init === "function" ? init() : init;
    return [hooks.cells[i], (up) => { hooks.cells[i] = typeof up === "function" ? up(hooks.cells[i]) : up; }];
  },
};
const h = (type, props) => ({ type, props: props ?? {} });
const jsxRuntime = { jsx: h, jsxs: h, Fragment: "Fragment" };
const modules = new Map([
  ["react", { exports: react }],
  ["react/jsx-runtime", { exports: jsxRuntime }],
]);
const requireStub = (name) => {
  if (!modules.has(name)) modules.set(name, { exports: {} });
  return modules.get(name).exports;
};

const clientExports = captured.factory(requireStub);
console.log("apply:", typeof clientExports.apply, "| inject:", JSON.stringify(clientExports.inject));

// --- drive apply() -----------------------------------------------------------
const registered = [];
const localeDicts = {};
const ctx = {
  effect: (fn) => fn(),
  locale: { register: (ns, dicts) => { localeDicts[ns] = dicts; return () => {}; } },
  slots: {
    inject: (_slot, fn) => { const dispose = fn(); return typeof dispose === "function" ? dispose : () => {}; },
    register: (opts, component) => { registered.push({ opts, component }); return () => {}; },
  },
};
clientExports.apply(ctx);
const entry = registered[0];
console.log("slot entry:", entry.opts.name, "id=" + entry.opts.id, "order=" + entry.opts.order, "locale=" + entry.opts.locale);

const zh = localeDicts["usage-dock"].zh;
const en = localeDicts["usage-dock"].en;
console.log("zh keys:", Object.keys(zh).length, "| en keys:", Object.keys(en).length);
if (Object.keys(zh).length !== Object.keys(en).length) throw new Error("locale key mismatch");
if ("lane.ctx" in zh || "ctx.tooltip" in zh) throw new Error("ctx lane keys should be gone");

const t = (key, params) => {
  let s = zh[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) s = s.replaceAll(`{${k}}`, v);
  return s;
};

// --- fake fetch ----------------------------------------------------------------
const fetches = [];
const samplePayload = () => ({
  ok: true, vendor: "zhipu", vendorLabel: "智谱 GLM Coding Plan", keyRef: "ZAI_CODING_CN_API_KEY", level: "lite",
  fiveHour: { usedPct: 11, used: 219, total: 2000, remaining: 1781, resetAt: 1790489374013 },
  weekly: { usedPct: 61, used: 6100, total: 10000, remaining: 3900, resetAt: 1790529015976 },
  fetchedAt: 1790479000000,
});
globalThis.fetch = async (url) => { fetches.push(String(url)); return { json: async () => samplePayload() }; };

const kids = (node) => {
  const c = node.props.children;
  return (Array.isArray(c) ? c : c !== undefined ? [c] : []).flat(2).filter(Boolean);
};

// --- render UsageDock (initial load) -------------------------------------------
const UsageDock = entry.component;
const selection = { next: { provider: "zai-coding-cn", model: "glm-5.3" } };
const renderDock = () => { hooks.cursor = 0; return UsageDock({
  useProjection: (key) => (key === "modelSelection" ? selection : undefined),
  t,
}, h); };

const tree = renderDock();
const rootKids = kids(tree);
console.log("root:", tree.type, tree.props.className, "| children:", rootKids.length, "(expect 1: quota group only, no CTX lane)");

// Run the mounted effect: first load without refresh flag. Invoking the
// QuotaGroup function body is what queues its useEffect.
const runEffects = async () => {
  for (const cleanup of hooks.cleanups.splice(0)) { try { cleanup(); } catch {} }
  const fns = hooks.pending.splice(0);
  for (const fn of fns) { const d = fn(); if (typeof d === "function") hooks.cleanups.push(d); }
  await new Promise((r) => setTimeout(r, 10));
};
let group = rootKids[0].type(rootKids[0].props); // body runs -> effect queued
await runEffects();
console.log("initial fetch:", fetches[0], "| refresh flag absent:", !fetches[0].includes("refresh=1"));

// Populate state and inspect the rendered group. Cell 0 = UsageDock's
// refreshKey (its body ran first); cell 1 = QuotaGroup's state.
hooks.cells[1] = { loading: false, data: samplePayload() };
hooks.cursor = 1;
group = rootKids[0].type(rootKids[0].props);
console.log("group is button:", group.type === "button", "| class:", group.props.className, "| aria:", group.props["aria-label"]);
const lanes = kids(group).filter((n) => typeof n.type === "string" && /udLane/.test(n.props.className ?? ""));
console.log("lanes:", lanes.length, "| tags:", lanes.map((l) => kids(l)[0]?.props?.children));
const laneFacts = {};
for (const lane of lanes) {
  const parts = kids(lane);
  const tag = parts[0].props.children;
  const cellsNode = parts.find((n) => typeof n.type === "function");
  const cellsSpan = cellsNode.type(cellsNode.props);
  const cells = cellsSpan.props.children;
  const pctRaw = parts.find((n) => /udNum/.test(n.props.className ?? "")).props.children;
  const pct = Array.isArray(pctRaw) ? pctRaw.join("") : String(pctRaw);
  const texts = parts.map((n) => {
    const c = n.props.children;
    if (typeof c === "string") return c;
    if (Array.isArray(c) && c.every((x) => typeof x === "string" || typeof x === "number")) return c.join("");
    return null;
  }).filter(Boolean);
  laneFacts[tag] = {
    cells: cells.length,
    lit: cells.filter((c) => c.props.className.includes("udCellOn")).length,
    pct,
    texts,
  };
  console.log(`lane ${tag}: cells=${cells.length} lit=${laneFacts[tag].lit} pct=${pct} texts=${JSON.stringify(texts)}`);
}

// --- click-to-refresh ------------------------------------------------------------
group.props.onClick();  // bumps refreshKey (cell 0) via the captured setter
const refreshedTree = renderDock();
const refreshedQuota = kids(refreshedTree)[0];
hooks.cursor = 1; // continue after UsageDock's cell so QuotaGroup reuses cell 1
refreshedQuota.type(refreshedQuota.props); // re-run body -> effect queued with refreshSignal=1
await runEffects();
const lastFetch = fetches[fetches.length - 1];
console.log("click fetch:", lastFetch, "| has refresh=1:", lastFetch.includes("refresh=1"));
for (const cleanup of hooks.cleanups.splice(0)) { try { cleanup(); } catch {} } // stop intervals

// --- string checks on the bundle ---------------------------------------------
// Sample: 5H used 11% (remaining 1781/2000 = 89%) -> 9 cells lit, pct "89%".
// Weekly used 61% (remaining 3900/10000 = 39%) -> 4 cells lit, pct "39%".
const checks = {
  "dock anchor override present": src.includes('div[data-slot="conversation.composer.dock"]'),
  "!important beats inline contents": src.includes("display:flex !important"),
  "element part lifts specificity": src.includes('div[data-slot="conversation.composer.dock"]>*'),
  "row is centered and wraps": src.includes("justify-content:center") && src.includes("flex-wrap:wrap"),
  "entry shells neutralized": src.includes('conversation.composer.dock"]>*{width:auto'),
  "no absolute parking left over": !src.includes("position:absolute"),
  "retro cells css": src.includes(".udCellOn") && src.includes(".udCells"),
  "busy feedback css": src.includes("button.udGroup.udBusy"),
  "no ContextLane component": !src.includes("ContextLane") && !src.includes("contextPressure"),
  "zh weekly tag 周": zh["lane.wk"] === "周",
  "en weekly tag WK": en["lane.wk"] === "WK",
  "no quota.left key left": !("quota.left" in zh) && !("quota.left" in en) && !src.includes("quota.left"),
  "remaining tooltip key zh": zh["quota.remaining"].startsWith("剩余 {pct}%"),
  "5H shows remaining 89%": laneFacts["5H"]?.pct === "89%",
  "5H drains to 9 lit cells": laneFacts["5H"]?.lit === 9,
  "weekly shows remaining 39%": laneFacts["周"]?.pct === "39%",
  "weekly drains to 4 lit cells": laneFacts["周"]?.lit === 4,
  "no absolute-credit text in lanes": laneFacts["5H"] && !laneFacts["5H"].texts.some((s) => s.startsWith("剩")) && laneFacts["周"] && !laneFacts["周"].texts.some((s) => s.startsWith("剩")),
  "refresh hint zh": zh["quota.refresh"] === "点击立即刷新",
};
let failed = false;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (failed) throw new Error("smoke checks failed");
console.log("SMOKE OK");
