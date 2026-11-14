import { localModels } from '@agentdeck/adapters';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { WSMessage, type Machine, type EventEnvelope, type SessionSnapshot } from '@agentdeck/protocol';
import { Runtime } from './runtime.js';
import { probeAuthAndQuota } from './probe.js';
export function registerMachine(runtime:Runtime):Machine {const row=runtime.store.db.prepare('SELECT id FROM machines LIMIT 1').get() as {id:string}|undefined;const machine:Machine={id:row?.id||randomUUID(),name:(process.env.AGENTDECK_MACHINE_NAME||'').trim()||hostname(),os:platform() as Machine['os'],online:true,lastSeen:Date.now(),agents:[],labels:[]};for(const id of ['claude','codex','grok','ollama']){const bin=process.env[`AGENTDECK_${id.toUpperCase()}_BIN`]||id;try{const version=execFileSync(bin,['--version'],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim();const probed=probeAuthAndQuota(id,bin);const models=id==='ollama'?localModels():undefined;machine.agents.push({id,version,authenticated:probed.authenticated,installed:true,dispatchable:id!=='grok'&&(id!=='ollama'||!!models?.length),quota:probed.quota,models,accountHint:probed.accountHint,supports:{jsonOut:id==='claude'||id==='codex',resume:id==='claude',interactive:false,permissions:false}});}catch(err){const missing=!!err&&typeof err==='object'&&'code' in err&&(err as {code?:string}).code==='ENOENT';machine.agents.push({id,version:missing?'未知':'版本探测失败',installed:!missing,dispatchable:!missing&&id!=='grok'&&id!=='ollama',authenticated:false,quota:{known:false},supports:{jsonOut:id==='claude'||id==='codex',resume:id==='claude',interactive:false,permissions:false}});}}runtime.store.machine(machine);return machine;}
export function snapshot(runtime:Runtime,id:string):SessionSnapshot {const session=runtime.store.session(id),events=runtime.store.events(id);return {session,recent:events.slice(-50),pendingApprovals:runtime.store.pending(id),diff:{filesChanged:0,insertions:0,deletions:0,baseRef:'HEAD'},tail:events.filter(e=>e.type==='agent.message').slice(-20).map(e=>e.type==='agent.message'?e.payload.text||'':'').join('\n')};}
export function serve(runtime:Runtime,{port=8787,host='127.0.0.1'}:{port?:number;host?:string}={}) {
 const machine=registerMachine(runtime);const server=new WebSocketServer({host,port});
 server.on('connection',socket=>{
 const send=(m:unknown)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(m));};const subs=new Map<string,number>();
 send({type:'hello',v:1,machineId:machine.id});send({type:'machine.snapshot',machine});
 const onEvent=(event:EventEnvelope)=>{const last=subs.get(event.sessionId);if(last!==undefined&&event.seq>last){send({type:'event',event});subs.set(event.sessionId,event.seq);}};
 runtime.on('event',onEvent);socket.on('close',()=>runtime.off('event',onEvent));
 socket.on('message',async data=>{try{const m=WSMessage.parse(JSON.parse(data.toString()));
 if(m.type==='machine.register'){machine.lastSeen=Date.now();runtime.store.machine(machine);send({type:'machine.snapshot',machine});}
 if(m.type==='session.subscribe'){const s=runtime.store.session(m.sessionId);if(m.since!==undefined&&m.since>s.seq)throw Error('since exceeds lastSeq');if(m.since===undefined||m.since<1){const snap=snapshot(runtime,m.sessionId);subs.set(m.sessionId,snap.session.seq);send({type:'session.snapshot',snapshot:snap});}else{for(const event of runtime.store.events(m.sessionId,m.since))send({type:'event',event});}subs.set(m.sessionId,runtime.store.session(m.sessionId).seq);}
 if(m.type==='session.interject')await runtime.interject(m.sessionId,{text:m.text,clientMsgId:m.clientMsgId});
 if(m.type==='result.resolve')runtime.resolveResult(m.sessionId,m.decision);
 if(m.type==='approval.resolve')runtime.resolve(m.approvalId,m.decision);
 if(m.type==='runtime.halt')await runtime.halt();
 }catch(err){send({type:'error',code:'INVALID_REQUEST',message:err instanceof Error?err.message:String(err)});}});
 });
 return {server,machine,async close(){for(const client of server.clients)client.terminate();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
