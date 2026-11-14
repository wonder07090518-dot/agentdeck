# AgentDeck

## 中文

MIT 开源许可的手机 + CLI 遥控工具：通过可自建的 relay，在自己的电脑上使用 Claude Code、Codex，以及已安装并有本地模型的 Ollama。TypeScript monorepo 包含共享协议、CLI adapters、Node 24 SQLite daemon、TLS WSS relay 和 Expo iPhone / web 客户端。

源码仓库：https://github.com/wonder07090518-dot/agentdeck

`wss://relay.agentdeckapp.com` 只给官方 App 和 App Store 审核使用，不是给所有克隆这个仓库的人用的公共中转。请按下面的说明自己运行 relay。桌面程序不会默认连接这个地址。

本仓库的代码主要在作者指导下用编程助手完成。

App Store 版本正在准备，尚未提交，也未上线。桌面端目前是 Tauri 开发包装，需要本机 Node 和构建产物，没有一键安装器。

### 本地快速开始

需要 Node 24、npm。安装依赖需要网络；构建及测试使用本地 fixtures，不调用真实模型。

```sh
npm ci
npm run build
npm test
npm run agentdeck -- run "改个 typo" --cwd /absolute/workspace --fixture packages/daemon/test/fixtures/claude-typo-stream.jsonl
npm run agentdeck -- run "修改文件" --agent codex --fixture packages/daemon/test/fixtures/codex-stream.jsonl
```

不带 fixture 的任务会调用本机真实 CLI，可能消耗对应服务额度。默认 Claude，可选 `--agent claude|codex|grok`；Grok 仅检测版本，不能运行任务。Ollama 通过舰队路由使用已有本地模型，以上单任务 CLI 的 `--agent` 不支持 Ollama。

自建 relay，然后在另一终端运行 daemon（替换路径和示例域名，使用自己的可信 TLS 证书）：

```sh
npm run agentdeck -- relay --home ./relay-state --host 0.0.0.0 --public-url wss://relay.example.com --tls-cert /path/fullchain.pem --tls-key /path/privkey.pem
npm run agentdeck -- serve --home ./daemon-state --cwd /path/workspace --relay wss://relay.example.com --relay-secret ./relay-state/relay.json
```

`relay.example.com` 只是占位，必须换成自己部署的地址；官方中转只服务官方 App 和审核，其他人请自建 relay。不要公开 `relay.json` 中的 secret。daemon 输出有效期五分钟的配对码和二维码，手机连接同一 WSS 地址配对。生产需可信 TLS；开发自签证书需手机信任。不传 `--relay` 的 serve 是未鉴权 loopback WS 调试入口，不应暴露公网。`--home` 优先于 `AGENTDECK_HOME`，默认 `~/.agentdeck`；`--cwd` 默认当前目录，不自动初始化 Git。

免费试用手机浏览器界面，无需 App Store 或 EAS：

```sh
cd apps/mobile
npm ci
npx expo start --web
```

在手机浏览器打开 Expo 输出的可访问 web 地址，使用自己的 relay 登录或配对。手机须能访问开发机的 web 服务和 relay；界面试用不收费，执行云端模型任务仍按各自服务计费。原生 iPhone 开发和模拟器命令见 [移动端说明](apps/mobile/README.md)；桌面开发见 [桌面说明](apps/desktop/README.md)。

### 当前边界

- 审批是执行记录，不是安全沙箱，也不能保证阻止已发生的动作。拒绝审批会终止任务；拒绝结果不回滚文件。尚无完整 worktree、真实 diff、回滚与自动合并闭环。
- 余量无法确认时显示「余量未知」，不会编造数字；Ollama 显示「本地运行，无云端额度」。只有已验证登录才显示已登录。
- Auto 路由是确定性的并展示原因：代码优先 Codex → Claude → Ollama；审查优先 Claude → Codex → Ollama；轻量文本优先 Ollama → Claude → Codex；通用优先 Codex → Claude → Ollama。跳过离线、未安装、不可派发、无本地模型及已知余量耗尽的候选；未知余量可参与但会明确说明。
- 支持会话重连与事件补齐、停止、Claude 续跑 / 插话；Codex 不提供续跑或插话。无推送通知和 AttachDriver。Windows 代理进程树清理尚未保证，原生打包需对应平台验收。

协议及实现边界见 [Phase 0 规格](docs/PHASE0-SPEC.md)，账号流程见 [账号与桌面](docs/ACCOUNT-AND-DESKTOP.md)。

## English

AgentDeck is an MIT-licensed phone and CLI remote for Claude Code, Codex, and already-installed Ollama models on your own computers, through a self-hostable relay. The TypeScript monorepo includes shared protocols, CLI adapters, a Node 24 SQLite daemon, a TLS WSS relay, and Expo iPhone / web clients.

Source: https://github.com/wonder07090518-dot/agentdeck

`wss://relay.agentdeckapp.com` is only for the official app and App Store review. It is not a public relay for everyone who clones this repository. Run your own relay with the commands below. The desktop app does not default to that address.

Most of this repository was written with coding assistants under the author's direction.

The App Store release is being prepared; it has not been submitted and is not live. The Tauri desktop wrapper requires local Node and built daemon files; there is no one-click installer.

### Quickstart

Use Node 24 and npm. Run the build, fixture task, relay, and serve commands in the Chinese quickstart above; replace all paths and `wss://relay.example.com` with your own deployment. `npm ci` needs network access; `npm run build` and `npm test` use local fixtures without real models. Running tasks without fixtures invokes installed CLIs and may consume paid model quota. Grok is detect-only. Ollama is available through fleet routing with an installed local model, not through the single-task CLI's `--agent` option.

Run the relay in one terminal and serve in another. Keep the relay secret private and use trusted TLS certificates. Pair with the daemon's five-minute code or QR using the same relay URL. The official relay is only for the official app and review; everyone else should self-host. Without `--relay`, serve exposes an unauthenticated loopback debugging endpoint; do not expose it publicly. `--home` overrides `AGENTDECK_HOME`, otherwise the default is `~/.agentdeck`.

For a free way to try the interface from a phone browser:

```sh
cd apps/mobile
npm ci
npx expo start --web
```

Open the reachable web address printed by Expo on your phone, then log in or pair with your relay. Both the web server and relay must be reachable from the phone. No App Store or EAS account is needed for this web preview; cloud model usage still follows the provider's billing.

### Current limits

- Approvals are a record, not a sandbox or a guarantee of pre-execution authorization. Rejecting approval stops the task; rejecting a result does not roll back files. Full worktree isolation, real diffs, rollback, and automatic merge remain unfinished.
- Unavailable quota is shown as “quota unknown” / “余量未知”, never an invented number. Ollama runs locally without cloud quota. Login is shown as verified only when authentication is confirmed.
- Auto routing is deterministic and shows its reason. Code prefers Codex → Claude → Ollama; review prefers Claude → Codex → Ollama; lightweight text prefers Ollama → Claude → Codex; general tasks prefer Codex → Claude → Ollama. Offline, uninstalled, unsupported, model-less, and known exhausted candidates are skipped. Unknown quota remains eligible with an explicit explanation.
- Session reconnect / replay, stopping, and Claude resume / interjection are supported. Codex resume / interjection, push notifications, and AttachDriver are unavailable. Windows process-tree cleanup and native builds still need platform verification.

See [mobile development](apps/mobile/README.md), [desktop development](apps/desktop/README.md), and [implementation boundaries](docs/PHASE0-SPEC.md).
