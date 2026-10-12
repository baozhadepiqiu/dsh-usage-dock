# 智谱 GLM Coding Plan 余额 / 额度查询文档（代码方式）

> 适用对象：订阅了智谱 **GLM Coding Plan**（Lite / Pro / Max，国内站 bigmodel.cn）并希望通过**代码（HTTP API）**查询套餐剩余额度的开发者。
>
> 信息来源：智谱官方文档（套餐概览 / 快速开始 / FAQ）、端点实测探测，以及两个维护中的开源实现（CodexBar、dsh-quota-panel）的交叉验证。截至 2025-10 有效。

---

## 0. 先搞清楚要查什么

Coding Plan 的"余额"和普通 API 的"账户余额"是**两回事**：

| 概念 | 含义 | 查询端点 |
|---|---|---|
| **套餐额度（本文重点）** | 5 小时窗口 + 每周窗口的积分/Token 配额，外加 MCP 工具月度调用额度 | `GET /api/monitor/usage/quota/limit` |
| 账户余额 | 现金余额 / 赠金 / 代金券（按量付费 API 用的钱） | `GET /api/paas/v4/users/me/balance` |

套餐额度规则（官方）：

| 套餐 | 5 小时积分 | 每周积分 |
|---|---|---|
| Lite | 2,000 | 10,000 |
| Pro | 12,000 | 60,000 |
| Max | 28,000 | 140,000 |

- **5 小时积分**：动态刷新——从请求消耗时刻起 5 小时后重置（不是整点对齐）。
- **周积分**：自下单时起以 7 天为一个周期刷新。
- 额度耗尽后**等待周期恢复即可，不会扣账户余额**。
- 网页端用量统计：<https://bigmodel.cn/coding-plan/personal/usage>

---

## 1. 推荐端点：套餐额度窗口查询

### 1.1 请求

```http
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
Authorization: Bearer <你的 Coding Plan API Key>
Accept: application/json
```

- **API Key**：在 [个人编程套餐 → 套餐概览](https://bigmodel.cn/coding-plan/personal/overview) 创建的 Key（团队版成员请在 [团队编程套餐 → 我的套餐](https://bigmodel.cn/coding-plan?z_plan=team) 获取**团队套餐 Key**，它与平台普通 API Key 不通用）。
- 国际站（Z.ai）对应端点为 `https://api.z.ai/api/monitor/usage/quota/limit`，请求方式完全相同。
- 普通 API Key 请求同一端点可查询该 Key 的调用配额（返回的 `limits` 结构略有差异）。

**团队版**（查团队用量）需要追加参数和请求头，缺失时会返回空 `data`：

```http
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2
Bigmodel-Organization: <组织 ID>
Bigmodel-Project: <项目 ID>
```

组织 ID / 项目 ID 可在团队用量页（`bigmodel.cn/coding-plan/team/usage-stats`）打开浏览器 DevTools → Network，观察对 `api/monitor/usage/quota/limit` 的请求头来获取。

### 1.2 响应结构

```json
{
  "code": 200,
  "msg": "success",
  "success": true,
  "data": {
    "planName": "GLM Coding Plan",
    "limits": [
      {
        "type": "CREDIT_LIMIT",
        "unit": 3,
        "number": 5,
        "percentage": 42,
        "currentValue": 5040,
        "usage": 12000,
        "remaining": 6960,
        "nextResetTime": 1758000000000
      },
      {
        "type": "CREDIT_LIMIT",
        "unit": 6,
        "number": 1,
        "percentage": 13,
        "currentValue": 7800,
        "usage": 60000,
        "remaining": 52200,
        "nextResetTime": 1758400000000
      },
      {
        "type": "TIME_LIMIT",
        "percentage": 5,
        "currentValue": 25,
        "usage": 500,
        "remaining": 475,
        "nextResetTime": 1758600000000
      }
    ]
  }
}
```

> 上例为积分制套餐（Pro）的典型形态；Token 制套餐对应行为 `TOKENS_LIMIT`，字段含义相同。以实际返回为准，建议首次调用先打印原始 JSON。

### 1.3 `limits[]` 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | `CREDIT_LIMIT` 积分窗口（现行积分制套餐）；`TOKENS_LIMIT` Token 窗口（旧/部分形态）；`TIME_LIMIT` MCP 工具月度调用次数 |
| `unit` + `number` | number | **窗口时长编码**。实测语义：`unit=3, number=5` → 5 小时窗口；`unit=6, number=1` → 每周窗口。遇到未知编码时，可按 `nextResetTime` 升序排列：最先重置的是 5h 窗口，最后重置的是周窗口 |
| `percentage` | number | **已用**百分比（0–100 整数）。缺失时可用 `currentValue / usage` 计算 |
| `usage` | number | 窗口总额度（积分总数或 Token 总数） |
| `currentValue` | number | 已用额度 |
| `remaining` | number | 剩余额度 |
| `nextResetTime` | number | 窗口重置时间，**Unix 毫秒时间戳** |

`data` 层的套餐名可能出现在 `planName`（或 `plan` / `plan_type` / `packageName` / `level`）字段。

---

## 2. 代码示例

### 2.1 curl（配合 jq）

```bash
curl -sS "https://open.bigmodel.cn/api/monitor/usage/quota/limit" \
  -H "Authorization: Bearer $ZHIPU_CODING_API_KEY" \
  -H "Accept: application/json" | jq .
```

### 2.2 Python（仅标准库）

```python
#!/usr/bin/env python3
"""查询智谱 GLM Coding Plan 套餐剩余额度。用法：ZHIPU_CODING_API_KEY=xxx python3 query_glm_quota.py"""
import json
import os
import time
from urllib.request import Request, urlopen

API_KEY = os.environ["ZHIPU_CODING_API_KEY"]
URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit"

req = Request(URL, headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})
with urlopen(req, timeout=15) as resp:
    body = json.load(resp)

if body.get("code") != 200:
    raise SystemExit(f"查询失败: {body}")

data = body.get("data") or {}
limits = data.get("limits") or []
tokens = [l for l in limits if l.get("type") == "TOKENS_LIMIT"]
credits = [l for l in limits if l.get("type") == "CREDIT_LIMIT"]


def pick(unit):
    """unit=3 -> 5 小时窗口, unit=6 -> 周窗口; Token 行优先, 积分行兜底。"""
    for pool in (tokens, credits):
        for l in pool:
            if l.get("unit") == unit:
                return l
    return None


def lane(l):
    if not l:
        return None
    used, total = l.get("currentValue"), l.get("usage")
    pct = l.get("percentage")
    if not isinstance(pct, (int, float)) and used is not None and total:
        pct = round(used / total * 100)
    reset = l.get("nextResetTime")
    return {
        "已用(%)": min(100, max(0, round(pct))) if pct is not None else None,
        "剩余": l.get("remaining"),
        "总额度": total,
        "重置时间": time.strftime("%Y-%m-%d %H:%M", time.localtime(reset / 1000)) if reset else None,
    }


result = {
    "套餐": data.get("planName"),
    "5小时窗口": lane(pick(3)),
    "每周窗口": lane(pick(6)),
    "MCP月度": lane(next((l for l in limits if l.get("type") == "TIME_LIMIT"), None)),
}
print(json.dumps(result, ensure_ascii=False, indent=2))
```

输出示例：

```json
{
  "套餐": "GLM Coding Plan",
  "5小时窗口": { "已用(%)": 42, "剩余": 6960, "总额度": 12000, "重置时间": "2025-09-16 17:20" },
  "每周窗口": { "已用(%)": 13, "剩余": 52200, "总额度": 60000, "重置时间": "2025-09-21 09:33" },
  "MCP月度": { "已用(%)": 5, "剩余": 475, "总额度": 500, "重置时间": "2025-10-01 00:00" }
}
```

### 2.3 Node.js（内置 fetch，Node ≥ 18）

```js
// 用法：ZHIPU_CODING_API_KEY=xxx node query-glm-quota.mjs
const API_KEY = process.env.ZHIPU_CODING_API_KEY;

const res = await fetch("https://open.bigmodel.cn/api/monitor/usage/quota/limit", {
  headers: { authorization: `Bearer ${API_KEY}`, accept: "application/json" },
});
const body = await res.json();
if (body.code !== 200) throw new Error(`查询失败: ${body.msg ?? JSON.stringify(body)}`);

const limits = body.data?.limits ?? [];
const pct = (l) => {
  if (Number.isFinite(l.percentage)) return Math.min(100, Math.max(0, Math.round(l.percentage)));
  if (Number.isFinite(l.currentValue) && l.usage > 0) return Math.round((l.currentValue / l.usage) * 100);
  return null;
};
const lane = (l) => l && {
  usedPct: pct(l),
  remaining: l.remaining,
  total: l.usage,
  resetsAt: l.nextResetTime ? new Date(l.nextResetTime).toLocaleString() : null,
};
const byUnit = (u) =>
  limits.find((l) => l.unit === u && l.type === "TOKENS_LIMIT") ??
  limits.find((l) => l.unit === u && l.type === "CREDIT_LIMIT");

console.log(JSON.stringify({
  plan: body.data?.planName,
  window5h: lane(byUnit(3)),
  weekly: lane(byUnit(6)),
  mcpMonthly: lane(limits.find((l) => l.type === "TIME_LIMIT")),
}, null, 2));
```

---

## 3. 补充端点：经典余额接口（`/users/me/balance`）

智谱平台另有一组旧版"资源接口"，可查**账户余额**（对 Coding Plan 用户通常为 0，因为套餐不消耗余额）：

```http
GET https://open.bigmodel.cn/api/paas/v4/users/me/balance
Authorization: Bearer <API Key>
```

```bash
curl -sS "https://open.bigmodel.cn/api/paas/v4/users/me/balance" \
  -H "Authorization: Bearer $ZHIPU_API_KEY" | jq .
```

常见返回形态：

```json
{
  "balanceInfo": {
    "balance": 0.0,
    "giftBalance": 0.0,
    "voucherBalance": 0.0,
    "usedTokens": 0
  }
}
```

| 字段 | 说明 |
|---|---|
| `balance` | 现金余额（元） |
| `giftBalance` | 赠金余额（元） |
| `voucherBalance` | 代金券余额（元） |
| `usedTokens` | 已消耗 Token 数 |
| `packageInfo[]` | （部分账号返回）资源包明细，含 `packageName`、`originPoints`、`remainingPoints`、`startTime`、`endTime` 等 |

另有 Coding 域下的同路径版本，历史上被社区用于读取套餐积分明细（`packageInfo` 中的 `remainingPoints`/`originPoints`）：

```http
GET https://open.bigmodel.cn/api/coding/paas/v4/users/me/balance
Authorization: Bearer <Coding Plan API Key>
```

> ⚠️ 注意：
> 1. 这两个端点**未列入现行官方 API 参考**，属于旧版接口，字段与可用性可能随账号/Key 类型变化，建议先打印原始 JSON 再写解析逻辑。
> 2. 现行积分制套餐的 5h/周窗口额度**以此返回为准不可靠**，请优先使用第 1 节的 `quota/limit` 端点。

---

## 4. 错误码与排查

| 现象 / 错误码 | 原因 | 处理 |
|---|---|---|
| `1001` Header中未收到Authorization参数 | 请求没带 `Authorization: Bearer ...` 头 | 检查请求头拼写与格式 |
| `1000` 身份验证失败 | Key 无效 / 过期 / 用错站点（国内站 Key 打到 api.z.ai，或反之） | 确认 Key 来源与站点匹配 |
| `code:200` 但 `data` 为空、`limits` 为空 | 用普通 API Key 查套餐；或团队版缺少 `type=2` / `Bigmodel-Organization` / `Bigmodel-Project` | 换用套餐 Key；团队版补齐参数与请求头 |
| `1113` 余额不足（调用模型时） | 不满足套餐使用条件：Base URL 配置错误，或不在官方支持的编码工具中调用 | 见下方 Base URL 表 |
| `unit` 编码对不上 | 平台调整窗口编码 | 按 `nextResetTime` 排序兜底：最先重置 = 5h 窗口，最后重置 = 周窗口 |

调用模型时的正确 Base URL（与余额查询无关，但常一起踩坑）：

| 协议 | Base URL |
|---|---|
| Anthropic Messages（Claude Code） | `https://open.bigmodel.cn/api/anthropic` |
| OpenAI Chat Completions（其他编码工具） | `https://open.bigmodel.cn/api/coding/paas/v4` |
| OpenAI Response 协议 | `https://open.bigmodel.cn/api/v1` |

---

## 5. 注意事项

1. **Key 安全**：不要把套餐 Key 硬编码进代码或提交到仓库；示例均从环境变量读取。
2. **轮询频率**：额度查询接口无需高频调用，60 秒一次已经足够；网页隐藏时应暂停轮询。
3. **套餐 ≠ 余额**：套餐额度耗尽不扣账户余额，查询账户余额看不到套餐剩余——两者必须分别查询。
4. **团队 Key**：团队套餐 Key 与个人/平台 Key 不通用，查询团队用量必须带团队 Key + 组织/项目请求头。
5. **字段演进**：`unit` 编码、`planName` 等字段来自社区工具对真实响应的交叉验证（CodexBar、dsh-quota-panel），官方未发布正式 API 参考，解析代码应对缺失字段保持容错。

---

## 附录：参考链接

- 官方套餐概览（积分额度与抵扣规则）：<https://docs.bigmodel.cn/cn/coding-plan/overview>
- 官方快速开始（Base URL 与 Key 获取）：<https://docs.bigmodel.cn/cn/coding-plan/quick-start>
- 官方 FAQ（含 1113 报错说明）：<https://docs.bigmodel.cn/cn/coding-plan/faq>
- 网页端用量统计：<https://bigmodel.cn/coding-plan/personal/usage>
- CodexBar z.ai/GLM 供应商调研（端点与团队头细节）：<https://github.com/steipete/CodexBar/blob/main/docs/zai.md>
- dsh-quota-panel（智谱 Coding 额度适配器源码）：<https://www.npmjs.com/package/dsh-quota-panel>
