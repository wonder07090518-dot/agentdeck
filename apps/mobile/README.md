# AgentDeck iPhone · M3


`apps/mobile/app.json` 里的 `extra.relayUrl`（`wss://relay.agentdeckapp.com`）只给官方 App 和 App Store 审核使用。自己构建或运行 Expo web 时，请改成你自建 relay 的 WSS 地址。

Expo SDK 53 / React Native 原生界面，不使用 WebView。Node 24；Mac 需要 Xcode 26、命令行工具和 CocoaPods，无需 Expo / Apple 账号，不使用 EAS。

```sh
# 仓库根目录
npm ci
npm run build
cd apps/mobile
npm ci
npx tsc --noEmit
CI=1 npx expo prebuild --platform ios --non-interactive
```

Expo 53 会提示 `--non-interactive` 已废弃；`CI=1 npx expo prebuild --platform ios` 等价。默认会安装 pods，生成 `ios/AgentDeck.xcworkspace` 和 scheme `AgentDeck`。如果第一次未安装 pods，执行 `cd ios && pod install && cd ..`。`ios/` 被 gitignore，app.json 与依赖锁文件是 CNG 的真相来源；更改原生配置后重新 prebuild。

在 Xcode 的 Platforms 中安装 iOS Simulator runtime，然后创建指定设备（已有同名设备则跳过）：

```sh
xcrun simctl create 'AgentDeck iPhone 17 Pro' 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'
xcodebuild -workspace ios/AgentDeck.xcworkspace -scheme AgentDeck -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=AgentDeck iPhone 17 Pro' build
```

Debug 构建需要 Metro：在另一个终端 `cd apps/mobile && npx expo start`，再从 Xcode 运行，或使用 `npx expo run:ios --device 'AgentDeck iPhone 17 Pro'` 编译安装并启动 Metro。模拟器运行不需要签名账户。`npx expo start --web` 可运行 web 版。

本仓库在 Linux 验证 TypeScript、fixture 测试、iOS JS bundle 和 prebuild --no-install（生成 AgentDeck.xcodeproj / 共享 scheme）；无法在 Linux 执行 CocoaPods / xcodebuild，Mac 原生编译与视觉验收仍需执行上述命令。

电脑先运行自建 TLS relay，再运行 daemon：

```sh
# 仓库根目录；真实路径替换占位符
npm run agentdeck -- relay --home ./relay-state --host 0.0.0.0 --public-url wss://relay.example.com --tls-cert /path/fullchain.pem --tls-key /path/privkey.pem
npm run agentdeck -- serve --home ./daemon-state --cwd /path/workspace --relay wss://relay.example.com --relay-secret ./relay-state/relay.json
```

手机点「打开相机」，扫描 daemon 的终端二维码或 stderr 提示的 `http://127.0.0.1:<port>/` 本地配对页二维码，识别后直接配对并连接。也支持 `agentdeck://pair?relay=wss%3A%2F%2Frelay.example.com&code=123456`、Expo `--/pair` 深链和含相同 query 的 HTTPS 地址，手动地址与六位码在「手动输入」中默认折叠。iOS 使用 expo-secure-store，web 使用 localStorage；令牌绑定一台电脑。iOS 必须信任 TLS 证书：开发自签证书需导入模拟器并开启完全信任，或使用可信证书。不要为手机关闭 TLS 校验。Windows relay 跳过 chmod；没有 openssl 时必须传入 `--tls-cert` / `--tls-key`。

任务页按机器探测结果启用代理，版本检测不代表已登录。Claude 支持排队追加和「中断进程树 + resume」插话；Codex 支持新任务，暂不支持续跑；Grok 仅检测，不假装执行。停止为整台电脑急停。审批 30 秒超时拒绝，本次后记住仅在同任务内匹配相同工具及参数，进程结束即失效。拒绝审批会失败结束任务。JSONL 是工具活动记录，尚不能保证执行前拦截。

接受 / 拒绝结果落库为 result.resolve；拒绝仅记录决定，不回滚工作区。没有自动提交、完整 diff、推送通知或 PTY 接管；尚未达到完整 Phase 0 安全闭环。

## M4 多设备舰队与自动分配

产品需求（2026-11-12）：突出设备舰队、各 AI 安装 / 登录 / 真实余量，支持自动分配或指定设备和 AI，并明确展示分配原因。控制台保留 relay 发来的离线设备；未连过中转的机器不会出现。设备令牌从一台机器配对，授权范围为该 relay 的舰队。

确定性规则：代码任务优先 Codex → Claude → Ollama；界面 / 质量审查优先 Claude → Codex → Ollama；轻量文本优先有本地模型的 Ollama → Claude → Codex；通用任务优先 Codex → Claude → Ollama。关键词同时命中时按代码、审查、轻量顺序判断；同类按已验证登录、最近在线时间、机器 ID 排序。跳过离线、未安装、不可派发、无模型的 Ollama，以及已知余量 ≤ 0 的候选。余量未知仍可参与，但原因必须说明「余量未知」，不估算数字；Ollama 显示「本地运行，无云端额度」。只有 authenticated===true 才显示已登录。

移动端分为扫码配对、控制台和事件流，指定设备与 AI 在发令卡内展开；保留安全存储 / 自动重连 / 审批 / 结果审阅 / 停止 / 插话，自动模式只发任务与可选目录，事件流顶部按 routing.decision 生成简短原因，原因为固定区，不随时间线滚动。测试使用假 daemon 和纯调度输入，不调用真实模型。Phase 0 缺口仍包括执行前审批保障、推送、AttachDriver、完整 worktree / diff / 回滚合并；Linux 尚未验证 Xcode 原生编译或真机视觉效果。

界面使用 Expo Go SDK 53 内置的 expo-camera、expo-linear-gradient 和 expo-blur，扫码后自动配对，已保存令牌会自动重连
系统开启「减弱动态效果」时循环动画停止，Android 玻璃降级为纯色

电脑的本地配对页只监听 127.0.0.1，配对码和加入 ticket 自动刷新，不会自动打开浏览器
第一台手机配好后，把电脑 stderr 或配对页里的 `agentdeck join 'agentdeck://join?relay=...&ticket=...'` 整条命令复制到新电脑运行即可，支持 `--home`、`--cwd`、`--relay`、`--fixture` 等 serve 选项
加入 ticket 5 分钟有效且只能使用一次，密钥通过 WSS 获取并存到该电脑 `--home/relay.json`，随后直接进入 serve，手机无需再次配对

本轮用 Expo Go SDK 53 验收，无需 prebuild 或 pod，Simulator 没有相机时显示取景框占位，可用折叠手动输入或深链配对
截图覆盖扫码配对占位、控制台首屏、指定面板展开、完成后待审阅的关键事件流，最后一张应同时看到原因、思路、文件变更、回复和审阅坞

邮箱登录为默认入口，电脑和手机用同一账号，成功后令牌仍通过现有 SecureStore 保存
已存令牌启动时先恢复连接，不显示登录页
「用验证码」「中转地址」「扫码 / 手动六位码」均为折叠入口
无 SMTP 时先在电脑用密码登录，手机验证码显示在该电脑 daemon 的 stderr
「退出登录 / 重新连接」清除本机令牌后回到登录页
