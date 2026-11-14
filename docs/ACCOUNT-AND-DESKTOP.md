# AgentDeck 账号与桌面软件

需求：「可以搞一个这种登录的系统，然后就是电脑上面登录一个，电脑上面下载一个我们的软件…手机上下载一个我们的软件，然后连上就立马可以用」

目标体验：同一套 AgentDeck 账号，电脑软件（Windows / Mac 托盘或菜单栏，包住现有 daemon）和手机 App 都登录进去，经自建中转自动连上，这个账号下的电脑立刻出现在手机上。扫码配对保留为备用。

本系统自建、免费：账号做在我们自己的 relay 里，不用任何付费认证服务（不用 Auth0、Clerk、Firebase、Supabase Auth）。不花钱。

## 今晚先做的第一步（协议 + 手机登录 + CLI）

1. 在自建 relay 里实现账号：邮箱 + 密码，或邮箱验证码
2. 密码用 Node `crypto.scrypt` 加盐哈希后存放（每用户独立 salt，明文永不落盘）
3. 验证码 6 位、10 分钟、一次性、同样哈希存放
4. 登录后发设备令牌（随机 32 字节，只存哈希），手机和电脑各自一把，自动重连，不用配第二次
5. 舰队按 `accountId` 隔离：登录同一账号的电脑全部出现在手机上
6. 手机登录页作为主入口（与现有视觉规格同一套令牌），扫码配对是折叠备用
7. CLI：`agentdeck login`（邮箱+密码或验证码），写入 `--home` 的账号令牌后直接 `serve`，新电脑只需安装后登录同一账号
8. 邮件发送：默认不依赖外部邮件服务。验证码优先显示在已经登录的电脑软件 / 终端里（「这台手机正在登录，验证码是 123456」）。若运营者自己配置了 `AGENTDECK_SMTP_URL`（自己的 SMTP，不花钱买第三方认证），再额外发到邮箱。没有 SMTP 时注册和登录以密码为主，验证码仍可用（在电脑上查看）
9. 扫码、join 命令、现有 relaySecret 舰队全部保留，作为无账号或不想注册时的备用路径

不做：付费 API、把密码或令牌打进日志、在验证码链接里放密钥。

## 桌面软件包装（规格，完整安装包今晚不一定做完）

推荐 **Tauri 2**（体积小，Windows 托盘 + Mac 菜单栏原生感好），把现有 Node daemon 作为 sidecar 拉起。备选 Electron，集成 Node 更熟，但安装包更大。

最小桌面窗口：
- 登录（邮箱+密码 / 验证码）
- 登录后缩到托盘：在线状态、已探测到的 AI、余量（未知就写未知，不编造）、打开本地配对页、退出
- 开机启动可选项
- 不要求用户再敲中转地址和密钥

安装包：
- Windows：`.msi` / 便携 `.exe`，签名以后再做（需维护者自己的代码签名证书）
- Mac：`.dmg` + 菜单栏 App，公证需要 Apple Developer（需维护者自己的 Apple ID）
- 今晚若来不及出安装包：仓库里放 `apps/desktop` 骨架和打包命令，CLI 登录可先用

## 数据与协议（摘要）

存在 relay 的 `home/accounts.json`（或 sqlite），权限 0600：

```
Account { id, email, passwordHash, salt, createdAt }
Magic { email, codeHash, expiresAt, usedAt? }
DeviceToken { hash, accountId, role: 'phone'|'computer', deviceId, createdAt, revokedAt? }
```

新消息（风格与现有 zod 一致，未认证可发）：

- `account.register` `{email,password}` → `account.granted` `{accountId,token,role}`
- `account.login` `{email,password}` → 同上
- `account.magic.start` `{email,purpose:'login'|'register'}` → `account.magic.sent` `{via:'smtp'|'desktop',expiresAt}`（绝不回传明文验证码给非本机的客户端；测试可从内存 hook 取）
- `account.magic.complete` `{email,code}` → `account.granted`
- 之后手机用 `auth {role:'device', token}`，电脑用 `auth {role:'daemon', token, machineId}`（账号令牌，不再需要手抄 relaySecret）
- 舰队快照只含该账号的机器

密码规则：至少 8 位，邮箱小写规范化。失败提示不暴露「邮箱是否已注册」的细节（统称「邮箱或密码不对」）。连续失败短暂限速。

现有 `pair.*` 与 `daemon.join` 继续工作。若请求方已登录账号，配对或 join 把新设备绑到该账号。

## 体验路径

1. 电脑安装 AgentDeck，用邮箱注册并登录，托盘出现「在线」
2. 手机安装 AgentDeck，用同一邮箱登录（密码，或看电脑上的验证码）
3. 手机立刻看到这台电脑和上面的 AI，输入任务点「开始」
4. 再买一台电脑：安装后登录同一账号，手机上自动多出一台，不用再扫码
5. 不想注册：仍然可以扫码，或用 `agentdeck join` 这条命令

## 验收

- 不出现付费服务依赖；密码和验证码只存哈希
- 手机和电脑登录同一账号后，舰队立刻一致
- 令牌自动重连，不用配第二次
- 扫码备用仍可用
- 界面文案没有「。」
- 测试覆盖：注册、登录、错误密码、验证码过期和重复使用、令牌重连、账号之间舰队隔离、SMTP 未配置时验证码走桌面通道

## 已实现的开发入口

先 `npm install && npm run build`，电脑使用：

```bash
# 先在环境中设置 AGENTDECK_EMAIL / AGENTDECK_PASSWORD（不要把密码写入命令参数）
agentdeck login --relay wss://relay.example.com --name '我的 Windows'
# relay.example.com 是占位域名，请换成自己的 relay
# 之后只用已存令牌
agentdeck serve --relay wss://relay.example.com
```

仓库未全局安装命令时，把 `agentdeck` 换成 `npm run agentdeck --`
`--home` 可指定独立数据目录，`--cwd`、`--fixture` 保留
CLI 先 login，统一凭据错误时再以同一密码 register，已注册邮箱不会被覆盖
客户端收到 `account.granted` 后保存令牌，再发送标准 `auth`
手机主入口可分别「登录」「创建账号」，扫码和验证码保留为折叠备用
每台电脑用同一个账号登录后，会自动进入该账号的手机舰队

账号数据第一次使用时创建 `accounts.json`，密码和验证码都用随机盐及 scrypt
设备令牌是随机 32 字节，relay 只保存 SHA-256 摘要
未配置 SMTP 时，验证码仅发到该账号已认证的 computer 连接，由 daemon 输出
可选的 `AGENTDECK_SMTP_URL` 使用自有 SMTP，`AGENTDECK_SMTP_FROM` 设置发件人
无已登录电脑且未配置 SMTP 时应先用密码注册或登录
`peekMagic(email)` 仅供进程内测试使用，没有对应远程协议

部署时保留已有 `devices.json`、`fleet.json`、`relay.json` 和 daemon 数据目录
无 accountId 的旧文件仍属于传统舰队，旧扫码令牌仅看传统电脑
账号手机仅看同账号电脑，包括在该账号电脑上发起的 pair/join 新设备
账号电脑在 relay 使用账号与本机 ID 组合的名字空间，防止与传统机器 ID 冲突
切到账号后旧传统任务保留在本机数据库，不自动迁入账号任务列表
账号 join 下发 computer token，传统 join 仍走 relaySecret，参与账号 join 的 CLI 需使用新版本

Windows Tauri 骨架与未签名 debug 包说明见 [desktop README](../apps/desktop/README.md)
当前使用已构建 Node CLI 作为开发 sidecar，正式自包含 sidecar 分发仍待后续完成

验证码失败按邮箱累计，1 小时内满 5 次即锁定，重新获取不会清零计数；同一条未使用的码 60 秒内不会被替换。密码连续失败同样按邮箱锁定，超过阈值直接拒绝（仍只回「邮箱或密码不对」），1 小时后恢复。`visible()` 对尚未进入舰队的机器，按已连接 daemon 的账号判定，不会把传统设备放到账号电脑上。
