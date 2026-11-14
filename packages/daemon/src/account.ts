import { WebSocket } from "ws";
import { WSMessage } from "@agentdeck/protocol";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
export async function loginAccount(
  email: string,
  password: string,
  relayUrl: string,
  home: string,
  tlsInsecure = false,
) {
  if (!relayUrl.startsWith("wss://")) throw Error("relay requires wss://");
  const value = await new Promise<{ accountId: string; token: string }>(
    (resolve, reject) => {
      const ws = new WebSocket(relayUrl, { rejectUnauthorized: !tlsInsecure });
      let done = false,
        registered = false;
      const finish = (
        err?: Error,
        value?: { accountId: string; token: string },
      ) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ws.close();
        err ? reject(err) : resolve(value!);
      };
      const timer = setTimeout(() => finish(Error("登录超时")), 15000);
      const send = (type: string) =>
        ws.send(JSON.stringify({ type, email, password, role: "computer" }));
      ws.on("open", () => send("account.login"));
      ws.on("error", () => finish(Error("登录连接失败")));
      ws.on("close", () => finish(Error("登录连接已关闭")));
      ws.on("message", (raw) => {
        const m = WSMessage.safeParse(JSON.parse(raw.toString()));
        if (!m.success) return;
        if (m.data.type === "account.granted") finish(undefined, m.data);
        else if (m.data.type === "error") {
          if (!registered && m.data.message === "邮箱或密码不对") {
            registered = true;
            send("account.register");
          } else finish(Error("邮箱或密码不对"));
        }
      });
    },
  );
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, "account.json");
  writeFileSync(
    file,
    JSON.stringify({ ...value, relayUrl, role: "computer" }),
    { mode: 0o600 },
  );
  if (process.platform !== "win32") chmodSync(file, 0o600);
  return value;
}
