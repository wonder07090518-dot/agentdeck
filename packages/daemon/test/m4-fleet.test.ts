import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { WSMessage, type Machine } from '@agentdeck/protocol';
import { startRelay } from '../../relay/dist/index.js';
async function wait(check:()=>boolean){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('message timeout');await new Promise(r=>setTimeout(r,10));}}
async function peer(url:string){
 const ws=new WebSocket(url,{rejectUnauthorized:false});const messages:WSMessage[]=[];
 ws.on('message',data=>messages.push(WSMessage.parse(JSON.parse(data.toString()))));
 ws.on('error',()=>{});await once(ws,'open');
 return {ws,messages,send:(m:WSMessage)=>ws.send(JSON.stringify(m)),async receive<T extends WSMessage['type']>(type:T){await wait(()=>messages.some(m=>m.type===type));return messages.find(m=>m.type===type) as Extract<WSMessage,{type:T}>;}};
}
const machine=(id:string,agent:string):Machine=>({id,name:`host-${id}`,online:true,os:'linux',lastSeen:1,labels:[],agents:[{id:agent,version:'fake',installed:true,dispatchable:true,authenticated:false,quota:{known:false},supports:{jsonOut:true,resume:false,interactive:false,permissions:false}}]});
it('M4 fleet retains offline daemons and routes direct and auto creates to exactly one owner',async()=>{
 const home=mkdtempSync(join(tmpdir(),'agentdeck-m4-'));let relay:Awaited<ReturnType<typeof startRelay>>|undefined;
 try {
  relay=await startRelay({home,port:0});
  const url=`wss://127.0.0.1:${(relay.server.address() as {port:number}).port}`;
  const secret=JSON.parse(readFileSync(join(home,'relay.json'),'utf8')).relaySecret;
  const a=await peer(url),b=await peer(url);
  for(const [p,id,agent] of [[a,'a','claude'],[b,'b','codex']] as const){p.send({type:'auth',role:'daemon',machineId:id,relaySecret:secret});await p.receive('auth.ok');p.send({type:'machine.snapshot',machine:machine(id,agent)});}
  a.send({type:'pair.start'});const offer=await a.receive('pair.offer');
  const device=await peer(url);device.send({type:'pair.complete',code:offer.code});await device.receive('pair.granted');
  await wait(()=>device.messages.some(m=>m.type==='fleet.snapshot'&&m.machines.length===2));
  const fleet=await device.receive('fleet.snapshot');expect(fleet.machines.map(m=>m.id).sort()).toEqual(['a','b']);
  device.send({type:'session.create',route:'direct',machineId:'b',agent:'codex',prompt:'direct',clientMsgId:'direct'});
  const direct=await b.receive('session.create');expect(direct).toMatchObject({machineId:'b',agent:'codex',route:'direct'});
  // A list response is a relay processing barrier, avoiding a timing-only non-delivery assertion.
  device.send({type:'session.list'});await a.receive('session.list');expect(a.messages.some(m=>m.type==='session.create')).toBe(false);
  b.messages.length=0;
  device.send({type:'session.create',route:'auto',prompt:'实现代码',clientMsgId:'auto'});
  const decision=await device.receive('routing.decision');expect(decision.decision).toMatchObject({machineId:'b',agentId:'codex'});expect(decision.decision.reason).toContain('余量未知');
  const auto=await b.receive('session.create');expect(auto).toMatchObject({machineId:'b',agent:'codex',routingDecision:decision.decision});
  device.send({type:'session.list'});await b.receive('session.list');expect(a.messages.some(m=>m.type==='session.create')).toBe(false);
  b.ws.close();await wait(()=>device.messages.some(m=>m.type==='fleet.snapshot'&&m.machines.some(n=>n.id==='b'&&!n.online)));
  const snapshots=device.messages.filter(m=>m.type==='fleet.snapshot');const latest=snapshots[snapshots.length-1];
  expect(latest.machines).toHaveLength(2);expect(latest.machines.find(m=>m.id==='b')?.online).toBe(false);
  expect(JSON.parse(readFileSync(join(home,'fleet.json'),'utf8'))).toEqual(expect.arrayContaining([expect.objectContaining({id:'b',online:false})]));
  device.messages.length=0;
  device.send({type:'session.create',route:'auto',prompt:'实现代码',clientMsgId:'fallback'});
  expect((await device.receive('routing.decision')).decision.machineId).toBe('a');
  expect(await a.receive('session.create')).toMatchObject({machineId:'a',agent:'claude',clientMsgId:'fallback'});
 } finally {await relay?.close();rmSync(home,{recursive:true,force:true});}
},15000);
