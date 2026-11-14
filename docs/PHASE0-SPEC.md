# Agent 遥控 + 调度 · Phase 0 规格

> 给 Codex 的实现规格。Phase 0 只做单机单 agent 的闭环，但**数据模型必须是能长大的**——
> 后面加多机、加拆解、加并行、加自动路由时，不应该动协议。
>
> 本文档里所有 CLI flag 是**期望形态**，不是事实。实现前必须用本机 `<agent> --help` 实测确认。

---

## 0. 目标

一台机器、一个 agent、一部手机，从「下指令」到「看到 diff 并批准」全链路跑通。
硬性体验指标：**手机锁屏 20 分钟，回来点开，session 还活着、上下文没丢、能直接接着聊。**

## 1. 为什么先立模型而不是先做界面

遥控和调度是两种相反的交互形态：

- **遥控** = 人机同权，实时双向，你随时插一句话
- **调度** = 给一个目标就走开，异步推进，最后交结果

如果在 App 里各写一套逻辑，Phase 2 加拆解和并行时一定分裂重做。
所以 Phase 0 的第一件事不是写界面，是**把 Session 抽象和事件协议定死**，两种形态都只是它的 driver。

---

## 2. 核心对象

```ts
type MachineId = string;   // 安装时生成，稳定不变
type AgentId   = 'claude' | 'codex' | 'grok' | string;
type SessionId = string;   // uuidv7（自带时间序，利于排序）
type TaskId    = string;

interface Machine {
  id: MachineId;
  name: string;               // 用户可改："家里的 Mac"
  os: 'darwin' | 'win32' | 'linux';
  online: boolean;
  lastSeen: number;
  agents: AgentInfo[];        // 本机已安装的 agent
  labels: string[];           // "gpu" / "intranet" / "always-on"，Phase 2 路由用
}

interface AgentInfo {
  id: AgentId;
  version: string;
  authenticated: boolean;
  accountHint?: string;       // 脱敏后展示，如 "x***@gmail.com"
  supports: {
    jsonOut: boolean;         // 有机器可读输出
    resume: boolean;          // 支持续跑同一对话
    interactive: boolean;     // 支持 PTY 交互
    permissions: boolean;     // 有自己的审批机制
  };
  rateLimitHint?: string;     // Phase 1 用，先留字段
}

interface Workspace {
  machineId: MachineId;
  path: string;               // 绝对路径
  gitRoot?: string;
  defaultBranch?: string;
}

type SessionMode   = 'delegate' | 'attach';
type SessionStatus =
  | 'pending' | 'starting' | 'running'
  | 'needs_approval' | 'paused'
  | 'done' | 'failed' | 'cancelled';

interface Session {
  id: SessionId;
  taskId: TaskId | null;   // Phase 0 恒为 1:1；Phase 2 变 1:N，字段不用改
  machineId: MachineId;
  agentId: AgentId;
  workspace: Workspace;
  mode: SessionMode;
  status: SessionStatus;
  worktree?: { path: string; branch: string };
  title: string;           // 由首个用户输入生成，手机列表用
  startedAt: number;
  endedAt?: number;
  cost?: { inputTokens: number; outputTokens: number; usd?: number };
  seq: number;             // 该 session 最后一条事件的 seq
}
```

**Task 为什么现在就要有**：Phase 0 用不上，但它是 Phase 2 接调度器的挂载点。先留着，代价是一个字段。

### 状态机

```
pending ──start──▶ starting ──▶ running
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  needs_approval              paused                    (终态)
        │ resolve              │ resume                 done / failed / cancelled
        └──▶ running             └──▶ running
```

规则：
- 终态不可逆，不允许从 `done` 回到 `running`
- `needs_approval` 有超时，超时按 policy 默认值处理（默认拒绝），不是无限挂起
- `paused` 必须能被 `resume`；不能 resume 的实现视为不合格

---

## 3. 事件协议（唯一真相）

三条原则，违反任何一条后面都会返工：

1. **append-only**。每个 session 内 `seq` 严格 +1，不可改不可删。更正只能用新事件表达。
2. **没有只服务 UI 的事件类型**。UI 和调度器消费同一套事件。
3. **agent 的原始输出必须先解析成结构化事件**。解析不了的才落到 `output.chunk` 兜底。

### Envelope

```ts
interface EventEnvelope {
  v: 1;
  sessionId: SessionId;
  seq: number;
  ts: number;              // 服务端写入时间（不是 agent 输出时间）
  type: EventType;
  origin: 'user' | 'agent' | 'runtime' | 'policy';
  ref?: { toolCallId?: string; approvalId?: string; parentSeq?: number };
  payload: unknown;
}
```

### 事件类型清单

| type | origin | payload 要点 |
|---|---|---|
| `session.created` | runtime | 完整 Session 快照 |
| `session.status` | runtime | `{ from, to, reason? }` |
| `user.input` | user | `{ text, attachments?, clientMsgId }` |
| `agent.message` | agent | `{ delta?, text?, final?: boolean }` |
| `agent.reasoning` | agent | `{ summary }` 可只给摘要，不必给全文 |
| `tool.call` | agent | `{ toolCallId, name, input }` |
| `tool.result` | agent | `{ toolCallId, ok, output?, error? }` |
| `command.exec` | runtime | `{ cmd, cwd, exitCode, durationMs }` |
| `output.chunk` | runtime | `{ stream: 'stdout'\|'stderr'\|'pty', data: string(base64), truncated? }` |
| `file.change` | runtime | `{ path, kind: 'add'\|'modify'\|'delete', patch? }` |
| `diff.snapshot` | runtime | `{ filesChanged, insertions, deletions, baseRef }` |
| `test.result` | runtime | `{ cmd, ok, failed: number, total?: number }` |
| `approval.request` | runtime | Approval 对象 |
| `approval.resolve` | user | `{ approvalId, decision, remember?: boolean }` |
| `cost.update` | runtime | `{ inputTokens, outputTokens, usd? }` |
| `error` | runtime | `{ code, message, retriable }` |
| `session.ended` | runtime | `{ status, reason?, cost, summary }` |

### 示例

```json
{
  "v": 1, "sessionId": "01JC...", "seq": 42, "ts": 1762904400123,
  "type": "tool.call", "origin": "agent",
  "ref": { "toolCallId": "call_a1" },
  "payload": { "name": "Edit", "input": { "file_path": "src/auth.ts", "old_string": "..." } }
}
```

```json
{
  "v": 1, "sessionId": "01JC...", "seq": 57, "ts": 1762904521000,
  "type": "approval.request", "origin": "runtime",
  "ref": { "approvalId": "apr_9f" },
  "payload": {
    "approvalId": "apr_9f",
    "kind": "shell",
    "summary": "pnpm add -D vitest",
    "detail": "在 worktree 内安装依赖，会修改 node_modules 与 lockfile",
    "risk": "medium",
    "options": ["allow", "allow_always", "deny"],
    "expiresAt": 1762904551000
  }
}
```

---

## 4. 重连与重放（这一节决定架构对不对）

**客户端必须无状态。** 任何"手机本地存着当前进度"的设计都是错的——锁屏、切后台、杀进程、换设备，全都要能恢复。

- 客户端订阅：`session.subscribe { sessionId, since?: number }`
- `since` 缺省或超出保留窗口 → 服务端先发 `snapshot`，再流式推送

```ts
interface SessionSnapshot {
  session: Session;
  recent: EventEnvelope[];      // 最近 50 条
  pendingApprovals: Approval[]; // 重要：断线期间错过审批，一接上就能看到
  diff: DiffSummary;            // 相对 base 的累计改动
  tail: string;                 // 最后 N 行可读文本，"一眼看现在在干嘛"
}
```

- 之后每个事件带 `seq`，客户端 `lastSeq = max(seq)`，下次重连 `since = lastSeq`
- 服务端要支持 `since` 落后很多的场景（Phase 0 全量保留，不做压缩）

**推论**：session 的生命周期跟 daemon 绑定，跟 WebSocket 连接无关。手机断开 → session 继续跑。

---

## 5. 双 Driver

```ts
interface SessionDriver {
  readonly kind: SessionMode;
  start(): Promise<void>;
  send(input: UserInput): Promise<void>;   // attach: 写 stdin / delegate: 见下
  interject(input: UserInput): Promise<void>;
  interrupt(): Promise<void>;
  dispose(): Promise<void>;                // 必须 kill 整个进程树
}
```

### DelegateDriver

- 以 agent 的非交互模式启动子进程（print / exec + 机器可读输出）
- 单向目标 → 跑到结束，全程发结构化事件
- `send()` 语义：**当前 turn 结束后排队**，不打断
- `interject()` 语义：中断当前 run，用 agent 的 resume 能力带新指令重启
- 结束条件：进程退出 + 状态收敛

### AttachDriver

- PTY 启动交互式 agent，长驻
- `send()` 直接写 stdin
- 输出走 `output.chunk`（pty），能被解析的再补发结构化事件
- 生命周期由用户显式结束

### 模式切换的真实语义（重要，别写成假的）

**不要假装可以往一个 print-mode 进程里注入输入。** 正确的 `delegate → attach` 接管是：

1. 发 `user.input`（"等等，别动那个文件"）
2. 给当前 run 发 interrupt
3. 用同一个 agent 的 resume id + 新指令重启
4. 状态回 `running`

效果上等于"你在中途改了方向"，实现上是「中断 + 带上下文重启」。这个语义要写进文档和 UI，否则用户会以为能实时插话而实际有延迟。

`attach → delegate`：用户说"就这样，剩下的你自己收尾"，driver 切到跑完即止的模式。

---

## 6. Agent Adapter

每个 agent 一个 adapter，**adapter 里不许有业务逻辑**（不许做路由、不许做审批判断）。

```ts
interface AgentAdapter {
  id: AgentId;
  detect(env: DetectEnv): Promise<AgentInfo | null>;   // 探测安装/版本/登录态
  buildDelegateRun(req: RunRequest): SpawnSpec;
  buildAttachRun(req: RunRequest): SpawnSpec;
  parse(chunk: string): EventDraft[];                  // 流式增量 → 事件草稿
  resumeArgs(sessionRef: string): string[];            // 续跑参数
  mapExit(code: number, stderr: string): { ok: boolean; reason?: string };
}

interface SpawnSpec {
  cmd: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: 'closed' | 'pty';
  parseMode: 'jsonl' | 'json' | 'text';
}
```

要求：
- adapter 无状态（`detect` 结果可缓存），这样 Phase 1 才能并发起多个实例
- 所有 flag 以本机 `<agent> --help` 实测为准，实测后把差异回写进本文档
- 优先用 `jsonl`/`json` 解析模式；`text` 只作兜底

Phase 0 只实现 `claude`。`codex`、`grok` 留空壳（detect + 抛 not_implemented），先把接口跑通。

---

## 7. 审批策略

审批在 **runtime 侧**判定，客户端只是展示和回传决定。客户端传上来的"我允许了"必须校验 `approvalId` 有效性。

```ts
interface PolicyRule {
  match: { tool?: string; cmdRegex?: string; pathWithin?: 'worktree' | 'workspace' | 'any' };
  action: 'allow' | 'ask' | 'deny';
  timeoutSec?: number;
  timeoutAction?: 'deny' | 'pause';
}
```

Phase 0 默认策略：

| 动作 | 判定 |
|---|---|
| 读文件 / grep / 列目录 | allow |
| worktree 内写文件 / 改文件 | allow |
| 任意 shell 命令 | ask |
| 网络访问 / 装依赖 / 发外部请求 | ask |
| 动 worktree 外的路径 | deny |
| `rm -rf /`、`git push --force`、`curl \| sh`、`sudo` | deny（硬黑名单） |

审批对象：

```ts
interface Approval {
  approvalId: string;
  sessionId: SessionId;
  kind: 'shell' | 'write' | 'network' | 'spawn';
  summary: string;       // 一行，用户扫一眼就能决定
  detail?: string;       // 为什么有风险
  risk: 'low' | 'medium' | 'high';
  options: ('allow' | 'allow_always' | 'deny')[];
  expiresAt: number;
}
```

UI 只给三个按钮，不要给输入框。**手机上做决定，不做输入。**

---

## 8. 安全（Phase 0 就要有，不能后补）

- **配对**：daemon 首次启动打印 6 位码 + 二维码；手机扫码换取设备 token，token 绑定单台机器，可随时吊销
- **传输**：Phase 0 只走局域网或 Tailscale，**不做公网 relay**。这条能省掉后面一堆隐私和运维问题
- **审计**：所有 `approval.request` / `approval.resolve` / `tool.call` 落库，可导出
- **急停**：一个 `runtime.halt` 命令，终止本机所有 session 及其进程树

一个能在你所有机器上执行 shell 的手机 App 就是一个后门。这层不是打磨，是入场条件。

---

## 9. 存储

SQLite，单文件，放 `~/.agentdeck/agentdeck.db`。

```
machines(id, name, os, last_seen, labels_json)
agents(machine_id, agent_id, version, authenticated, supports_json)
sessions(id, task_id, machine_id, agent_id, workspace_json, mode, status,
         worktree_json, title, started_at, ended_at, cost_json, seq)
events(session_id, seq, ts, type, origin, ref_json, payload_json)   -- PK(session_id, seq)
approvals(id, session_id, kind, summary, risk, state, expires_at, resolved_at)
artifacts(session_id, kind, path, meta_json)
```

索引：`events(session_id, seq)`、`sessions(status)`。

Phase 0 事件全量保留，不做压缩。Phase 1 再加 compaction。

---

## 10. 目录结构

```
agentdeck/
  packages/protocol/      # zod schema：EventEnvelope、DTO、WS 消息联合类型
  packages/daemon/        # node 服务、sqlite、runtime、drivers、policy
  packages/adapters/      # claude.ts / codex.ts / grok.ts
  apps/mobile/            # expo
```

`protocol` 必须被 daemon 和 mobile 双向引用，**schema 只有一份**。手写两份类型是这类项目最常见的腐烂起点。

---

## 11. 实施顺序（顺序不能换）

### M0 骨架（半天）
monorepo + protocol 包 + daemon 起 WS 服务 + `machine.register` 落库
✅ 验收：`wscat` 能连上并收到机器信息

### M1 只跑 CLI 的全链路（2–3 天）
DelegateDriver + claude adapter + 事件落库
✅ 验收：终端里 `agentdeck run "改个 typo"`，能完整打出结构化事件流，sqlite 里有对应记录
**这一步不碰手机。** 先在 CLI 证明 daemon 是对的，否则你会分不清 bug 在服务端还是在 UI。

### M2 手机端最小闭环（3–5 天）
列表 / 新建 / 事件流 / 断线重连 + snapshot + replay
✅ 验收：手机上发任务 → 看到流式输出 → 锁屏 20 分钟 → 回来还能接着发消息

### M3 审批 + 推送（2 天）
approval.request 上行 + 手机三按钮 + 超时兜底 + 推送通知
✅ 验收：agent 要装依赖 → 手机弹通知 → 批准 → 继续跑

### M4 PTY 接管（2–3 天）
AttachDriver + interject 语义 + 受限终端视图（只读输出 + 底部短语输入，不给完整 shell）
✅ 验收：delegate 跑着的时候能插一句改方向，且不丢上下文

### M5 worktree + diff 审阅（2–3 天）
`git worktree add .worktrees/<sessionId> -b agent/<sessionId>` + 累计 diff + 手机审阅
✅ 验收：手机上能看到"3 文件 +47/−12"，逐块接受，然后 commit

---

## 12. 给 Codex 的红线

1. **不许拿 PTY 抓屏当主路径**。优先 `jsonl`/`json` 解析，PTY 只做交互式兜底。
2. **不许把状态放客户端**。手机是无状态视图，真相在 daemon。
3. **不许先做聊天 UI**。先 CLI 后 UI，顺序反了必返工。
4. **不许在 adapter 里塞业务逻辑**。adapter 只管 spawn 和 parse。
5. **不许出现只服务 UI 的事件类型**（比如 `ui.toast`）。
6. **不许 SSE + 轮询混搭**。一条 WS，一个事件流。
7. **不许留孤儿进程**。`dispose()` 必须 kill 整棵进程树。
8. **不许伪造模式切换**。§5 说明的「中断 + resume」语义要如实实现并写进 UI 文案。

---

## 13. Phase 0 完成定义

五条场景，全部通过才算完成：

1. 手机上丢一个任务，锁屏 20 分钟回来，session 还在跑或已完成，上下文完整
2. 断网重连后，事件流不重复不丢（`seq` 连续），待审批项不丢
3. agent 要执行危险命令，手机上被拦住，拒绝后 agent 收到拒绝原因并继续
4. delegate 跑到一半能插话改方向，上下文不断
5. 全程不出现孤儿进程，急停能一次清干净

---

## 14. 现在需要定的三件事

| 决策 | 建议 | 理由 |
|---|---|---|
| 先做哪个 agent | **claude** | 机器可读输出最成熟，解析成本最低 |
| 手机端框架 | **Expo (React Native)** | 一套出 iOS + Android；后面要 Widget/灵动岛再加原生模块 |
| 传输 | **Tailscale / 局域网，不做公网 relay** | 省掉鉴权、证书、隐私三件麻烦事；Phase 1 再考虑 relay |

---

## 附：与 Phase 1 的接缝

Phase 1 加多机和自动路由，**不改协议**，只加三样东西：

1. `Task → Session[]` 的关系（字段已存在，改成 1:N）
2. 一个 Scheduler（读 `Machine.labels` + `AgentInfo.authenticated` + 历史成功率，产出 `session.create` 决策）
3. `routing.decision` 事件（记录"为什么选了这台机器这个 agent"，让路由可解释）

也就是说：**Phase 0 把模型立对了，Phase 1 全是加法；立错了，全是重做。**

## 附录 A：本机 CLI flag 实测

实测日期：2026-11-11，America/Toronto；机器：测试环境。以下来自本机已提供的实测记录；M0/M1 实现期间没有调用真实模型。本附录将前文「期望形态」与实测区分。

### Claude Code 2.1.312

- 无人值守：`claude -p` / `--print`。
- `--output-format text|json|stream-json` 仅配合 print；delegate 使用 stream-json，完整 JSONL 行解析，暂不启用 `--include-partial-messages`。
- **本机实测（2026-11-11 21:48，America/Toronto）：** `claude -p --output-format stream-json` 会立即报错 `When using --print, --output-format=stream-json requires --verbose`。因此 delegate 必须同时传 `--verbose`。此次失败发生在启动参数校验，文件未被修改；是否已产生计费未确认，但模型任务未开始。
- `-r, --resume [value]` 接受 session ID 或 name；交互无参打开 picker。本产品始终传明确 `--resume <claudeSessionId>`。
- `-c, --continue` 续跑当前目录最近对话；`--session-id <uuid>` 为新对话指定 UUID；`--fork-session` 与 resume/continue 联用创建新 ID。
- `--no-session-persistence` 只在 print 下禁用落盘，无法 resume；delegate 默认不开。
- `--permission-mode` 支持 acceptEdits、auto、bypassPermissions、manual、dontAsk、plan。
- print 下 `--permission-prompts host|none` 默认 host，无人回答会卡住。Phase 0 使用 `--permission-mode acceptEdits --permission-prompts none`，不用 bypassPermissions / `--dangerously-skip-permissions`。
- `--input-format text|stream-json` 仅 print；`--add-dir`、`-w, --worktree [name]` 存在，M1 不启用 worktree，M5 再做。
- **本版本没有 `--max-turns`**，实现不使用。
- print 进程不能通过 stdin 注入新指令。interject 必须中断并 kill 整棵进程树，然后执行 `claude -p --verbose --output-format stream-json --permission-mode acceptEdits --permission-prompts none --resume <claudeSessionId> <新指令>`。
- Claude session id 从 system/init 或 result 的 session_id 提取，独立存储，不能与 AgentDeck uuidv7 SessionId 混用。
- 真实 `claude -p --verbose --output-format stream-json` 还会穿插 `type=rate_limit_event` 行。M1 parser 尚未专门映射该类型，会落入 `output.chunk` 兜底；不影响会话完成。下次可加忽略或独立事件，但不要发明 ui-only 事件类型。

### Codex CLI 0.165.0

- 无人值守：`codex exec`（别名 `codex e`），`--json` 输出 JSONL，`-o/--output-last-message FILE` 输出最后一条消息。
- `--sandbox read-only|workspace-write|danger-full-access`，默认只读；改文件需要 workspace-write。
- 支持 `codex exec resume` / `fork`，以及 `--cd`、`--add-dir`、`--worktree`、`--skip-git-repo-check`、`--ephemeral`、`--approve-for-me`。
- 不默认使用 `--dangerously-bypass-approvals-and-sandbox`。
- **`--full-auto` 已移除**，不可作为推荐参数。
- M1 Codex/Grok 只保留版本探测与 not_implemented 执行接口，不运行任务。

### M0/M1 实现边界

手机延后 M2，配对/设备认证尚未实现，WS 默认 loopback；不提供公网 relay。print JSONL 是观察输出，不是执行前审批协议，runtime 的最小审批不能追溯阻止已经发生的工具动作。禁止把本阶段实现宣传为完整 Phase 0 安全闭环。普通目录可作为 workspace 使用；已有 Git 仓库记录 gitRoot，不隐式 git init。开源许可 MIT。

## 附录 B：界面要求（2026-11-11）
原话：「整体的这个APP要做得有科技感一些，然后做得简单一些，功能都简单一些，然后都给我做得好一点。」
M2 起手机端：深色科技感风格，页面少、按钮少，每个功能做精；Claude Code 负责审美评审。

## 附录 C：传输改为自建公网中转（2026-11-11）
原话：「那我们不能自己搞一个吗？可以走一下公网的中转」
覆盖 §8/§14 的「不做公网 relay」：Phase 0 用自建 relay（先跑在云电脑），daemon 和手机都出站 WSS 连 relay；必须 TLS、配对码/二维码换设备 token、token 绑定机器可吊销、relay 只转发不存业务明文以外的必要数据、审计和急停照旧。Tailscale 只作可选。

### M2 实现边界

M2 增加自托管 TLS/WSS 中转：电脑与手机均主动连接，短期配对码交换绑定机器的可撤销设备令牌，中转仅保存令牌哈希及设备元数据，不落盘业务事件。Appendix C 的决定覆盖前文“不提供公共中转”的旧限制；Tailscale 仅为可选项。

移动端已提供 Expo SDK 53 源码与中文深色界面（Expo web 可在测试环境运行）；不生成原生 iOS/Android 工程，真机/TestFlight 打包不在本里程碑。重连沿用设备令牌，按最后 seq 回放；缺口触发快照恢复，事件按 seq 去重。

公网暴露实测（2026-11-11 22:21，America/Toronto，测试环境）：已安装 cloudflared 2026.10.7，无需 Cloudflare 账号即可签发 Quick Tunnel 主机名（实测得到 a temporary trycloudflare.com hostname；已退役的一次性测试主机名，不是当前端点）。但本机到 Cloudflare Tunnel 边缘的连接失败：region*.v2.argotunnel.com 的 UDP/QUIC 与 TCP/HTTP2（通常为 7844 端口）均不可达，TLS handshake with edge error: EOF（对端地址表现为 198.18.0.1），公网访问该主机名返回 HTTP 530。Cloudflare API 与 DNS 正常。因此「免注册公网中转」在这台云电脑上还缺出站访问 argotunnel 边缘（TCP/UDP 7844 或等价 HTTP/2 通道）。本机 loopback 上的 TLS WSS relay 已通过测试。该次测试日志不纳入本仓库。

### M3 实现边界（2026-11-12）

移动端改为 Expo SDK 53 原生 React Native 四屏：配对、任务及单机舰队条、新任务代理选择、结构化事件与远程控制；安全区、键盘避让、中文状态、仅在底部自动滚动。iOS 令牌由 expo-secure-store 保存，web 使用 localStorage；业务真相仍在 daemon，后台返回按 seq 重连。深链 agentdeck://pair 填入地址及配对码，需用户点击配对。机器版本探测不推断登录态，未安装代理禁选；令牌仍绑定单台机器，尚无多机聚合路由。

新增 session.interject WS 命令，Claude 中断进程树后以真实 resume id 重启；无 id 拒绝，不伪造成功。Codex exec --json 支持新任务与 workspace-write / 非 Git 目录；Codex resume 参数未在此环境验证，因此拒绝续跑和插话。Grok 只探测 CLI，执行明确 not_implemented。以上扩展覆盖前文 Codex 空壳的旧描述。测试仅使用 JSONL / 假进程，不调用模型。

approval.resolve 从手机到 runtime 并落库；超时默认拒绝，拒绝后任务失败结束。allow_always 只在同一任务生命周期内记住相同工具及参数，不跨会话保存。新增 result.resolve 命令及同名 append-only 事件：仅 done 会话可接受或拒绝一次，重连可回放，拒绝不自动回滚工作区，不伪装合并。

relay 保持 TLS、5 分钟码、令牌哈希、无业务事件持久化。Windows 跳过 chmod，无 openssl 则明确要求自备 --tls-cert / --tls-key；没有明文回退。代理进程树清理仍仅保证 POSIX。

原生配置采用 Expo CNG，scheme agentdeck、bundle com.agentdeck.app，phone-first dark。生成 ios 工程不入库，Mac 预构建安装 pods 后使用 ios/AgentDeck.xcworkspace 与 AgentDeck scheme；命令详见 apps/mobile/README.md。Linux 可验证 TS / fixtures / JS bundle，无法声称通过 Xcode 26 原生编译或模拟器视觉验收。

**Phase 0 尚未完成**：没有推送通知、AttachDriver、完整 M5 worktree / 累计 diff / 回滚合并；JSONL 是执行记录，审批仍不能保证在工具执行前拦截，拒绝将停止而非让 agent 带拒绝原因继续。因此 §13 的完整安全验收尚不满足，不将 M3 描述为完整执行沙箱。

## M4 多设备舰队与自动分配

产品需求（2026-11-12）：突出设备舰队、各 AI 安装 / 登录 / 真实余量，支持自动分配或指定设备和 AI，并明确展示分配原因。控制台保留 relay 发来的离线设备；未连过中转的机器不会出现。设备令牌从一台机器配对，授权范围为该 relay 的舰队。

确定性规则：代码任务优先 Codex → Claude → Ollama；界面 / 质量审查优先 Claude → Codex → Ollama；轻量文本优先有本地模型的 Ollama → Claude → Codex；通用任务优先 Codex → Claude → Ollama。关键词同时命中时按代码、审查、轻量顺序判断；同类按已验证登录、最近在线时间、机器 ID 排序。跳过离线、未安装、不可派发、无模型的 Ollama，以及已知余量 ≤ 0 的候选。余量未知仍可参与，但原因必须说明「余量未知」，不估算数字；Ollama 显示「本地运行，无云端额度」。只有 authenticated===true 才显示已登录。

移动端沿用四屏与安全存储 / 重连 / 审批 / 结果审阅 / 停止 / 插话；自动模式只发任务与可选目录，流页面顶部展示 routing.decision.reason。测试使用假 daemon 和纯调度输入，不调用真实模型。Phase 0 缺口仍包括执行前审批保障、推送、AttachDriver、完整 worktree / diff / 回滚合并；Linux 尚未验证 Xcode 原生编译或真机视觉效果。
