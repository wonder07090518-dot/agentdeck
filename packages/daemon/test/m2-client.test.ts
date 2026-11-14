import {it,expect,vi,afterEach} from 'vitest';
import {Client,credentials} from '../../../apps/mobile/src/client.js';
import {WSMessage,type EventEnvelope,type SessionSnapshot} from '@agentdeck/protocol';
class Socket {
 static OPEN=1;static sockets:Socket[]=[];readyState=0;sent:WSMessage[]=[];
 onopen?:()=>void;onclose?:((e:{code:number})=>void)|null;onmessage?:(e:{data:string})=>void;onerror?:()=>void;
 constructor(public url:string){Socket.sockets.push(this);}
 open(){this.readyState=1;this.onopen?.();}send(text:string){this.sent.push(WSMessage.parse(JSON.parse(text)));}
 receive(message:WSMessage){this.onmessage?.({data:JSON.stringify(message)});}close(){this.readyState=3;}drop(code=1006){this.readyState=3;this.onclose?.({code});}
}
const event=(seq:number):EventEnvelope=>({v:1,sessionId:'session',seq,ts:seq,type:'agent.message',origin:'agent',payload:{text:`chunk ${seq}`}});
function snapshot(seq:number):SessionSnapshot{return {session:{id:'00000000-0000-4000-8000-000000000001',taskId:null,machineId:'m',agentId:'claude',workspace:{machineId:'m',path:'/tmp'},mode:'delegate',status:'running',title:'测试',startedAt:1,seq},recent:Array.from({length:seq},(_,i)=>({...event(i+1),sessionId:'00000000-0000-4000-8000-000000000001'})),pendingApprovals:[],diff:{filesChanged:0,insertions:0,deletions:0,baseRef:'HEAD'},tail:''};}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();Socket.sockets=[];});
it('mobile reconnect authenticates, replays from last seq and deduplicates live events',()=>{
 vi.useFakeTimers();vi.stubGlobal('WebSocket',Socket);const c=new Client('wss://relay');const got:number[]=[];c.onEvent=e=>got.push(e.seq);c.auth('device-token');const first=Socket.sockets[0];first.open();expect(first.sent[0]).toEqual({type:'auth',role:'device',token:'device-token'});first.receive({type:'auth.ok',role:'device',machineId:'m'});c.subscribe({sessionId:'session'});first.receive({type:'event',event:event(1)});first.receive({type:'event',event:event(1)});first.drop();vi.advanceTimersByTime(500);const second=Socket.sockets[1];second.open();second.receive({type:'auth.ok',role:'device',machineId:'m'});expect(second.sent).toContainEqual({type:'session.subscribe',sessionId:'session',since:1});for(const seq of [1,2,2,3])second.receive({type:'event',event:event(seq)});expect(got).toEqual([1,2,3]);c.sendText('session','继续');expect(second.sent.at(-1)).toMatchObject({type:'session.send',text:'继续'});c.close();vi.advanceTimersByTime(30000);expect(Socket.sockets.length).toBe(2);
});
it('mobile requests a snapshot on gaps, then resumes contiguous live events and saves pairing credentials',()=>{
 vi.stubGlobal('WebSocket',Socket);const storage=new Map<string,string>();vi.stubGlobal('window',{localStorage:{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});const c=new Client('wss://relay'),id=snapshot(1).session.id;let view:number[]=[];c.onSnapshot=s=>view=s.recent.map(e=>e.seq);c.onEvent=e=>view.push(e.seq);c.pair('123456');const ws=Socket.sockets[0];ws.open();expect(ws.sent[0]).toEqual({type:'pair.complete',code:'123456'});ws.receive({type:'pair.granted',token:'saved-token',deviceId:'d',machineId:'m'});expect(credentials()).toEqual({relayUrl:'wss://relay',token:'saved-token'});c.subscribe({sessionId:id});ws.receive({type:'session.snapshot',snapshot:snapshot(1)});ws.receive({type:'event',event:{...event(3),sessionId:id}});expect(ws.sent.at(-1)).toEqual({type:'session.subscribe',sessionId:id});expect(view).toEqual([1]);ws.receive({type:'session.snapshot',snapshot:snapshot(3)});for(const seq of [3,4,4])ws.receive({type:'event',event:{...event(seq),sessionId:id}});expect(view).toEqual([1,2,3,4]);let unauthorized=false;c.onUnauthorized=()=>unauthorized=true;ws.drop(1008);expect(unauthorized).toBe(true);expect(credentials()).toBeUndefined();c.close();
});

it('mobile sends schema-backed controls and receives honest machine state',()=>{
 vi.stubGlobal('WebSocket',Socket);
 const c=new Client('wss://relay');let offline=false;let authenticated:boolean|undefined;
 c.onMachine=m=>authenticated=m.agents[0]?.authenticated;c.onMachineOffline=()=>offline=true;
 c.auth('token');const ws=Socket.sockets[0];ws.open();ws.receive({type:'auth.ok',role:'device',machineId:'m'});
 expect(ws.sent).toContainEqual({type:'machine.register'});
 ws.receive({type:'machine.snapshot',machine:{id:'m',name:'电脑',os:'linux',online:true,lastSeen:1,labels:[],agents:[{id:'codex',version:'1',authenticated:false,supports:{jsonOut:true,resume:false,interactive:false,permissions:false}}]}});
 expect(authenticated).toBe(false);
 c.create('任务',{route:'direct',machineId:'m',agent:'codex',cwd:'/work'});expect(ws.sent.at(-1)).toMatchObject({type:'session.create',route:'direct',machineId:'m',agent:'codex',cwd:'/work'});
 c.create('自动任务',{route:'auto'});expect(ws.sent.at(-1)).toMatchObject({type:'session.create',route:'auto'});expect(ws.sent.at(-1)).not.toHaveProperty('machineId');expect(ws.sent.at(-1)).not.toHaveProperty('agent');
 c.approve('approval','allow_always');expect(ws.sent.at(-1)).toEqual({type:'approval.resolve',approvalId:'approval',decision:'allow_always'});
 c.interject('session','改方向');expect(ws.sent.at(-1)).toMatchObject({type:'session.interject',text:'改方向'});
 c.result('session','reject');expect(ws.sent.at(-1)).toEqual({type:'result.resolve',sessionId:'session',decision:'reject'});
 ws.receive({type:'error',code:'MACHINE_OFFLINE',message:'电脑离线'});expect(offline).toBe(true);
 c.close();
});

it('mobile handles fleet updates and routing decisions as messages and replayed events',()=>{
 vi.stubGlobal('WebSocket',Socket);const c=new Client('wss://relay');
 const fleet=vi.fn(),decision=vi.fn(),events=vi.fn();c.onFleet=fleet;c.onRoutingDecision=decision;c.onEvent=events;
 c.auth('token');const ws=Socket.sockets[0];ws.open();ws.receive({type:'auth.ok',role:'device',machineId:'m'});
 const m={id:'m',name:'电脑',os:'linux' as const,online:true,lastSeen:1,labels:[],agents:[]};
 ws.receive({type:'fleet.snapshot',machines:[m]});ws.receive({type:'fleet.snapshot',machines:[{...m,online:false}]});
 expect(fleet.mock.calls.map(call=>call[0][0].online)).toEqual([true,false]);
 const d={machineId:'m',machineName:'电脑',agentId:'codex',rule:'code',reason:'代码任务，余量未知',candidates:[]};
 ws.receive({type:'routing.decision',decision:d});expect(decision).toHaveBeenCalledWith(d);
 c.subscribe({sessionId:'session'});ws.receive({type:'event',event:{v:1,sessionId:'session',seq:1,ts:1,origin:'runtime',type:'routing.decision',payload:d}});
 expect(events.mock.calls[0][0].payload).toEqual(d);c.close();
});
