# agent.md — dsh-usage-dock

面向对象：AI Agent（编码代理）、自动化工具与开发者。读完本文件即可安全地在本仓库执行任务，无需探索即可获得关键约束。

## 项目简介

DSH（DeepSeek Harness）Web 插件：在 Web 输入框下方的 composer dock 状态条里，与内置缓存统计同行显示智谱 GLM Coding Plan 套餐额度（5 小时 / 每周窗口）与 DeepSeek 账户余额，按当前选中模型自动切换厂商。

- 运行入口：`lib/index.js`（服务端，package.json `main`）；`lib/client.js`（浏览器端，DSH ModuleLoader 包裹）
- 源码语言：TypeScript（strict），构建产物随仓库提交以便 git 直装

## 目录结构

```
src/
  server.ts     服务端源码 → 编译为 lib/index.js（HTTP 路由 / 凭据解析 / 厂商 API / 60s 缓存）
  client.tsx    浏览器端源码 → 打包为 lib/client.js + dist/*.js（React 组件 + 注入 CSS）
  types.ts      前后端共享领域类型（DockStatus / QuotaWindow / Translate）
scripts/
  build.ts                 构建：server 转译 + client esbuild 打包（--client-only 跳过服务端）
  smoke-client.ts          离线冒烟测试（stub React + fake fetch，断言渲染与 bundle 字符串）
lib/ dist/      构建产物（提交进仓库，勿手改）
docs/           截图等静态资源
zhipu-coding-plan-balance-query.md   智谱额度接口的字段语义参考文档（vendored）
cordis.patch.yml   DSH profile bundle patch（apiKeyEnv 路由配置）
```

## 常用命令

```bash
npm install --cache .npm-cache   # 本机 ~/.npm 有权限问题时用本地缓存
npm run typecheck                # tsc --noEmit（strict）
npm run build                    # 全量构建（lib/index.js + lib/client.js + dist/*）
npm run build:client             # 仅客户端
npm run smoke                    # 离线冒烟测试（无需网络与密钥）
systemctl --user restart dsh-web # 让插件改动生效（符号链接安装时改工作区文件即可）
curl 'http://127.0.0.1:3080/dsh-usage-dock/status?provider=zai-coding-cn&model=glm-5.3'  # 端到端验证
```

## 开发规范

- TypeScript strict：禁止新增 `any`；外部 JSON 走 `src/server.ts` 顶部的 `rec/str/num` 防御性解析
- `lib/` 与 `dist/` 是构建产物：改代码改 `src/`，跑 `npm run build`，不要手改产物
- `main` 必须保持 `lib/index.js`（DSH 运行时加载路径，不可变更）
- 服务端对 host 服务的依赖用 `src/server.ts` 里的结构化接口（RootContext/ScopedContext 等），保持跨版本兼容；settings 读取必须同时支持 `describe()`（新）与 `get()`（旧）
- 提交前必须通过：`npm run typecheck && npm run build && npm run smoke`

## 测试方式

1. `npm run smoke`：离线冒烟（stub React、fake fetch、locale 键数校验、CSS 字符串断言）
2. 端到端：重启 dsh-web 后 curl status 接口，期望 `{"ok":true,...}`（本机已配 ZAI_CODING_CN_API_KEY）
3. 浏览器：刷新 Web GUI，确认状态条与缓存统计同行渲染

## Agent 执行任务注意事项

- 密钥只经 DSH 凭据体系（`ctx.credentials`）解析，任何代码/日志/文档不得落盘或输出密钥明文
- 厂商接口语义（unit=3→5h、unit=6→周、percentage=已用百分比）以 `zhipu-coding-plan-balance-query.md` 为准，改动解析逻辑前先读它
- `refresh=1` 绕过 60s 缓存；缓存键为 `vendor:endpointUrl`
- 请求信任边界：仅同源/回环可访问（`selfRejection`，fail-closed），改动前保持该性质
- 构建产物必须随提交更新（git 直装场景无构建步骤）：改 `src/` 后跑 `npm run build` 并把 `lib/`、`dist/` 一起提交
- 完成定义：typecheck + build + smoke 全绿，端到端 curl 返回 ok:true
