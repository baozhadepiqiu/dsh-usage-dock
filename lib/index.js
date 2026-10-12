import dns from "node:dns";
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
}
const name = "usage-dock";
function rec(value) {
  return value !== null && typeof value === "object" ? value : null;
}
function str(value) {
  return typeof value === "string" ? value : "";
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}
const ZHIPU_KEY_REFS = ["ZHIPU_API_KEY", "GLM_API_KEY"];
const DEEPSEEK_KEY_REFS = ["DEEPSEEK_API_KEY"];
const ZHIPU_ENDPOINTS = {
  cn: {
    url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    label: "\u667A\u8C31 GLM Coding Plan"
  },
  intl: {
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
    label: "\u667A\u8C31 GLM Coding Plan\uFF08\u56FD\u9645 z.ai\uFF09"
  }
};
function zhipuEndpoint(provider) {
  const p = String(provider ?? "").toLowerCase();
  const intl = p.includes("intl") || p.includes("z.ai") && !p.includes("cn");
  return intl ? ZHIPU_ENDPOINTS.intl : ZHIPU_ENDPOINTS.cn;
}
const DEEPSEEK_ENDPOINT = {
  url: "https://api.deepseek.com/user/balance",
  label: "DeepSeek"
};
const VENDORS = {
  zhipu: {
    keyRefs: ZHIPU_KEY_REFS,
    missingKeyHint: "\u672A\u627E\u5230\u8BE5\u6A21\u578B\u7684 API \u5BC6\u94A5\uFF08\u6309 provider \u7684 apiKeyEnv\uFF08\u5982 ZAI_CODING_CN_API_KEY\uFF09\u3001ZHIPU_API_KEY\u3001GLM_API_KEY \u987A\u5E8F\u89E3\u6790\uFF1B\u53EF\u5728 \u8BBE\u7F6E \u2192 API \u5BC6\u94A5 \u914D\u7F6E\uFF09"
  },
  deepseek: {
    keyRefs: DEEPSEEK_KEY_REFS,
    missingKeyHint: "\u672A\u8BBE\u7F6E DEEPSEEK_API_KEY\uFF08\u8BBE\u7F6E \u2192 API \u5BC6\u94A5\uFF0C\u6216\u73AF\u5883\u53D8\u91CF\uFF09"
  }
};
function detectVendor(provider, model) {
  const s = `${provider ?? ""} ${model ?? ""}`.toLowerCase();
  if (/(^|[^a-z])(glm|zai)([^a-z]|$)/.test(s) || s.includes("zhipu") || s.includes("bigmodel") || s.includes("z.ai") || s.includes("z-ai")) return "zhipu";
  if (s.includes("deepseek")) return "deepseek";
  return null;
}
const HTTP_TIMEOUT_MS = 8e3;
const RETRY_DELAY_MS = 700;
const CACHE_TTL_MS = 6e4;
function zhipuPlanMissing(data) {
  const obj = rec(data);
  const msg = `${str(obj?.["msg"]) || str(obj?.["message"])}`;
  const code = String(obj?.["code"] ?? "");
  if (msg.includes("coding plan") || msg.includes("\u4E0D\u5B58\u5728") || msg.includes("\u672A\u8BA2\u9605")) return msg;
  if (code && code !== "0" && code !== "200" && msg) return msg;
  return null;
}
function zhipuLane(entry) {
  if (!entry || typeof entry !== "object") return null;
  const e = entry;
  const used = num(e["currentValue"]);
  const total = num(e["usage"]);
  let pct = num(e["percentage"]);
  if (!Number.isFinite(pct) && Number.isFinite(used) && total > 0) pct = used / total * 100;
  if (!Number.isFinite(pct)) return null;
  const remaining = num(e["remaining"]);
  const resetAt = num(e["nextResetTime"]);
  return {
    usedPct: Math.max(0, Math.min(100, Math.round(pct))),
    used: Number.isFinite(used) ? used : null,
    total: Number.isFinite(total) && total > 0 ? total : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetAt: Number.isFinite(resetAt) ? resetAt : null
  };
}
function parseZhipuQuota(data) {
  const root = rec(rec(data)?.["data"]);
  const rawLimits = root?.["limits"];
  const limits = Array.isArray(rawLimits) ? rawLimits.filter((e) => !!e && typeof e === "object") : [];
  const windows = limits.filter((e) => e["type"] !== "TIME_LIMIT");
  if (windows.length === 0) return { ok: false, code: "PARSE", error: "\u989D\u5EA6\u63A5\u53E3\u8FD4\u56DE\u65E0\u6CD5\u89E3\u6790\uFF08limits \u4E3A\u7A7A\uFF09" };
  const pools = [
    windows.filter((e) => e["type"] === "TOKENS_LIMIT"),
    windows.filter((e) => e["type"] === "CREDIT_LIMIT"),
    windows
  ];
  const pickByUnit = (unit) => {
    for (const pool of pools) {
      const hit = pool.find((e) => num(e["unit"]) === unit);
      if (hit) return hit;
    }
    return null;
  };
  let fiveHour = zhipuLane(pickByUnit(3));
  let weekly = zhipuLane(pickByUnit(6));
  if (!fiveHour || !weekly) {
    const byReset = [...windows].filter((e) => Number.isFinite(num(e["nextResetTime"]))).sort((a, b) => num(a["nextResetTime"]) - num(b["nextResetTime"]));
    if (!fiveHour && byReset.length >= 1) fiveHour = zhipuLane(byReset[0]);
    if (!weekly && byReset.length >= 2) weekly = zhipuLane(byReset[byReset.length - 1]);
  }
  if (!fiveHour && !weekly) return { ok: false, code: "PARSE", error: "\u989D\u5EA6\u63A5\u53E3\u8FD4\u56DE\u65E0\u6CD5\u89E3\u6790\uFF08\u672A\u8BC6\u522B\u989D\u5EA6\u7A97\u53E3\uFF09" };
  const level = root?.["level"] != null ? String(root["level"]) : str(root?.["planName"]);
  return { ok: true, fiveHour, weekly, level };
}
function parseDeepSeekBalance(data) {
  const root = rec(data);
  const infos = Array.isArray(root?.["balance_infos"]) ? root["balance_infos"] : [];
  const info = rec(infos.find((x) => !!x && typeof x === "object"));
  if (!info) return { ok: false, code: "PARSE", error: "\u4F59\u989D\u63A5\u53E3\u8FD4\u56DE\u65E0\u6CD5\u89E3\u6790\uFF08\u7F3A\u5C11 balance_infos\uFF09" };
  const total = num(info["total_balance"]);
  const granted = num(info["granted_balance"]);
  return {
    ok: true,
    currency: typeof info["currency"] === "string" && info["currency"] ? info["currency"] : "CNY",
    balance: Number.isFinite(total) ? total : null,
    granted: Number.isFinite(granted) ? granted : null
  };
}
async function fetchJson(url, headers) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (!res.ok) {
        const detail = body ? String(body["msg"] ?? body["message"] ?? "") : "";
        return { status: res.status, body, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 140)}` : ""}` };
      }
      return { status: res.status, body, error: null };
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { status: 0, body: null, error: `\u8BF7\u6C42\u5931\u8D25: ${message.slice(0, 140)}` };
}
function apply(root) {
  root.inject(["webServer", "credentials"], (ctx) => {
    const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
    const disposers = [];
    root.effect(() => () => {
      for (const d of disposers) {
        try {
          d();
        } catch {
        }
      }
    });
    const TRUSTED_HOSTS = String(process.env["DSH_USAGE_DOCK_TRUSTED_HOSTS"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    function isLoopbackHostname(hn) {
      const h = String(hn ?? "").toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
      if (!h) return false;
      if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
      if (!m || Number(m[1]) !== 127) return false;
      return [m[2], m[3], m[4]].every((x) => Number(x) <= 255);
    }
    function selfRejection(req) {
      try {
        const headers = rec(req?.headers) ?? {};
        let hostUrl;
        try {
          hostUrl = new URL("http://" + String(headers["host"] ?? ""));
        } catch {
          return 403;
        }
        const hostname = hostUrl.hostname;
        const authority = hostUrl.host.toLowerCase();
        if (!isLoopbackHostname(hostname) && !TRUSTED_HOSTS.includes(authority) && !TRUSTED_HOSTS.includes(hostname.toLowerCase())) return 403;
        const site = String(headers["sec-fetch-site"] ?? "").toLowerCase();
        if (site === "cross-site") return 403;
        const origin = headers["origin"];
        if (typeof origin === "string" && origin && origin !== "null") {
          let originUrl;
          try {
            originUrl = new URL(origin);
          } catch {
            return 403;
          }
          if (originUrl.host.toLowerCase() !== authority) return 403;
        }
        return null;
      } catch {
        return 403;
      }
    }
    function settingsService() {
      try {
        return ctx.get("settings") ?? null;
      } catch {
        return null;
      }
    }
    function settingsSection(ns) {
      const settings = settingsService();
      if (!settings) return null;
      if (typeof settings.describe === "function") {
        try {
          const row = settings.describe().find((d) => d?.ns === ns);
          return rec(row?.value);
        } catch {
          return null;
        }
      }
      if (typeof settings.get === "function") {
        try {
          return rec(settings.get(ns));
        } catch {
          return null;
        }
      }
      return null;
    }
    function keyRefsFor(vendor, provider) {
      const refs = [];
      const providers = rec(settingsSection("llm-pi-ai")?.["providers"]);
      const env = str(rec(providers?.[provider])?.["apiKeyEnv"]);
      if (env) refs.push(env);
      if (vendor === "deepseek") {
        const env2 = str(settingsSection("llm-deepseek")?.["apiKeyEnv"]);
        if (env2) refs.push(env2);
      }
      refs.push(...VENDORS[vendor].keyRefs);
      return refs;
    }
    async function recordKey(provider) {
      try {
        if (typeof ctx.credentials.readRecord !== "function") return null;
        const record = await ctx.credentials.readRecord(`llm-pi-ai/${provider}`);
        if (!record || typeof record !== "object") return null;
        if (typeof record.key === "string" && record.key) return record.key;
        const env = record.env;
        if (env && typeof env === "object") {
          for (const value of Object.values(env)) {
            if (typeof value === "string" && value) return value;
          }
        }
      } catch {
      }
      return null;
    }
    async function resolveKey(vendor, provider) {
      const refs = keyRefsFor(vendor, provider);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          for (const ref of refs) {
            const hit = await ctx.credentials.resolve(ref);
            if (hit && typeof hit.value === "string" && hit.value) return { key: hit.value, ref };
          }
          const fromRecord = await recordKey(provider);
          if (fromRecord) return { key: fromRecord, ref: `llm-pi-ai/${provider}` };
          return { key: null, ref: null };
        } catch (err) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          const message = err instanceof Error ? err.message : String(err);
          return { key: null, ref: null, error: message.slice(0, 160) };
        }
      }
      return { key: null, ref: null };
    }
    const cache = /* @__PURE__ */ new Map();
    const inFlight = /* @__PURE__ */ new Map();
    async function computeStatus(vendor, provider) {
      const spec = VENDORS[vendor];
      const endpoint = vendor === "zhipu" ? zhipuEndpoint(provider) : DEEPSEEK_ENDPOINT;
      const { key, ref, error } = await resolveKey(vendor, provider);
      if (error) return { ok: false, code: "NO_KEY", error: `\u51ED\u636E\u8BFB\u53D6\u5931\u8D25: ${error}` };
      if (!key) return { ok: false, code: "NO_KEY", error: spec.missingKeyHint };
      const headers = vendor === "zhipu" ? { Authorization: key } : { Authorization: `Bearer ${key}` };
      const { body, error: httpError } = await fetchJson(endpoint.url, headers);
      if (httpError && body === null) return { ok: false, code: "HTTP", error: httpError };
      if (vendor === "zhipu") {
        const noPlan = zhipuPlanMissing(body);
        if (noPlan) return { ok: false, code: "NO_PLAN", error: `\u8BE5\u8D26\u53F7\u6CA1\u6709 Coding Plan \u8BA2\u9605\uFF08${noPlan.slice(0, 120)}\uFF09` };
        if (!rec(body?.["data"])) {
          return { ok: false, code: "NO_PLAN", error: "\u989D\u5EA6\u63A5\u53E3\u8FD4\u56DE\u4E3A\u7A7A\uFF08\u53EF\u80FD\u7528\u666E\u901A API Key \u67E5\u8BE2\u5957\u9910\uFF0C\u6216\u56E2\u961F\u7248\u7F3A\u5C11 type=2 / \u7EC4\u7EC7\u8BF7\u6C42\u5934\uFF09" };
        }
        if (httpError) {
          const friendly = httpError.startsWith("HTTP 401") ? `${httpError}\uFF08API key \u65E0\u6548\u6216\u4E0D\u662F\u8BE5\u5E73\u53F0\u7684 key\uFF09` : httpError;
          return { ok: false, code: "HTTP", error: friendly };
        }
        const parsed2 = parseZhipuQuota(body);
        if (!parsed2.ok) return parsed2;
        const payload2 = { ...parsed2, vendor, vendorLabel: endpoint.label, keyRef: ref, fetchedAt: Date.now() };
        return payload2;
      }
      if (httpError) {
        const friendly = httpError.startsWith("HTTP 401") ? `${httpError}\uFF08API key \u65E0\u6548\u3001\u5DF2\u8FC7\u671F\uFF0C\u6216\u4E0D\u662F\u5B98\u65B9\u7AEF\u70B9\u7684 key\uFF09` : httpError;
        return { ok: false, code: "HTTP", error: friendly };
      }
      if (body && typeof body["code"] === "string" && body["code"] !== "0" && body["msg"]) {
        return { ok: false, code: "BIZ", error: String(body["msg"]).slice(0, 140) };
      }
      const parsed = parseDeepSeekBalance(body);
      if (!parsed.ok) return parsed;
      const payload = { ...parsed, vendor, vendorLabel: DEEPSEEK_ENDPOINT.label, keyRef: ref, fetchedAt: Date.now() };
      return payload;
    }
    async function getStatus(vendor, provider, refresh) {
      const endpoint = vendor === "zhipu" ? zhipuEndpoint(provider) : DEEPSEEK_ENDPOINT;
      const cacheKey = `${vendor}:${endpoint.url}`;
      if (refresh) cache.delete(cacheKey);
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;
      let p = inFlight.get(cacheKey);
      if (!p) {
        p = computeStatus(vendor, provider).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, code: "ERROR", error: message.slice(0, 160) };
        }).then((payload) => {
          cache.set(cacheKey, { at: Date.now(), payload });
          return payload;
        }).finally(() => {
          inFlight.delete(cacheKey);
        });
        inFlight.set(cacheKey, p);
      }
      return p;
    }
    disposers.push(ctx.webServer.register({
      kind: "exact",
      path: "/dsh-usage-dock/status",
      handler: async (req, res) => {
        const reject = selfRejection(req);
        if (reject !== null) {
          res.writeHead(reject, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("forbidden");
          return;
        }
        try {
          const params = new URL(req.url ?? "/", "http://localhost").searchParams;
          const provider = params.get("provider") ?? "";
          const model = params.get("model") ?? "";
          const refresh = params.get("refresh") === "1";
          const vendor = detectVendor(provider, model);
          if (!vendor) {
            res.writeHead(200, JSON_HEADERS);
            res.end(JSON.stringify({
              ok: false,
              code: "UNSUPPORTED",
              error: `\u672A\u652F\u6301\u7684\u8D39\u7528\u67E5\u8BE2\u5382\u5546\uFF08provider=${provider || "?"}, model=${model || "?"}\uFF1B\u7B2C\u4E00\u7248\u4EC5\u652F\u6301\u667A\u8C31 GLM Coding Plan \u4E0E DeepSeek\uFF09`
            }));
            return;
          }
          const payload = await getStatus(vendor, provider, refresh);
          res.writeHead(200, JSON_HEADERS);
          res.end(JSON.stringify(payload));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(200, JSON_HEADERS);
          res.end(JSON.stringify({ ok: false, code: "ERROR", error: message.slice(0, 200) }));
        }
      }
    }));
    try {
      console.log("[usage-dock] ready: GET /dsh-usage-dock/status?provider=<id>&model=<id>");
    } catch {
    }
  });
}
export {
  apply,
  name
};
