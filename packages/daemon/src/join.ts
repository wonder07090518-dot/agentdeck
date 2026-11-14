import {
  mkdirSync,
  writeFileSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { WSMessage } from "@agentdeck/protocol";
export function parseJoinLink(link: string, override?: string) {
  const url = new URL(link),
    relayUrl = override ?? url.searchParams.get("relay") ?? "",
    ticket = url.searchParams.get("ticket") ?? "";
  if (
    !(
      (url.protocol === "agentdeck:" && url.hostname === "join") ||
      url.protocol === "https:"
    ) ||
    !relayUrl.startsWith("wss://") ||
    !ticket ||
    ticket.length > 512
  )
    throw Error("invalid join link");
  return { relayUrl, ticket };
}
export async function joinRelay(
  link: string,
  home: string,
  override?: string,
  tlsInsecure = false,
) {
  const { relayUrl, ticket } = parseJoinLink(link, override);
  const credentials = await new Promise<{
    relaySecret?: string; token?: string; accountId?: string;
    relayUrl: string;
  }>((resolve, reject) => {
    const ws = new WebSocket(relayUrl, { rejectUnauthorized: !tlsInsecure });
    const timer = setTimeout(() => finish(Error("join timed out")), 15000);
    let done = false;
    function finish(
      error?: Error,
      value?: { relaySecret?: string; token?: string; accountId?: string; relayUrl: string },
    ) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      if (error) reject(error);
      else resolve(value!);
    }
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "daemon.join", ticket })),
    );
    ws.on("error", () => finish(Error("join connection failed")));
    ws.on("close", () => finish(Error("join connection closed")));
    ws.on("message", (data) => {
      try {
        const m = WSMessage.parse(JSON.parse(data.toString()));
        if (m.type === "daemon.joined") finish(undefined, m);
        else if (m.type === "error")
          finish(Error("invalid or expired join ticket"));
      } catch {
        finish(Error("invalid join response"));
      }
    });
  });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(home, 0o700);
  const file = join(home, credentials.token ? "account.json" : "relay.json"),
    temp = join(home, `.relay-${randomUUID()}.json`);
  try {
    writeFileSync(
      temp,
      JSON.stringify(credentials.token?{accountId:credentials.accountId,token:credentials.token,role:"computer",relayUrl}:{ relaySecret: credentials.relaySecret, relayUrl }),
      { mode: 0o600, flag: "wx" },
    );
    if (process.platform !== "win32") chmodSync(temp, 0o600);
    renameSync(temp, file);
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
  return { relayUrl, secretFile: credentials.token?undefined:file };
}
