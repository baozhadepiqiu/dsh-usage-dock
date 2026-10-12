# dsh-usage-dock

![dsh-usage-dock 效果图](docs/screenshot.png)

DSH Web 插件：在输入框下方的状态条里，与内置"缓存命中"统计同行显示智谱 GLM Coding Plan 套餐额度（5 小时 / 每周窗口）与 DeepSeek 账户余额，按当前选中模型自动切换。

## 安装

```bash
dsh plugin --profile web add https://github.com/baozhadepiqiu/dsh-usage-dock.git
systemctl --user restart dsh-web
```

密钥走 DSH 凭据体系（设置 → API 密钥，或环境变量），本插件不落盘任何密钥。

## 开发

TypeScript（strict）。源码在 `src/`（server.ts / client.tsx / types.ts），`lib/` 与 `dist/` 为构建产物。

```bash
npm install --cache .npm-cache
npm run typecheck    # tsc --noEmit
npm run build        # src -> lib/index.js + lib/client.js + dist/*
npm run smoke        # 离线冒烟测试
```

改服务端或客户端后 `npm run build`，再 `systemctl --user restart dsh-web` 生效。详见 `agent.md`。
