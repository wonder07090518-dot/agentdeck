import { describe, it, expect } from "vitest";
import type {
  AgentInfo,
  EventEnvelope,
  Machine,
  RoutingDecision,
  Session,
} from "@agentdeck/protocol";
import {
  agentTile,
  fleetStats,
  groupEvents,
  pairLink,
  quotaView,
  reasonView,
  tidy,
} from "../../../apps/mobile/src/presentation";
const agent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  id: "codex",
  version: "fixture",
  authenticated: false,
  installed: true,
  dispatchable: true,
  quota: { known: false },
  supports: {
    jsonOut: true,
    resume: false,
    interactive: false,
    permissions: false,
  },
  ...overrides,
});
const event = (seq: number, type: string, payload: unknown) =>
  ({
    v: 1,
    sessionId: "fixture",
    seq,
    ts: seq,
    origin: "agent",
    type,
    payload,
  }) as EventEnvelope;
describe("mobile presentation contracts", () => {
  it("pairs QR, Expo deep links and HTTPS query pages without manual re-entry", () => {
    for (const base of [
      "agentdeck://pair",
      "exp://127.0.0.1:8081/--/pair",
      "https://example.test/",
    ])
      expect(
        pairLink(base + "?relay=wss%3A%2F%2Fexample.test&code=012345"),
      ).toEqual({ relay: "wss://example.test", code: "012345" });
    expect(
      pairLink("agentdeck://pair?relay=ws://unsafe&code=123456"),
    ).toBeUndefined();
    expect(
      pairLink("agentdeck://pair?relay=wss://example&code=123"),
    ).toBeUndefined();
    expect(pairLink("exp://127.0.0.1:8081/--/pair")).toEqual({
      relay: "",
      code: "",
    });
    expect(pairLink("agentdeck://pair")).toEqual({ relay: "", code: "" });
  });
  it("never invents quota ratios or verified login and counts only actual fleet data", () => {
    expect(quotaView(agent())).toEqual({ kind: "unknown", label: "余量未知" });
    expect(
      quotaView(agent({ quota: { known: true, remaining: 50, unit: "次" } })),
    ).toEqual({ kind: "value", label: "余量 50 次" });
    expect(
      quotaView(
        agent({
          quota: { known: true, remaining: 500, limit: 100, unit: "次" },
        }),
      ).ratio,
    ).toBe(1);
    expect(quotaView(agent({ id: "ollama" })).kind).toBe("local");
    expect(agentTile(agent()).label).toBe("登录未验证");
    expect(agentTile(agent({ authenticated: true })).label).toBe("已登录");
    const machines: Machine[] = [
      {
        id: "m",
        name: "fixture",
        os: "linux",
        online: true,
        lastSeen: 1,
        labels: [],
        agents: [agent()],
      },
    ];
    const sessions = [
      { status: "running" },
      { status: "paused" },
      { status: "done" },
    ] as Session[];
    expect(fleetStats(machines, sessions)).toMatchObject({
      online: 1,
      total: 1,
      ready: 1,
      active: 2,
    });
  });
  it("merges streaming text and reasoning, pairs tool results and folds tools in key mode", () => {
    const events = [
      event(1, "agent.reasoning", { summary: "first" }),
      event(2, "agent.reasoning", { summary: "latest" }),
      event(3, "agent.message", { delta: "hello " }),
      event(4, "agent.message", { delta: "world", final: true }),
      event(5, "tool.call", { toolCallId: "a", name: "read", input: {} }),
      event(6, "tool.result", { toolCallId: "a", ok: true, output: "fixture" }),
      event(7, "command.exec", {
        cmd: "test",
        exitCode: 0,
        cwd: "/tmp",
        durationMs: 1,
      }),
    ];
    const all = groupEvents(events, "all");
    expect(all[0].text).toBe("latest");
    expect(all[0].events).toHaveLength(2);
    expect(all[1].text).toBe("hello world");
    expect(all[2].events).toHaveLength(2);
    expect(groupEvents(events, "key").map((g) => g.kind)).toEqual([
      "agent.reasoning",
      "agent.message",
      "tools",
    ]);
  });
  it("keeps agent punctuation intact while translating system text and deriving concise routing copy", () => {
    expect(tidy("请输入六位配对码")).toBe("配对码是六位数字");
    expect(tidy("系统提示\u3002下一句\u3002")).toBe("系统提示  下一句");
    expect(
      groupEvents(
        [event(1, "agent.message", { text: "代理原文\u3002" })],
        "key",
      )[0].text,
    ).toBe("代理原文\u3002");
    const d: RoutingDecision = {
      machineId: "m",
      machineName: "fixture",
      agentId: "codex",
      rule: "code",
      reason: "在线 已验证登录",
      candidates: [
        { machineId: "m", agentId: "codex", eligible: true, note: "余量未知" },
      ],
    };
    expect(reasonView(d, "Codex")).toEqual({
      short: "偏代码实现 优先派给 Codex",
      facts: "在线 · 已登录 · 余量未知",
    });
  });
});
