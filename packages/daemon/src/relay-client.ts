import { readFileSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { WSMessage, type EventEnvelope } from '@agentdeck/protocol';
import { generatePairQr } from '@agentdeck/relay';
import { createPairPage } from './pair-page.js';
import { Runtime } from './runtime.js';
import { registerMachine, snapshot } from './server.js';
export interface RelayClientOptions {url:string;secret?:string;token?:string;accountId?:string;name?:string;cwd:string;fixture?:string;tlsInsecure?:boolean}
export function connectRelay(runtime:Runtime,options:RelayClientOptions){
 if(!options.url.startsWith('wss://'))throw Error('relay requires wss://');
 const secret=options.secret?(existsSync(options.secret)?JSON.parse(readFileSync(options.secret,'utf8')).relaySecret:options.secret):undefined;
 if(!options.token&&(typeof secret!=='string'||!secret))throw Error('invalid relay secret');
 const page=createPairPage();void page.ready.then(port=>!options.token&&process.stderr.write(`配对页 http://127.0.0.1:${port}/\n`)).catch(()=>!options.token&&process.stderr.write('本地配对页不可用 可扫描终端二维码\n'));
 let pairTimer:NodeJS.Timeout|undefined,joinTimer:NodeJS.Timeout|undefined;
 const machine=registerMachine(runtime);if(options.accountId)machine.id=`${options.accountId}:${machine.id}`;if(options.name)machine.name=options.name;
 const machineSessions=()=>runtime.store.sessions().filter(s=>s.machineId===machine.id);let socket:WebSocket|undefined,closed=false,timer:NodeJS.Timeout|undefined;const subs=new Map<string,number>();
 const send=(m:unknown)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(m));};
 const onEvent=(event:EventEnvelope)=>{if(event.type==='session.status'||event.type==='session.ended')send({type:'session.list.result',sessions:machineSessions().map(s=>s.id===event.sessionId&&event.type==='session.status'?{...s,status:event.payload.to}:s)});const last=subs.get(event.sessionId);if(last!==undefined&&event.seq>last){send({type:'event',event});subs.set(event.sessionId,event.seq);}};runtime.on('event',onEvent);
 const connect=()=>{if(closed)return;subs.clear();const ws=new WebSocket(options.url,{rejectUnauthorized:!options.tlsInsecure});socket=ws;
 ws.on('open',()=>send({type:'auth',role:'daemon',machineId:machine.id,...(options.token?{token:options.token}:{relaySecret:secret})}));ws.on('error',()=>{});ws.on('close',()=>{if(!closed)timer=setTimeout(connect,500);});
 ws.on('message',async data=>{if(closed||socket!==ws)return;try{const m=WSMessage.parse(JSON.parse(data.toString()));
 if(m.type==='account.magic.code')process.stderr.write(`这台手机正在登录 验证码是 ${m.code}\n`);
 else if(m.type==='auth.ok'){send({type:'pair.start'});send({type:'join.start'});}
 else if(m.type==='join.offer'){page.setJoin(m);if(!options.token)process.stderr.write(`再加一台电脑，在那台电脑运行：\n  ${m.command}\n`);clearTimeout(joinTimer);joinTimer=setTimeout(()=>send({type:'join.start'}),Math.max(1000,m.expiresAt-Date.now()-10000));}
 else if(m.type==='pair.offer'){await page.setPair(m);if(closed)return;clearTimeout(pairTimer);pairTimer=setTimeout(()=>send({type:'pair.start'}),Math.max(1000,m.expiresAt-Date.now()-10000));if(!options.token)process.stderr.write(`配对码 ${m.code} 有效期至 ${new Date(m.expiresAt).toISOString()}\n${await generatePairQr(m.qrText)}\n`);}
 else if(m.type==='session.list')send({type:'session.list.result',sessions:machineSessions()});
 else if(m.type==='machine.register'){machine.lastSeen=Date.now();send({type:'machine.snapshot',machine});send({type:'session.list.result',sessions:machineSessions()});}
 else if(m.type==='session.create'){
 if(m.agent==='grok')throw Error('Grok Bot 尚未实现运行支持');
 if(!options.fixture&&!machine.agents.some(a=>a.id===(m.agent??'claude')&&a.installed!==false&&a.dispatchable!==false))throw Error('此电脑未检测到所选代理，请先安装 CLI');
 let id:string|undefined;const created=(event:EventEnvelope)=>{if(event.type==='session.created')id=event.sessionId;};runtime.on('event',created);
 // run persists the session synchronously before its first await.
 const running=runtime.run(m.prompt,m.cwd??options.cwd,machine.id,options.fixture,m.clientMsgId,m.agent);runtime.off('event',created);
 void running.catch(()=>send({type:'error',code:'RUN_FAILED',message:'session failed'}));if(!id)throw Error('session creation failed');if(m.routingDecision)runtime.event(id,{type:'routing.decision',origin:'runtime',payload:m.routingDecision});send({type:'session.accepted',session:runtime.store.session(id)});
 }
 else if(m.type==='session.subscribe'){const s=runtime.store.session(m.sessionId);if(s.machineId!==machine.id)throw Error('session identity mismatch');if(m.since!==undefined&&m.since>s.seq)throw Error('since exceeds lastSeq');if(!m.since){const snap=snapshot(runtime,m.sessionId);subs.set(m.sessionId,snap.session.seq);send({type:'session.snapshot',snapshot:snap});}else for(const event of runtime.store.events(m.sessionId,m.since))send({type:'event',event});subs.set(m.sessionId,runtime.store.session(m.sessionId).seq);}
 else if(m.type==='session.send')await runtime.send(m.sessionId,{text:m.text,clientMsgId:m.clientMsgId});
 else if(m.type==='session.interject')await runtime.interject(m.sessionId,{text:m.text,clientMsgId:m.clientMsgId});
 else if(m.type==='result.resolve')runtime.resolveResult(m.sessionId,m.decision);
 else if(m.type==='approval.resolve')runtime.resolve(m.approvalId,m.decision);
 else if(m.type==='runtime.halt')await runtime.halt();
 }catch(err){send({type:'error',code:'INVALID_REQUEST',message:err instanceof Error?err.message:'请求失败'});}});
 };const heartbeat=setInterval(()=>{machine.lastSeen=Date.now();send({type:'machine.snapshot',machine});},10000);connect();return {machine,async close(){closed=true;clearTimeout(pairTimer);clearTimeout(joinTimer);clearInterval(heartbeat);if(timer)clearTimeout(timer);runtime.off('event',onEvent);socket?.terminate();await page.close();}};
}
