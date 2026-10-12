# dsh-usage-dock

DSH Web 插件：在输入框下方的状态条里，与内置的"缓存命中"统计**同一行**显示复古分格式（LCD 格子 + 等宽数字）的**费用 / 套餐额度**。

![dsh-usage-dock 效果图](docs/screenshot.png)

```
5H ▕▓▓▓▓▓▓▓▓▓░▏89% ↻16:23   周 ▕▓▓▓▓░░░░░░▏39% ↻周二09:36
```

## 功能

- **智谱 GLM Coding Plan**（5H / 周两个窗口）——格子与百分比展示的都是**剩余额度**（电量随消耗一格一格掉）：
  剩余 ≤30% 变黄、≤10% 变红；重置时间随行显示（5H 显示 `HH:MM`，周显示 `周X HH:MM`），
  悬停可见 `剩余/总量/已用/重置` 明细与档位。
- **DS（DeepSeek）**——账户**余额**（含赠送金额明细）。
- 按当前工作区选中的模型（`modelSelection` 投影）自动切换查询方式，第一版仅这两家。

窗口解析按 `zhipu-coding-plan-balance-query.md`：`limits[]` 中 `unit=3` → 5 小时窗口、
`unit=6` → 每周窗口（`TOKENS_LIMIT` 行优先于 `CREDIT_LIMIT`，`TIME_LIMIT` 为 MCP 月度
额度不计入）；编码对不上时按 `nextResetTime` 排序兜底（最先重置 = 5H，最后 = 周）。

## 安装

```bash
dsh plugin --profile web add /home/lcg/app/dsh/dsh-usage-dock
systemctl --user restart dsh-web   # 让 bundle 变更生效
```

或从 GitHub 安装：

```bash
dsh plugin --profile web add https://github.com/baozhadepiqiu/dsh-usage-dock.git
systemctl --user restart dsh-web
```

## 密钥

走 DSH 凭据体系（设置 → API 密钥，或环境变量），本插件不落盘任何密钥。按 provider 路由解析，顺序为：

1. **路由自己的 `apiKeyEnv`**（`llm-pi-ai:` / `llm-deepseek:` 设置节）——如内置 `zai-coding-cn`
   路由声明 `ZAI_CODING_CN_API_KEY`，优先用它；
2. 厂商通用回退：智谱 `ZHIPU_API_KEY`、`GLM_API_KEY`；DeepSeek `DEEPSEEK_API_KEY`；
3. pi-ai 登录凭据记录 `llm-pi-ai/<provider>`。

| 厂商 | 查询端点 |
|---|---|
| 智谱（大陆，含 `zai-coding-cn` / `glm-*`） | `open.bigmodel.cn/api/monitor/usage/quota/limit` |
| 智谱（国际 z.ai，provider 含 `intl`/`z.ai`） | `api.z.ai/api/monitor/usage/quota/limit` |
| DeepSeek | `api.deepseek.com/user/balance` |

> 注意：智谱的额度接口只对**订阅套餐**（Coding Plan）账号有效；Token 资源包账号会返回
> "当前用户不存在coding plan"。`code:200` 但 `data` 为空通常是用普通 API Key 查询或
> 团队版缺 `type=2` / 组织请求头，此时显示"费用查询失败"，悬停可见原因。

## 刷新

- 点击整个额度区域 → 立即带 `refresh=1` 重新调用厂商接口（**绕过**服务端 60 秒缓存），
  请求期间数值变淡提示忙碌；
- 平时 5 分钟轮询一次（读缓存）。

数据走本插件在 Host 上注册的 `GET /dsh-usage-dock/status?provider=<id>&model=<id>`
（60 秒缓存，`refresh=1` 强制刷新）。

## 布局说明

dock 槽位（`conversation.composer.dock`）的渲染锚点是内联 `display:contents`，每个
entry 本会各占一行。本插件注入的样式表分两步把所有 entry 合到**同一条居中行**：

1. 用 `!important`（样式表重要声明是唯一能压过内联样式的手段）把锚点改成
   `display:flex; flex-wrap:wrap; justify-content:center` 的整行容器；
2. 用 `div[data-slot=…]>*` 把各 entry 外壳的 `width:100%`/内边距中和掉——选择器带
   元素部分，特异性 (0,1,1) 高于内置统计行类选择器的 (0,1,0)，且**与样式表注入顺序
   无关**（内置样式表在本插件之后注入，打平它会赢，所以必须显式高出一级）。

```
        缓存命中 34% · 12轮 30步   ·   5H ▕▓░░░░░░░░▏11% ↻16:23   周 ▕▓▓▓▓▓▓░░░░▏61% ↻周二09:36
```

窄屏放不下时整行自动换行，各行仍居中。

## 开发

```bash
npm install --cache ./.npm-cache   # 仅需 esbuild
npm run build:client               # src/client.jsx -> lib/client.js + dist/client.js
node scripts/smoke-client.mjs      # 离线冒烟：注册/渲染/点击刷新链路
```

改服务端（`lib/index.js`）只需重启 `dsh-web`（profile 里是符号链接安装）；改客户端
需先 `npm run build:client` 再重启。

## 第一版限制

- 厂商识别按 provider/model 名称启发式匹配；经中转站（如 OpenRouter）使用的同名模型会被
  误判为直连厂商，查询结果不代表中转站余额。
