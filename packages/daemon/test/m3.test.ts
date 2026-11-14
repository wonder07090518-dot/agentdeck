import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { codex, grok } from '@agentdeck/adapters';
import { WSMessage, type WSMessage as Message } from '@agentdeck/protocol';
import { Runtime, Store, serve } from '../src/index.js';

const fixture = resolve('packages/daemon/test/fixtures/codex-stream.jsonl');
it('dispatches Codex fixtures, stores review decisions, and refuses unsupported Grok', async () => {
  const home=mkdtempSync(join(tmpdir(),'agentdeck-m3-')),store=new Store(home),runtime=new Runtime(store);
  try {
    const session=await runtime.run('修改文件',home,'machine',fixture,'create','codex');
    expect(session.agentId).toBe('codex');expect(session.status).toBe('done');
    expect(store.ref(session.id)).toBe('codex-thread-1');
    expect(store.events(session.id).some(e=>e.type==='file.change')).toBe(true);
    runtime.resolveResult(session.id,'reject');
    expect(store.events(session.id).at(-1)).toMatchObject({type:'result.resolve',payload:{decision:'reject'}});
    expect(()=>runtime.resolveResult(session.id,'accept')).toThrow('已审阅');
    await expect(runtime.run('hi',home,'machine',undefined,'g','grok')).rejects.toThrow('not_implemented');
    expect(()=>grok.buildDelegateRun({prompt:'hi',workspace:{machineId:'m',path:home}})).toThrow('not_implemented');
    const spec=codex.buildDelegateRun({prompt:'hi',workspace:{machineId:'m',path:home}});
    expect(spec.args).toEqual(['exec','--json','--sandbox','workspace-write','--skip-git-repo-check','hi']);
    expect(spec.args).not.toContain('--full-auto');
    expect(()=>codex.resumeArgs('ref')).toThrow();
  } finally {store.close();rmSync(home,{recursive:true,force:true});}
});

it('routes phone approval, interject and result decisions through validated WS commands',async()=>{
  const home=mkdtempSync(join(tmpdir(),'agentdeck-m3-ws-')),store=new Store(home),runtime=new Runtime(store);
  const service=serve(runtime,{port:0});await once(service.server,'listening');
  const socket=new WebSocket(`ws://127.0.0.1:${(service.server.address() as {port:number}).port}`);
  const messages:Message[]=[];socket.on('message',data=>messages.push(WSMessage.parse(JSON.parse(data.toString()))));
  const wait=async(test:()=>boolean)=>{const end=Date.now()+3000;while(!test()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,10));}};
  const send=(message:Message)=>socket.send(JSON.stringify(message));
  let approvalId='';
  runtime.on('event',event=>{if(event.type==='approval.request')approvalId=event.payload.approvalId;});
  try {
    await once(socket,'open');
    const running=runtime.run('fixture',home,service.machine.id,resolve('packages/daemon/test/fixtures/claude-approval.jsonl'));
    // Fixture waits at a real runtime policy approval. No model is called.
    await wait(()=>!!approvalId);
    const session=store.sessions()[0];
    send({type:'approval.resolve',approvalId,decision:'deny'});
    await running;
    expect(store.pending(session.id)).toEqual([]);
    expect(store.session(session.id).status).toBe('failed');
    expect(store.events(session.id).some(e=>e.type==='approval.resolve'&&e.payload.decision==='deny')).toBe(true);
    // An inactive session must report a real error rather than invent input events.
    send({type:'session.interject',sessionId:session.id,text:'改方向',clientMsgId:'i'});
    await wait(()=>messages.some(m=>m.type==='error'));
    const completed=await runtime.run('codex',home,service.machine.id,fixture,'c','codex');
    send({type:'result.resolve',sessionId:completed.id,decision:'accept'});
    await wait(()=>store.events(completed.id).some(e=>e.type==='result.resolve'));
    expect(store.events(completed.id).at(-1)).toMatchObject({payload:{decision:'accept'}});
    let requests=0;
    const allow=(event:import('@agentdeck/protocol').EventEnvelope)=>{
      if(event.type==='approval.request'){
        requests++;
        send({type:'approval.resolve',approvalId:event.payload.approvalId,decision:'allow_always'});
      }
    };
    runtime.on('event',allow);
    const remembered=await runtime.run('remember',home,service.machine.id,resolve('packages/daemon/test/fixtures/claude-remember.jsonl'));
    runtime.off('event',allow);
    expect(remembered.status).toBe('done');expect(requests).toBe(1);
    expect(store.events(remembered.id).filter(e=>e.type==='tool.call')).toHaveLength(2);
  } finally {socket.terminate();await runtime.halt();await service.close();store.close();rmSync(home,{recursive:true,force:true});}
});


it('phone interject restarts a fake Claude process with its real resume reference',async()=>{
  if(process.platform==='win32')return;
  const home=mkdtempSync(join(tmpdir(),'agentdeck-m3-interject-'));
  const script=join(home,'claude.cjs'),log=join(home,'args.jsonl');
  writeFileSync(script,`#!${process.execPath}
const fs=require('node:fs');
if(process.argv.includes('--version')){console.log('fixture 1');process.exit(0);}
if(process.argv.includes('auth')||process.argv.includes('login')){console.log(JSON.stringify({loggedIn:true,subscriptionType:'pro'}));process.exit(0);}
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');
console.log(JSON.stringify({type:'system',subtype:'init',session_id:'real-fixture-reference'}));
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'working'}]}}));
setInterval(()=>{},1000);
`,{mode:0o700});
  const previous=process.env.AGENTDECK_CLAUDE_BIN;
  process.env.AGENTDECK_CLAUDE_BIN=script;
  const store=new Store(home),runtime=new Runtime(store),service=serve(runtime,{port:0});
  await once(service.server,'listening');
  const socket=new WebSocket(`ws://127.0.0.1:${(service.server.address() as {port:number}).port}`);
  const wait=async(test:()=>boolean)=>{const end=Date.now()+3000;while(!test()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,10));}};
  let running:Promise<unknown>|undefined;
  try {
    await once(socket,'open');running=runtime.run('first',home,service.machine.id);
    await wait(()=>store.sessions().some(s=>store.events(s.id).some(e=>e.type==='agent.message')));
    const session=store.sessions()[0];
    socket.send(JSON.stringify({type:'session.interject',sessionId:session.id,text:'new direction',clientMsgId:'interject-1'}));
    await wait(()=>readFileSync(log,'utf8').trim().split('\n').length===2);
    const args=JSON.parse(readFileSync(log,'utf8').trim().split('\n')[1]) as string[];
    expect(args.slice(-3)).toEqual(['--resume','real-fixture-reference','new direction']);
    expect(store.events(session.id).some(e=>e.type==='user.input'&&e.payload.clientMsgId==='interject-1')).toBe(true);
  } finally {
    socket.terminate();await runtime.halt();await running;await service.close();store.close();
    if(previous===undefined)delete process.env.AGENTDECK_CLAUDE_BIN;else process.env.AGENTDECK_CLAUDE_BIN=previous;
    rmSync(home,{recursive:true,force:true});
  }
});
