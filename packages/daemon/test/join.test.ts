import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { WSMessage } from "@agentdeck/protocol";
import { startRelay } from "../../relay/dist/index.js";
import { joinRelay, parseJoinLink } from "../dist/join.js";
import { createPairPage } from "../dist/pair-page.js";
async function wait(f: () => boolean) {
  const end = Date.now() + 6000;
  while (!f()) {
    if (Date.now() > end) throw Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function socket(url: string) {
  const ws = new WebSocket(url, { rejectUnauthorized: false }),
    messages: WSMessage[] = [];
  ws.on("message", (d) =>
    messages.push(WSMessage.parse(JSON.parse(d.toString()))),
  );
  ws.on("error", () => {});
  await once(ws, "open");
  return {
    ws,
    send: (m: WSMessage) => ws.send(JSON.stringify(m)),
    async get<T extends WSMessage["type"]>(type: T) {
      await wait(() => messages.some((m) => m.type === type));
      return messages.splice(
        messages.findIndex((m) => m.type === type),
        1,
      )[0] as Extract<WSMessage, { type: T }>;
    },
  };
}
async function harness() {
  const home = mkdtempSync(join(tmpdir(), "agentdeck-join-"));
  writeFileSync(
    join(home, "relay.json"),
    JSON.stringify({ relaySecret: "fake-relay-secret-for-join-tests" }),
    { mode: 0o600 },
  );
  let now = Date.now();
  const relay = await startRelay({ home, port: 0, now: () => now }),
    url = `wss://127.0.0.1:${(relay.server.address() as { port: number }).port}`,
    secret = JSON.parse(readFileSync(join(home, "relay.json"), "utf8"))
      .relaySecret as string;
  const daemon = await socket(url);
  daemon.send({
    type: "auth",
    role: "daemon",
    machineId: "first",
    relaySecret: secret,
  });
  await daemon.get("auth.ok");
  return {
    home,
    relay,
    url,
    secret,
    daemon,
    advance: (ms: number) => (now += ms),
    async offer() {
      daemon.send({ type: "join.start" });
      return daemon.get("join.offer");
    },
    async close() {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
describe("one-command computer join", () => {
  it("exchanges a one-time ticket then permits standard daemon auth and saves credentials privately", async () => {
    const h = await harness();
    try {
      const offer = await h.offer();
      expect(offer.ticket.length).toBeGreaterThanOrEqual(43);
      expect(offer.expiresAt).toBeGreaterThan(Date.now() + 290000);
      expect(offer.command.includes(h.secret)).toBe(false);
      const link = offer.command.match(/'([^']+)'/)![1];
      const target = join(h.home, "new-computer");
      const saved = await joinRelay(link, target, undefined, true);
      const credentials = JSON.parse(readFileSync(saved.secretFile, "utf8"));
      expect(credentials.relaySecret === h.secret).toBe(true);
      expect(saved.relayUrl).toBe(h.url);
      if (process.platform !== "win32")
        expect(statSync(saved.secretFile).mode & 0o777).toBe(0o600);
      const next = await socket(h.url);
      next.send({
        type: "auth",
        role: "daemon",
        machineId: "second",
        relaySecret: credentials.relaySecret,
      });
      expect((await next.get("auth.ok")).machineId).toBe("second");
      const duplicate = await socket(h.url);
      duplicate.send({ type: "daemon.join", ticket: offer.ticket });
      await duplicate.get("error");
      await wait(() => duplicate.ws.readyState === WebSocket.CLOSED);
    } finally {
      await h.close();
    }
  });
  it("rejects expired, superseded, unknown and unauthenticated join requests", async () => {
    const h = await harness();
    try {
      const first = await h.offer(),
        fresh = await h.offer();
      for (const ticket of [first.ticket, "invented"]) {
        const bad = await socket(h.url);
        bad.send({ type: "daemon.join", ticket });
        await bad.get("error");
      }
      h.advance(300000);
      const expired = await socket(h.url);
      expired.send({ type: "daemon.join", ticket: fresh.ticket });
      await expired.get("error");
      const unauthenticated = await socket(h.url);
      unauthenticated.send({ type: "join.start" });
      await unauthenticated.get("error");
      h.daemon.send({ type: "pair.start" });
      const pair = await h.daemon.get("pair.offer"),
        device = await socket(h.url);
      device.send({ type: "pair.complete", code: pair.code });
      await device.get("pair.granted");
      device.send({ type: "join.start" });
      await device.get("error");
    } finally {
      await h.close();
    }
  });
  it("parses HTTPS links and relay overrides while requiring WSS", () => {
    const link =
      "https://example.test/join?relay=wss%3A%2F%2Frelay.test&ticket=fake-ticket";
    expect(parseJoinLink(link, "wss://override.test")).toEqual({
      relayUrl: "wss://override.test",
      ticket: "fake-ticket",
    });
    expect(() =>
      parseJoinLink("agentdeck://join?relay=ws://unsafe&ticket=fake"),
    ).toThrow();
  });
  it("serves a loopback-only QR page and updates public capabilities without secrets", async () => {
    const page = createPairPage();
    try {
      const port = await page.ready;
      await page.setPair({
        code: "123456",
        expiresAt: Date.now() + 300000,
        qrText: "agentdeck://pair?relay=wss://example.test&code=123456",
      });
      page.setJoin({
        command:
          "agentdeck join 'agentdeck://join?relay=wss://example.test&ticket=fake-ticket'",
        expiresAt: Date.now() + 300000,
      });
      const url = `http://127.0.0.1:${port}`;
      expect(port).not.toBe(8443);
      expect(port).not.toBe(8787);
      const html = await (await fetch(url)).text();
      expect(html).toContain("用手机上的 AgentDeck 扫描");
      expect(await (await fetch(url + "/qr.svg?v=123456")).text()).toContain(
        "<svg",
      );
      const state = await (await fetch(url + "/state")).json();
      expect(state.code).toBe("123456");
      expect(Object.keys(state)).not.toContain("relaySecret");
      await page.setPair({
        code: "654321",
        expiresAt: Date.now() + 300000,
        qrText: "agentdeck://pair?code=654321",
      });
      expect((await (await fetch(url + "/state")).json()).code).toBe("654321");
    } finally {
      await page.close();
    }
  });
  it("CLI joins and immediately serves; stderr pairing instructions and page never reveal the secret", async () => {
    const h = await harness();
    let child: ReturnType<typeof spawn> | undefined;
    let stderr = "";
    try {
      const offer = await h.offer(),
        link = offer.command.match(/'([^']+)'/)![1],
        target = join(h.home, "cli-computer");
      // Relay clock puts refresh deadlines within one second for this isolated daemon.
      h.advance(-295000);
      child = spawn(
        process.execPath,
        [
          resolve("packages/daemon/dist/cli.js"),
          "join",
          link,
          "--home",
          target,
          "--cwd",
          h.home,
          "--fixture",
          resolve("packages/daemon/test/fixtures/auto-demo-codex.jsonl"),
          "--tls-insecure",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stderr!.on("data", (d) => (stderr += d));
      await wait(
        () =>
          stderr.includes("再加一台电脑") &&
          /配对码 \d{6}/.test(stderr) &&
          stderr.includes("配对页 http://127.0.0.1:"),
      );
      expect(stderr.includes(h.secret)).toBe(false);
      expect(
        JSON.parse(readFileSync(join(target, "relay.json"), "utf8"))
          .relaySecret === h.secret,
      ).toBe(true);
      const url = /配对页 (http:\/\/127\.0\.0\.1:\d+\/)/.exec(stderr)![1];
      const stateText = await (await fetch(url + "state")).text();
      expect(stateText.includes(h.secret)).toBe(false);
      const state = JSON.parse(stateText);
      expect(state.command).toMatch(/^agentdeck join 'agentdeck:\/\/join\?/);
      await wait(
        () =>
          (stderr.match(/再加一台电脑/g) ?? []).length >= 2 &&
          (stderr.match(/配对码 \d{6}/g) ?? []).length >= 2,
      );
      const refreshed = await (await fetch(url + "state")).json();
      expect(refreshed.command === state.command).toBe(false);
      expect(stderr.includes(h.secret)).toBe(false);
      const mobile = await socket(h.url);
      mobile.send({ type: "pair.complete", code: refreshed.code });
      await mobile.get("pair.granted");
      mobile.send({ type: "machine.register" });
      const fleet = await mobile.get("fleet.snapshot");
      expect(fleet.machines.some((m) => m.online)).toBe(true);
    } finally {
      if (child && child.exitCode === null) {
        const ended = once(child, "close");
        child.kill("SIGTERM");
        await ended;
      }
      await h.close();
    }
  });
});
