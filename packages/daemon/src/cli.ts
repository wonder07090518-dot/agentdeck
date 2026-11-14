#!/usr/bin/env node
import { loginAccount } from './account.js';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { realpathSync, existsSync, readFileSync } from 'node:fs';
import { startRelay } from '@agentdeck/relay';
import { connectRelay } from './relay-client.js';
import { Store } from './store.js';
import { Runtime } from './runtime.js';
import { serve, registerMachine } from './server.js';
import { joinRelay } from './join.js';
const args=process.argv.slice(2);let command=args.shift();
function option(name:string){const i=args.indexOf(name);if(i<0)return undefined;const v=args[i+1];if(!v||v.startsWith('--'))throw Error(`missing ${name}`);args.splice(i,2);return v;}
async function main(){const home=option('--home')||process.env.AGENTDECK_HOME||join(homedir(),'.agentdeck');const cwd=realpathSync(resolve(option('--cwd')||process.cwd()));const fixture=option('--fixture')||process.env.AGENTDECK_CLAUDE_FIXTURE;const agent=option('--agent')||'claude';let relay=option('--relay'),relaySecret=option('--relay-secret');const name=option('--name')||process.env.AGENTDECK_MACHINE_NAME;let token:string|undefined,accountId:string|undefined;const email=option('--email')||process.env.AGENTDECK_EMAIL,password=option('--password')||process.env.AGENTDECK_PASSWORD;const tlsInsecure=args.includes('--tls-insecure');if(tlsInsecure)args.splice(args.indexOf('--tls-insecure'),1);const port=Number(option('--port')||(command==='relay'?8443:8787));const host=option('--host')||'127.0.0.1';if(!['claude','codex','grok'].includes(agent))throw Error('不支持此代理');if(command==='relay'){const service=await startRelay({home,host,port,tlsCert:option('--tls-cert'),tlsKey:option('--tls-key'),publicUrl:option('--public-url')});process.stderr.write(`AgentDeck wss://${host}:${(service.server.address() as {port:number}).port}\n`);process.once('SIGINT',()=>void service.close());process.once('SIGTERM',()=>void service.close());return;}if(command==='join'){if(args.length!==1)throw Error('join requires one link');const joined=await joinRelay(args.shift()!,home,relay,tlsInsecure);relay=joined.relayUrl;relaySecret=joined.secretFile;command='serve';}
 if(command==='login'){if(!email||!password||!relay)throw Error('login requires --email --password --relay');({token,accountId}=await loginAccount(email,password,relay,home,tlsInsecure));process.stderr.write('已登录 正在连接\n');command='serve';}
 if(command==='serve'&&!relaySecret&&existsSync(join(home,'account.json'))){const saved=JSON.parse(readFileSync(join(home,'account.json'),'utf8'));relay??=saved.relayUrl;token??=saved.token;accountId??=saved.accountId;}
 if(command==='serve'&&!token&&!relaySecret&&existsSync(join(home,'relay.json'))){const saved=JSON.parse(readFileSync(join(home,'relay.json'),'utf8'));if(saved.relayUrl){relay??=saved.relayUrl;relaySecret=join(home,'relay.json');}}
 if(command!=='serve'&&command!=='run')throw Error('usage: agentdeck join <link> | serve | run "prompt" [--cwd dir] [--home dir] [--fixture file]');
 const store=new Store(home),runtime=new Runtime(store);
 if(command==='serve'){if(relay&&!relaySecret&&!token)throw Error('--relay-secret required');const service=relay?connectRelay(runtime,{url:relay,secret:relaySecret,token,accountId,name,cwd,fixture,tlsInsecure}):serve(runtime,{port,host});let closing=false;const close=async()=>{if(closing)return;closing=true;await runtime.halt();await service.close();store.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());if('server' in service){const server=service.server as import('ws').WebSocketServer;server.once('listening',()=>process.stderr.write(`AgentDeck ws://${host}:${(server.address() as {port:number}).port}\n`));}return;}
 if(args.length!==1){store.close();throw Error('run requires one prompt');}
 const machine=registerMachine(runtime);runtime.on('event',e=>process.stdout.write(JSON.stringify(e)+'\n'));
 const halt=()=>void runtime.halt();process.once('SIGINT',halt);process.once('SIGTERM',halt);
 try{const s=await runtime.run(args[0],cwd,machine.id,fixture,undefined,agent);process.exitCode=s.status==='done'?0:1;}finally{process.off('SIGINT',halt);process.off('SIGTERM',halt);store.close();}
}
main().catch(err=>{process.stderr.write(String(err)+'\n');process.exitCode=1;});
