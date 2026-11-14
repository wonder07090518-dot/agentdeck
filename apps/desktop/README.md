# AgentDeck Windows 开发骨架

Tauri 2 登录窗口和托盘，邮箱密码调用同一 Node CLI 协议，成功后隐藏窗口
托盘状态和配对菜单目前是占位，不显示虚构余量
这是开发包装，正式离线安装器还需把 Node daemon 制作为 sidecar 并随包分发
当前 debug 安装器仍要求本机 Node 和仓库构建产物

Windows 安装 Node LTS、Rust 1.90 或更新的 stable MSVC、Visual Studio C++ Build Tools 和 WebView2
先在仓库根运行 `npm install` 和 `npm run build`
然后 PowerShell：

```powershell
$env:AGENTDECK_RELAY = "wss://relay.example.com" # 换成自己的中转地址
$env:AGENTDECK_CLI = (Resolve-Path ../../packages/daemon/dist/cli.js).Path
npm install
npm run tauri dev
# 未签名 debug 安装包
npm run tauri build -- --debug
```

以上命令从 `apps/desktop` 运行
产物在 `src-tauri/target/debug/bundle/msi` 和 `nsis`
退出托盘会终止此程序启动的 daemon，不会操作其他 daemon 或 cloudflared
账号保存在用户 `.agentdeck/account.json`，可用 CLI `serve --relay ...` 重连
Windows 签名和 Apple 公证需使用维护者自己的证书，本仓库不接入付费签名服务
Linux 不做 Windows 交叉编译

本机 Linux 的 Rust 1.85.1 低于锁定依赖要求，cargo check 未通过，尚未实测 Windows 安装包

桌面登录的中转优先级：调用方可选 `relay` 参数 → `AGENTDECK_RELAY` →
`AGENTDECK_HOME/relay.json`（未设置 home 时为 Tauri app data 目录）。
文件格式为 `{"relayUrl":"wss://relay.example.com"}`，域名仅为占位。
未配置时明确报错，没有默认公共中转。CLI 可显式传 `--relay`。
凭据仍只通过子进程环境传递，不进入 argv。
