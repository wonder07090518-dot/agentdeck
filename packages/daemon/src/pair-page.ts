import { createServer } from "node:http";
import { generatePairSvg } from "@agentdeck/relay";
export interface PairOffer {
  qrText: string;
  code: string;
  expiresAt: number;
}
export interface JoinOffer {
  command: string;
  expiresAt: number;
}
// Public pairing capabilities only: this object never receives a relay secret.
export function createPairPage() {
  let pair: PairOffer | undefined,
    join: JoinOffer | undefined,
    svg = "";
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/state") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          code: pair?.code,
          expiresAt: pair?.expiresAt,
          command: join?.command,
          joinExpiresAt: join?.expiresAt,
        }),
      );
      return;
    }
    if (path === "/qr.svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(svg);
      return;
    }
    if (path !== "/") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentDeck 配对</title><style>body{margin:0;background:#05070b;color:#eef4fb;font:16px system-ui;display:grid;min-height:100vh;place-items:center;background-image:radial-gradient(ellipse at top,#123444,transparent 65%)}main{width:min(88vw,520px);padding:32px 20px;text-align:center}h1{font-size:32px}small,p{color:#93a0b4}.card{background:#0a0e15;border:1px solid #295e73;border-radius:24px;padding:24px}img{width:min(100%,340px);border-radius:16px}strong{display:block;font-size:36px;letter-spacing:10px;color:#5ce1ff;margin:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;color:#5ce1ff;background:#101a24;padding:16px;border-radius:12px;font-size:13px}button{background:#5ce1ff;color:#04121a;border:0;border-radius:10px;padding:12px 24px;cursor:pointer}</style><main><small>◆ AgentDeck</small><h1>连上你的电脑</h1><p>用手机上的 AgentDeck 扫描</p><div class="card"><img id="qr" src="/qr.svg" alt="手机配对二维码"><strong id="code">等待配对码</strong><small id="time"></small></div><p>再加一台电脑 在那台电脑运行</p><pre id="command">正在生成加入命令</pre><small id="joinTime"></small></main><script>let last='';async function refresh(){try{const s=await(await fetch('/state')).json();document.getElementById('code').textContent=s.code||'等待配对码';document.getElementById('time').textContent=s.expiresAt?Math.max(0,Math.ceil((s.expiresAt-Date.now())/1000))+' 秒':'等待电脑准备好';document.getElementById('command').textContent=s.command||'正在生成加入命令';document.getElementById('joinTime').textContent=s.joinExpiresAt?Math.max(0,Math.ceil((s.joinExpiresAt-Date.now())/1000))+' 秒':'';if(last!==s.code){last=s.code;document.getElementById('qr').src='/qr.svg?v='+encodeURIComponent(last)}}catch{document.getElementById('time').textContent='等待电脑重新连接'}}refresh();setInterval(refresh,1000)</script></html>`,
    );
  });
  const ready = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    );
  });
  return {
    ready,
    async setPair(value: PairOffer) {
      const next = await generatePairSvg(value.qrText);
      pair = value;
      svg = next;
    },
    setJoin(value: JoinOffer) {
      join = value;
    },
    async close() {
      await ready.catch(() => {});
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
    },
  };
}
