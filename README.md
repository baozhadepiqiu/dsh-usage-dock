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

```bash
npm install
npm run build:client    # src/client.jsx -> lib/client.js + dist/client.js
```

改服务端（`lib/index.js`）重启 `dsh-web` 即生效；改客户端需先构建再重启。
