import type {
  AgentInfo,
  EventEnvelope,
  Machine,
  Session,
  RoutingDecision,
} from "@agentdeck/protocol";
export const agents = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
  ollama: "Ollama",
};
export type AgentId = keyof typeof agents;
export const statuses: Record<string, string> = {
  pending: "排队中",
  starting: "启动中",
  running: "运行中",
  needs_approval: "等你批准",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
  cancelled: "已停止",
};
export function relative(ts: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  return minutes < 1
    ? "刚刚"
    : minutes < 60
      ? `${minutes} 分钟前`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} 小时前`
        : `${Math.floor(minutes / 1440)} 天前`;
}
export function eventText(event: EventEnvelope): string {
  switch (event.type) {
    case "routing.decision":
      return `分配原因 · ${event.payload.reason}`;
    case "agent.message":
      return event.payload.text ?? event.payload.delta ?? "";
    case "user.input":
      return event.payload.text;
    case "session.status":
      return statuses[event.payload.to];
    case "session.ended":
      return event.payload.reason ?? event.payload.summary;
    case "error":
      return event.payload.message;
    case "command.exec":
      return `${event.payload.cmd}\n退出 ${event.payload.exitCode} · ${event.payload.durationMs} ms`;
    case "test.result":
      return event.payload.ok ? "测试通过" : `${event.payload.failed} 项没过`;
    case "tool.call":
      return `${event.payload.name}\n${JSON.stringify(event.payload.input, null, 2)}`;
    case "tool.result":
      return `${event.payload.ok ? "工具完成" : "工具失败"} · ${JSON.stringify(event.payload.output ?? event.payload.error)}`;
    case "file.change":
      return `文件变更 · ${event.payload.path}`;
    case "diff.snapshot":
      return `${event.payload.filesChanged} 个文件 +${event.payload.insertions} / −${event.payload.deletions}`;
    case "approval.request":
      return `等待批准 · ${event.payload.summary}`;
    case "approval.resolve":
      return {
        allow: "已允许",
        allow_always: "已允许 之后同样的操作不再问",
        deny: "已拒绝",
      }[event.payload.decision];
    case "result.resolve":
      return event.payload.decision === "accept"
        ? "结果已接受"
        : "结果已拒绝 文件没有回滚";
    case "output.chunk":
      try {
        return decodeURIComponent(
          Array.from(
            atob(event.payload.data),
            (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"),
          ).join(""),
        );
      } catch {
        return "这段输出解不出来";
      }
    case "agent.reasoning":
      return event.payload.summary;
    default:
      return "";
  }
}

export function osKind(os: Machine["os"]): string {
  return { darwin: "Mac", win32: "Windows", linux: "云端" }[os];
}
export function machineTitle(machine: Machine): string {
  const kind = osKind(machine.os);
  return machine.name === kind || machine.name.includes(kind)
    ? machine.name
    : `${machine.name} · ${kind}`;
}
export function machineTitleById(
  machines: Machine[],
  id: string | undefined,
  fallback: string,
): string {
  const m = machines.find((x) => x.id === id);
  return m ? machineTitle(m) : fallback;
}
export function selectable(machine: Machine | undefined, id: AgentId): boolean {
  const a = machine?.agents.find((a) => a.id === id);
  return (
    !!machine?.online && !!a && a.installed !== false && a.dispatchable === true
  );
}
export function agentStatus(a?: AgentInfo): string {
  if (!a || a.installed === false) return "未安装";
  const installed = a.dispatchable === true ? "已安装" : "已安装但不可派发";
  const quota = quotaView(a).label;
  return `${installed} · ${a.authenticated === true ? "已登录" : "登录未验证"} · ${quota}${a.accountHint ? ` · ${a.accountHint}` : ""}`;
}

export function fleetInstalled(machine: Machine): AgentId[] {
  return (Object.keys(agents) as AgentId[]).filter((id) => {
    const a = machine.agents.find((x) => x.id === id);
    return !!a && a.installed !== false;
  });
}
export function fleetMissing(machine: Machine): AgentId[] {
  return (Object.keys(agents) as AgentId[]).filter(
    (id) => !fleetInstalled(machine).includes(id),
  );
}

export const serverCopy: Record<string, string> = {
  '邮箱或密码不对':'邮箱或密码不对',
  '验证码无效或已过期':'验证码无效或已过期',
  '验证码发送失败':'验证码没发出去 稍后再试',
  请输入六位配对码: "配对码是六位数字",
  "中转地址必须使用 wss://": "地址要以 wss:// 开头",
  "连接失败，请检查中转地址与 TLS 证书": "连不上 检查地址和 TLS 证书",
  "配对已失效，请重新连接": "配对失效了 重新配对一次",
  连接尚未就绪: "还没连上 稍等一下",
  "无法保存设备令牌，请检查设备安全存储；下次启动需重新配对":
    "令牌没存上 下次打开要重新配对",
  "无法清除设备令牌，请在设置中清除应用数据":
    "令牌没清掉 去系统设置里清除应用数据",
  "当前没有在线且可派发的 AI": "现在没有在线又能派活的 AI",
  "所选设备或 AI 当前不可派发": "选的设备或 AI 现在派不了",
  "找不到任务所属设备，请刷新任务列表": "找不到这个任务的设备 回列表刷新一下",
  "电脑离线，等待重新连接": "电脑离线 等它重新连上",
  "invalid or expired pairing code": "配对码过期了 扫描电脑上的新二维码",
  "invalid credentials": "配对失效了 重新配对一次",
  "authentication required": "还没连上 稍等一下",
  "invalid request": "请求没被接受",
  "missing auth credentials": "配对失效了 重新配对一次",
  审批已处理或已过期: "这条审批已经处理过或过期了",
  "审批已拒绝，任务已停止": "已拒绝 任务停了",
  不支持此代理: "这台电脑不支持这个 AI",
  "Grok Bot 尚未实现运行支持（not_implemented）": "Grok 还不能执行任务",
  "Grok Bot 尚未实现运行支持": "Grok 还不能执行任务",
  "任务已结束，无法追加指令，请新建任务": "任务已经结束 新开一个吧",
  请先处理待审批请求: "先处理上面的审批",
  只能审阅已完成任务: "任务完成后才能审阅",
  结果已审阅: "这个结果已经审过了",
  "此电脑未检测到所选代理，请先安装 CLI": "这台电脑没装这个 AI 的命令行",
  "此代理暂不支持续跑，请新建任务": "这个 AI 暂不支持中途追加 新开一个任务",
  此代理暂不支持插话续跑: "这个 AI 暂不支持改方向",
  任务已停止: "任务已停止",
  "尚未获得代理会话 ID，请稍后再试": "它还没准备好 稍后再试",
  代理退出但未返回完成事件: "AI 中途退出了 没给出结果",
  请求失败: "没发出去 再试一次",
  "session failed": "任务启动失败",
  "Codex 续跑暂未实现，请新建任务": "Codex 暂不支持中途追加 新开一个任务",
  "Codex 续跑暂未实现": "Codex 暂不支持中途追加",
  "Ollama 没有已安装的本地模型": "Ollama 里还没有本地模型",
  not_implemented: "这个功能还没做",
  本轮任务已完成: "这一轮跑完了",
};
export function tidy(text: string): string {
  return (
    serverCopy[text.trim()] ??
    text
      .replace("；已知余量须大于 0，未知额度不编造", "")
      .replace(/[。.]\s*$/u, "")
      .replace(/。\s*/gu, "  ")
      .trim()
  );
}
export const agentMeta = {
  claude: { color: "claude", glyph: "star" },
  codex: { color: "codex", glyph: "prompt" },
  grok: { color: "grok", glyph: "ring" },
  ollama: { color: "ollama", glyph: "chip" },
} as const;
export function fleetStats(machines: Machine[], sessions: Session[]) {
  return {
    online: machines.filter((m) => m.online).length,
    total: machines.length,
    ready: machines.reduce(
      (n, m) =>
        n +
        (Object.keys(agents) as AgentId[]).filter((id) => selectable(m, id))
          .length,
      0,
    ),
    active: sessions.filter((s) =>
      ["pending", "starting", "running", "needs_approval", "paused"].includes(
        s.status,
      ),
    ).length,
    approval: sessions.some((s) => s.status === "needs_approval"),
  };
}
export function quotaView(agent?: AgentInfo): {
  kind: "ratio" | "value" | "unknown" | "local";
  ratio?: number;
  label: string;
} {
  if (agent?.id === "ollama")
    return {
      kind: "local",
      label: agent.accountHint || "本地运行，无云端额度",
    };
  if (!agent?.quota.known) return { kind: "unknown", label: "余量未知" };
  const q = agent.quota,
    label = `余量 ${q.remaining} ${q.unit}`;
  return q.limit !== undefined && q.limit > 0
    ? {
        kind: "ratio",
        ratio: Math.max(0, Math.min(1, q.remaining / q.limit)),
        label,
      }
    : { kind: "value", label };
}
export function agentTile(a?: AgentInfo) {
  return !a || a.installed === false
    ? { label: "未安装", color: "mute" as const }
    : a.dispatchable !== true
      ? { label: "暂不可派发", color: "dim" as const }
      : a.authenticated === true
        ? { label: "已登录", color: "ok" as const }
        : { label: "登录未验证", color: "warn" as const };
}
export function reasonView(decision: RoutingDecision, agentName: string) {
  const note =
    decision.candidates.find(
      (c) =>
        c.machineId === decision.machineId && c.agentId === decision.agentId,
    )?.note ?? "";
  return {
    short: (
      {
        code: "偏代码实现",
        review: "偏界面和质量审查",
        light: "轻量文本",
        general: "通用任务",
      } as Record<string, string>
    )[decision.rule]
      ? `${({ code: "偏代码实现", review: "偏界面和质量审查", light: "轻量文本", general: "通用任务" } as Record<string, string>)[decision.rule]} 优先派给 ${agentName}`
      : tidy(decision.reason),
    facts: `在线 · ${decision.reason.includes("已验证登录") ? "已登录" : "登录未验证"} · ${note.includes("本地模型，无云端额度限制") ? "本地运行，无云端额度" : note.includes("余量未知") ? "余量未知" : note.startsWith("剩余 ") ? tidy(note) : "余量未知"}`,
  };
}
export type EventGroup = {
  key: number;
  kind: string;
  events: EventEnvelope[];
  text: string;
};
export function groupEvents(
  events: EventEnvelope[],
  mode: "key" | "all",
): EventGroup[] {
  const groups: EventGroup[] = [];
  const calls = new Map<string, EventGroup>();
  for (const e of events) {
    if (["routing.decision", "session.created", "cost.update"].includes(e.type))
      continue;
    if (e.type === "tool.result") {
      const call = calls.get(e.payload.toolCallId);
      if (call) {
        call.events.push(e);
        call.text += "\n" + eventText(e);
        continue;
      }
    }
    const kind = e.type,
      last = groups[groups.length - 1],
      previous = last?.events[last.events.length - 1];
    const merge =
      last &&
      ((kind === last.kind &&
        [
          "agent.message",
          "agent.reasoning",
          "session.status",
          "output.chunk",
        ].includes(kind) &&
        !(previous?.type === "agent.message" && previous.payload.final)) ||
        (e.type === "session.ended" && last.kind === "session.status"));
    const text =
      e.type === "session.ended"
        ? `${statuses[e.payload.status]} · ${tidy(e.payload.reason ?? e.payload.summary)}`
        : e.type === "session.status"
          ? `${statuses[e.payload.to]}${e.payload.reason ? " · " + tidy(e.payload.reason) : ""}`
          : e.type === "error"
            ? tidy(e.payload.message)
            : e.type === "approval.request"
              ? `等你批准 · ${tidy(e.payload.summary)}`
              : eventText(e);
    if (merge) {
      last.events.push(e);
      if (e.type === "agent.message")
        last.text = e.payload.text ?? last.text + (e.payload.delta ?? "");
      else if (e.type === "agent.reasoning") last.text = e.payload.summary;
      else if (e.type === "session.ended") {
        last.kind = e.type;
        last.text = text;
      } else if (e.type === "session.status") last.text += " → " + text;
      else last.text += text;
    } else {
      const group = { key: e.seq, kind, events: [e], text };
      groups.push(group);
      if (e.type === "tool.call") calls.set(e.payload.toolCallId, group);
    }
  }
  if (mode === "all") return groups;
  const folded: EventGroup[] = [];
  for (const group of groups) {
    if (
      !["tool.call", "tool.result", "command.exec", "output.chunk"].includes(
        group.kind,
      )
    ) {
      folded.push(group);
      continue;
    }
    const last = folded[folded.length - 1];
    if (last?.kind === "tools") {
      last.events.push(...group.events);
      last.text += "\n" + group.text;
    } else folded.push({ ...group, kind: "tools", events: [...group.events] });
  }
  return folded;
}
export function pairLink(value: string) {
  try {
    const u = new URL(value);
    const isPair =
      (u.protocol === "agentdeck:" && u.hostname === "pair") ||
      u.pathname.includes("--/pair");
    const relay = u.searchParams.get("relay") ?? "";
    const code = u.searchParams.get("code") ?? "";
    const complete = relay.startsWith("wss://") && /^\d{6}$/.test(code);
    if (complete && (isPair || u.protocol === "https:")) return { relay, code };
    // Bare pair URL opens the scan screen, without submitting
    if (isPair && !relay && !code) return { relay: "", code: "" };
    return;
  } catch {
    return;
  }
}

export function statusTone(
  status: string,
): "mute" | "accent" | "ok" | "warn" | "danger" {
  return status === "needs_approval"
    ? "warn"
    : status === "done"
      ? "ok"
      : status === "failed"
        ? "danger"
        : ["starting", "running"].includes(status)
          ? "accent"
          : "mute";
}
