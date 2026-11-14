import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { WSMessage, type Machine, type Session } from "@agentdeck/protocol";
import { startRelay } from "../../relay/dist/index.js";
import { loginAccount } from "../dist/account.js";
async function wait(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw Error("message timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function peer(url: string) {
  const ws = new WebSocket(url, { rejectUnauthorized: false }),
    messages: WSMessage[] = [];
  ws.on("message", (d) =>
    messages.push(WSMessage.parse(JSON.parse(d.toString()))),
  );
  ws.on("error", () => {});
  await once(ws, "open");
  return {
    ws,
    messages,
    send: (m: WSMessage) => ws.send(JSON.stringify(m)),
    async receive<T extends WSMessage["type"]>(type: T) {
      await wait(() => messages.some((m) => m.type === type));
      return messages.splice(
        messages.findIndex((m) => m.type === type),
        1,
      )[0] as Extract<WSMessage, { type: T }>;
    },
  };
}
type Peer = Awaited<ReturnType<typeof peer>>;
const machine = (id: string): Machine => ({
  id,
  name: id,
  os: "win32",
  online: true,
  lastSeen: 1,
  agents: [],
  labels: [],
});
it("accounts register, normalize, login, hide existence, persist hashes and reconnect tokens", async () => {
  const home = mkdtempSync(join(tmpdir(), "agentdeck-account-"));
  const relay = await startRelay({ home, port: 0 });
  const url = `wss://127.0.0.1:${(relay.server.address() as { port: number }).port}`;
  try {
    const p = await peer(url);
    p.send({
      type: "account.register",
      email: "  USER@example.com ",
      password: "fixture-password",
      role: "phone",
    });
    const grant = await p.receive("account.granted");
    p.send({ type: "session.list" });
    expect((await p.receive("error")).message).toBe("authentication required");
    const phone = await peer(url);
    phone.send({ type: "auth", role: "device", token: grant.token });
    await phone.receive("auth.ok");
    const login = await peer(url);
    login.send({
      type: "account.login",
      email: "user@example.com",
      password: "fixture-password",
      role: "computer",
    });
    expect((await login.receive("account.granted")).accountId).toBe(
      grant.accountId,
    );
    for (const email of ["user@example.com", "missing@example.com"])
      for (const type of ["account.login", "account.register"] as const) {
        const bad = await peer(url);
        bad.send({
          type,
          email,
          password:
            type === "account.register" && email.startsWith("missing")
              ? "short"
              : "wrong-password",
          role: "phone",
        });
        expect((await bad.receive("error")).message).toBe("邮箱或密码不对");
      }
    const file = readFileSync(join(home, "accounts.json"), "utf8");
    expect(file.includes("fixture-password")).toBe(false);
    expect(file.includes(grant.token)).toBe(false);
    expect(JSON.parse(file).accounts[0].email).toBe("user@example.com");
    if (process.platform !== "win32")
      expect(statSync(join(home, "accounts.json")).mode & 0o777).toBe(0o600);
    const cliHome = join(home, "computer");
    await loginAccount(
      "user@example.com",
      "fixture-password",
      url,
      cliHome,
      true,
    );
    expect(
      JSON.parse(readFileSync(join(cliHome, "account.json"), "utf8")).role,
    ).toBe("computer");
  } finally {
    await relay.close();
    rmSync(home, { recursive: true, force: true });
  }
});
it("isolates two accounts, sessions, direct routes and legacy pairing; desktop magic is private, expired and single use", async () => {
  const home = mkdtempSync(join(tmpdir(), "agentdeck-isolation-"));
  let now = 1000;
  const relay = await startRelay({ home, port: 0, now: () => now });
  const url = `wss://127.0.0.1:${(relay.server.address() as { port: number }).port}`;
  const previous = process.env.AGENTDECK_SMTP_URL;
  delete process.env.AGENTDECK_SMTP_URL;
  try {
    const register = async (email: string, role: "phone" | "computer") => {
      const p = await peer(url);
      p.send({
        type: "account.register",
        email,
        password: "fixture-password",
        role,
      });
      const g = await p.receive("account.granted");
      p.send(
        role === "computer"
          ? { type: "auth", role: "daemon", token: g.token, machineId: email }
          : { type: "auth", role: "device", token: g.token },
      );
      await p.receive("auth.ok");
      return p;
    };
    const a = await register("a@example.com", "computer"),
      b = await register("b@example.com", "computer");
    a.send({ type: "machine.snapshot", machine: machine("a@example.com") });
    b.send({ type: "machine.snapshot", machine: machine("b@example.com") });
    const pa = await register("a@example.com", "phone"),
      pb = await register("b@example.com", "phone");
    expect(
      (await pa.receive("fleet.snapshot")).machines.map((m) => m.id),
    ).toEqual(["a@example.com"]);
    expect(
      (await pb.receive("fleet.snapshot")).machines.map((m) => m.id),
    ).toEqual(["b@example.com"]);
    const secret = JSON.parse(
        readFileSync(join(home, "relay.json"), "utf8"),
      ).relaySecret,
      legacy = await peer(url);
    legacy.send({
      type: "auth",
      role: "daemon",
      machineId: "legacy",
      relaySecret: secret,
    });
    await legacy.receive("auth.ok");
    legacy.send({ type: "machine.snapshot", machine: machine("legacy") });
    legacy.send({ type: "pair.start" });
    const offer = await legacy.receive("pair.offer");
    const old = await peer(url);
    old.send({ type: "pair.complete", code: offer.code });
    const oldGrant = await old.receive("pair.granted");
    expect(
      (await old.receive("fleet.snapshot")).machines.map((m) => m.id),
    ).toEqual(["legacy"]);
    const reconnect = await peer(url);
    reconnect.send({ type: "auth", role: "device", token: oldGrant.token });
    await reconnect.receive("auth.ok");
    expect(
      (await reconnect.receive("fleet.snapshot")).machines.map((m) => m.id),
    ).toEqual(["legacy"]);
    const session: Session = {
      id: "11111111-1111-4111-8111-111111111111",
      taskId: null,
      machineId: "a@example.com",
      agentId: "claude",
      workspace: { machineId: "a@example.com", path: home },
      mode: "delegate",
      status: "done",
      title: "private",
      startedAt: 1,
      seq: 0,
    };
    a.send({ type: "session.list.result", sessions: [session] });
    pa.send({ type: "session.list" });
    await wait(() =>
      pa.messages.some(
        (m) => m.type === "session.list.result" && m.sessions.length === 1,
      ),
    );
    pb.send({ type: "session.list" });
    await pb.receive("session.list.result");
    expect(
      pb.messages.some(
        (m) => m.type === "session.list.result" && m.sessions.length,
      ),
    ).toBe(false);
    pb.send({
      type: "session.create",
      route: "direct",
      machineId: "a@example.com",
      prompt: "cross account",
      clientMsgId: "cross",
    });
    await pb.receive("error");
    expect(a.messages.some((m) => m.type === "session.create")).toBe(false);
    a.send({ type: "pair.start" });
    const bound = await a.receive("pair.offer");
    const paired = await peer(url);
    paired.send({ type: "pair.complete", code: bound.code });
    await paired.receive("pair.granted");
    expect(
      (await paired.receive("fleet.snapshot")).machines.map((m) => m.id),
    ).toEqual(["a@example.com"]);
    a.send({ type: "join.start" });
    const ticket = await a.receive("join.offer");
    const joined = await peer(url);
    joined.send({ type: "daemon.join", ticket: ticket.ticket });
    const joinedGrant = await joined.receive("daemon.joined");
    expect(joinedGrant.relaySecret).toBeUndefined();
    expect(joinedGrant.token).toBeTruthy();
    joined.send({
      type: "auth",
      role: "daemon",
      machineId: "second-a",
      token: joinedGrant.token,
    });
    await joined.receive("auth.ok");
    joined.send({ type: "machine.snapshot", machine: machine("second-a") });
    await wait(() =>
      pa.messages.some(
        (m) => m.type === "fleet.snapshot" && m.machines.length === 2,
      ),
    );
    const remote = await peer(url);
    remote.send({
      type: "account.magic.start",
      email: "a@example.com",
      purpose: "login",
    });
    const sent = await remote.receive("account.magic.sent");
    expect(sent.via).toBe("desktop");
    const code = relay.peekMagic("a@example.com")!;
    expect((await a.receive("account.magic.code")).code === code).toBe(true);
    expect(JSON.stringify([...remote.messages, sent]).includes(code)).toBe(
      false,
    );
    expect(
      readFileSync(join(home, "accounts.json"), "utf8").includes(code),
    ).toBe(false);
    expect(b.messages.some((m) => m.type === "account.magic.code")).toBe(false);
    remote.send({
      type: "account.magic.complete",
      email: "a@example.com",
      code,
      role: "phone",
    });
    const magicGrant = await remote.receive("account.granted");
    remote.send({
      type: "account.magic.complete",
      email: "a@example.com",
      code,
      role: "phone",
    });
    expect((await remote.receive("error")).message).toBe("验证码无效或已过期");
    remote.send({ type: "auth", role: "device", token: magicGrant.token });
    await remote.receive("auth.ok");
    const expired = await peer(url);
    expired.send({
      type: "account.magic.start",
      email: "a@example.com",
      purpose: "login",
    });
    const exp = await expired.receive("account.magic.sent"),
      expiredCode = relay.peekMagic("a@example.com")!;
    now = exp.expiresAt;
    expired.send({
      type: "account.magic.complete",
      email: "a@example.com",
      code: expiredCode,
      role: "phone",
    });
    expect((await expired.receive("error")).message).toBe("验证码无效或已过期");
  } finally {
    if (previous === undefined) delete process.env.AGENTDECK_SMTP_URL;
    else process.env.AGENTDECK_SMTP_URL = previous;
    await relay.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);

it("CLI login serves immediately, prints desktop codes and saved token serves again", async () => {
  const home = mkdtempSync(join(tmpdir(), "agentdeck-cli-account-")),
    computerHome = join(home, "computer");
  const relay = await startRelay({ home: join(home, "relay"), port: 0 });
  const url = `wss://127.0.0.1:${(relay.server.address() as { port: number }).port}`;
  let child: ReturnType<typeof spawn> | undefined;
  let stderr = "";
  const stop = async () => {
    if (child && child.exitCode === null) {
      const closed = once(child, "close");
      child.kill("SIGTERM");
      await closed;
    }
    child = undefined;
  };
  try {
    const run = (command: string) => {
      stderr = "";
      child = spawn(
        process.execPath,
        [
          resolve("packages/daemon/dist/cli.js"),
          command,
          "--home",
          computerHome,
          "--cwd",
          home,
          "--relay",
          url,
          "--tls-insecure",
          "--name",
          "Test Windows",
        ],
        {
          env: {
            ...process.env,
            AGENTDECK_EMAIL: "cli@agentdeck.test",
            AGENTDECK_PASSWORD: "fixture-password",
            AGENTDECK_CLAUDE_BIN: "agentdeck-missing-test-bin",
            AGENTDECK_CODEX_BIN: "agentdeck-missing-test-bin",
            AGENTDECK_GROK_BIN: "agentdeck-missing-test-bin",
            AGENTDECK_OLLAMA_BIN: "agentdeck-missing-test-bin",
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      child.stderr!.on("data", (data) => (stderr += data));
    };
    run("login");
    await wait(() => stderr.includes("已登录 正在连接"));
    const saved = JSON.parse(
      readFileSync(join(computerHome, "account.json"), "utf8"),
    );
    expect(stderr.includes(saved.token)).toBe(false);
    expect(stderr.includes("fixture-password")).toBe(false);
    const phone = await peer(url);
    phone.send({
      type: "account.login",
      email: "cli@agentdeck.test",
      password: "fixture-password",
      role: "phone",
    });
    const grant = await phone.receive("account.granted");
    phone.send({ type: "auth", role: "device", token: grant.token });
    await phone.receive("auth.ok");
    await wait(() =>
      phone.messages.some(
        (m) => m.type === "fleet.snapshot" && m.machines.length === 1,
      ),
    );
    const first = phone.messages.find(
      (m) => m.type === "fleet.snapshot" && m.machines.length === 1,
    ) as Extract<WSMessage, { type: "fleet.snapshot" }>;
    expect(first.machines.map((m) => m.name)).toEqual(["Test Windows"]);
    const id = first.machines[0].id;
    const magic = await peer(url);
    magic.send({
      type: "account.magic.start",
      email: "cli@agentdeck.test",
      purpose: "login",
    });
    await magic.receive("account.magic.sent");
    const code = relay.peekMagic("cli@agentdeck.test")!;
    await wait(() => stderr.includes(`这台手机正在登录 验证码是 ${code}\n`));
    expect(stderr.includes(saved.token)).toBe(false);
    await stop();
    await wait(() =>
      phone.messages.some(
        (m) => m.type === "fleet.snapshot" && m.machines.some((m) => !m.online),
      ),
    );
    phone.messages.length = 0;
    run("serve");
    await wait(() =>
      phone.messages.some(
        (m) =>
          m.type === "fleet.snapshot" &&
          m.machines.some((m) => m.id === id && m.online),
      ),
    );
    expect(stderr.includes(saved.token)).toBe(false);
  } finally {
    await stop();
    await relay.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);

it("locks magic codes after five failures, does not reset on start, and hides missing machines from other fleets", async () => {
  const home = mkdtempSync(join(tmpdir(), "agentdeck-lock-"));
  let now = 1000;
  const relay = await startRelay({ home, port: 0, now: () => now });
  const url = `wss://127.0.0.1:${(relay.server.address() as { port: number }).port}`;
  try {
    const owner = await peer(url);
    owner.send({
      type: "account.register",
      email: "lock@example.com",
      password: "fixture-password",
      role: "computer",
    });
    const grant = await owner.receive("account.granted");
    owner.send({
      type: "auth",
      role: "daemon",
      token: grant.token,
      machineId: "ghost",
    });
    await owner.receive("auth.ok");
    const secret = JSON.parse(readFileSync(join(home, "relay.json"), "utf8")).relaySecret;
    const legacyDaemon = await peer(url);
    legacyDaemon.send({
      type: "auth",
      role: "daemon",
      machineId: "legacy",
      relaySecret: secret,
    });
    await legacyDaemon.receive("auth.ok");
    legacyDaemon.send({ type: "machine.snapshot", machine: machine("legacy") });
    legacyDaemon.send({ type: "pair.start" });
    const offer = await legacyDaemon.receive("pair.offer");
    const legacyPhone = await peer(url);
    legacyPhone.send({ type: "pair.complete", code: offer.code });
    await legacyPhone.receive("pair.granted");
    await legacyPhone.receive("fleet.snapshot");
    legacyPhone.send({
      type: "session.create",
      route: "direct",
      machineId: "ghost",
      prompt: "should not reach a computer that has not published itself",
      clientMsgId: "ghost-1",
    });
    expect((await legacyPhone.receive("error")).message).toBe(
      "找不到任务所属设备，请刷新任务列表",
    );
    expect(owner.messages.some((m) => m.type === "session.create")).toBe(false);
    owner.send({ type: "machine.snapshot", machine: machine("ghost") });
    await wait(() =>
      legacyPhone.messages.some((m) => m.type === "fleet.snapshot"),
    );
    const seen = legacyPhone.messages.filter((m) => m.type === "fleet.snapshot");
    expect(seen.some((m) => m.machines.some((x) => x.id === "ghost"))).toBe(false);
    legacyPhone.messages.length = 0;
    legacyPhone.send({
      type: "session.create",
      route: "direct",
      machineId: "ghost",
      prompt: "still forbidden after snapshot",
      clientMsgId: "ghost-2",
    });
    expect((await legacyPhone.receive("error")).message).toBe(
      "找不到任务所属设备，请刷新任务列表",
    );
    expect(owner.messages.some((m) => m.type === "session.create")).toBe(false);

    const attacker = await peer(url);
    attacker.send({
      type: "account.magic.start",
      email: "lock@example.com",
      purpose: "login",
    });
    await attacker.receive("account.magic.sent");
    const real = relay.peekMagic("lock@example.com")!;
    expect(real).toMatch(/^\d{6}$/);
    for (let i = 0; i < 5; i++) {
      attacker.send({
        type: "account.magic.complete",
        email: "lock@example.com",
        code: "000000" === real ? "111111" : "000000",
        role: "phone",
      });
      expect((await attacker.receive("error")).message).toBe("验证码无效或已过期");
    }
    now += 120000;
    attacker.send({
      type: "account.magic.start",
      email: "lock@example.com",
      purpose: "login",
    });
    await attacker.receive("account.magic.sent");
    const after = relay.peekMagic("lock@example.com");
    attacker.send({
      type: "account.magic.complete",
      email: "lock@example.com",
      code: after ?? real,
      role: "phone",
    });
    expect((await attacker.receive("error")).message).toBe("验证码无效或已过期");
    attacker.send({
      type: "account.magic.complete",
      email: "lock@example.com",
      code: real,
      role: "phone",
    });
    expect((await attacker.receive("error")).message).toBe("验证码无效或已过期");
    expect(attacker.messages.some((m) => m.type === "account.granted")).toBe(
      false,
    );

    for (let i = 0; i < 5; i++) {
      const bad = await peer(url);
      bad.send({
        type: "account.login",
        email: "lock@example.com",
        password: "wrong-password",
        role: "phone",
      });
      expect((await bad.receive("error")).message).toBe("邮箱或密码不对");
    }
    const still = await peer(url);
    still.send({
      type: "account.login",
      email: "lock@example.com",
      password: "fixture-password",
      role: "phone",
    });
    expect((await still.receive("error")).message).toBe("邮箱或密码不对");
    now += 3600000;
    const later = await peer(url);
    later.send({
      type: "account.login",
      email: "lock@example.com",
      password: "fixture-password",
      role: "phone",
    });
    const unlocked = await later.receive("account.granted");
    expect(unlocked.role).toBe("phone");
  } finally {
    await relay.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);

it("permanently deletes an account, its fleet, tokens, codes and tickets without affecting others", async () => {
  const home = mkdtempSync(join(tmpdir(), "agentdeck-delete-"));
  const relay = await startRelay({ home, port: 0 });
  const url = `wss://127.0.0.1:${(relay.server.address() as { port: number }).port}`;
  const register = async (email: string, role: "phone" | "computer") => {
    const p = await peer(url);
    p.send({type:"account.register",email,password:"fixture-password",role});
    const grant = await p.receive("account.granted");
    p.send(role === "phone" ? {type:"auth",role:"device",token:grant.token} : {type:"auth",role:"daemon",token:grant.token,machineId:email});
    await p.receive("auth.ok");
    return {p, grant};
  };
  try {
    const a = await register("delete@example.com", "computer");
    a.p.send({type:"machine.snapshot",machine:machine("delete@example.com")});
    const phone = await register("delete@example.com", "phone");
    const b = await register("keep@example.com", "computer");
    b.p.send({type:"machine.snapshot",machine:machine("keep@example.com")});
    a.p.send({type:"join.start"});
    const ticket = await a.p.receive("join.offer");
    a.p.send({type:"pair.start"});
    const offer = await a.p.receive("pair.offer");
    const paired = await peer(url);
    paired.send({type:"pair.complete",code:offer.code});
    const pairGrant = await paired.receive("pair.granted");
    paired.send({type:"account.delete"});
    expect((await paired.receive("error")).message).toBe("这个连接没有账号");
    a.p.send({type:"pair.start"});
    const pendingPair = await a.p.receive("pair.offer");
    const magic = await peer(url);
    magic.send({type:"account.magic.start",email:"delete@example.com",purpose:"login"});
    await magic.receive("account.magic.sent");
    const code = relay.peekMagic("delete@example.com")!;
    const daemonClosed = once(a.p.ws, "close");
    const pairedClosed = once(paired.ws, "close");
    phone.p.send({type:"account.delete",confirm:true});
    await phone.p.receive("account.deleted");
    const [status, reason] = await daemonClosed;
    expect(status).toBe(1008);
    expect(reason.toString()).toBe("account deleted");
    await pairedClosed;
    expect(relay.peekMagic("delete@example.com")).toBeUndefined();
    for (const [token, role] of [[phone.grant.token,"device"],[a.grant.token,"daemon"],[pairGrant.token,"device"]] as const) {
      const old = await peer(url);
      old.send(role === "daemon" ? {type:"auth",role,token,machineId:"deleted"} : {type:"auth",role,token});
      expect((await old.receive("error")).message).toBe("invalid credentials");
    }
    const joining = await peer(url);
    joining.send({type:"daemon.join",ticket:ticket.ticket});
    await joining.receive("error");
    const pair = await peer(url);
    pair.send({type:"pair.complete",code:pendingPair.code});
    await pair.receive("error");
    magic.send({type:"account.magic.complete",email:"delete@example.com",code,role:"phone"});
    await magic.receive("error");
    const saved = JSON.parse(readFileSync(join(home,"accounts.json"),"utf8"));
    expect(saved.accounts.map((a: {email:string}) => a.email)).toEqual(["keep@example.com"]);
    expect(saved.tokens.every((t: {accountId:string}) => t.accountId === b.grant.accountId)).toBe(true);
    expect(saved.magic).toEqual([]);
    expect(JSON.parse(readFileSync(join(home,"devices.json"),"utf8"))).toEqual([]);
    expect(JSON.parse(readFileSync(join(home,"fleet.json"),"utf8")).map((m: Machine) => m.id)).toEqual(["keep@example.com"]);
    b.p.send({type:"join.start"});
    await b.p.receive("join.offer");
    const again = await register("delete@example.com","phone");
    expect(again.grant.accountId).not.toBe(phone.grant.accountId);
    const keep = await register("keep@example.com","phone");
    expect(keep.grant.accountId).toBe(b.grant.accountId);
    expect((await keep.p.receive("fleet.snapshot")).machines.map(m => m.id)).toEqual(["keep@example.com"]);
  } finally {
    await relay.close();
    rmSync(home,{recursive:true,force:true});
  }
}, 15000);
