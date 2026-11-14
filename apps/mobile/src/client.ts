import { WSMessage, type EventEnvelope, type SessionSnapshot, type Session, type Machine, type RoutingDecision } from '@agentdeck/protocol';
type Credentials={token:string;relayUrl:string};
let memory:Credentials|undefined;
export function credentials():Credentials|undefined{try{const raw=typeof window!=='undefined'?window.localStorage.getItem('agentdeck'):null;return raw?JSON.parse(raw):memory;}catch{return memory;}}
export interface CredentialStore {save(value:Credentials):Promise<void>;clear():Promise<void>}
let nativeStore:CredentialStore|undefined;
export function configureStorage(store:CredentialStore){nativeStore=store;}
async function save(value:Credentials,onFailure?:(message:string)=>void){memory=value;if(nativeStore){await nativeStore.save(value).catch(()=>onFailure?.('无法保存设备令牌，请检查设备安全存储；下次启动需重新配对'));return;}try{if(typeof window!=='undefined')window.localStorage.setItem('agentdeck',JSON.stringify(value));}catch{}}
export function initialPair(){let relay=credentials()?.relayUrl??'',code='';try{if(typeof window!=='undefined'){const q=new URL(window.location.href).searchParams;relay=q.get('relay')??relay;code=q.get('code')??'';}}catch{}return {relay,code};}
export class Client {
 private ws?:WebSocket;private token?:string;private stopped=false;private attempt=0;private timer?:ReturnType<typeof setTimeout>;private pairing?:string;
 private accountRequest?:WSMessage;
 private openSession?:string;private lastSeq=0;private recovering=false;private pending=new Map<number,EventEnvelope>();private events=new Map<number,EventEnvelope>();
 onAccount?:(signedIn:boolean)=>void;onAccountDeleted?:()=>void;
 onMagicSent?:(via:'desktop'|'smtp')=>void;
 onFleet?:(machines:Machine[])=>void;onRoutingDecision?:(decision:RoutingDecision)=>void;onMachineOffline?:()=>void;onMachine?:(machine:Machine)=>void;onEvent?:(event:EventEnvelope)=>void;onSnapshot?:(snapshot:SessionSnapshot)=>void;onSessions?:(sessions:Session[])=>void;onAccepted?:(session:Session)=>void;onConnection?:(ready:boolean)=>void;onError?:(message:string)=>void;onReady?:()=>void;onUnauthorized?:()=>void;
 constructor(public relayUrl:string){}
 magicStart(email:string){this.accountRequest={type:'account.magic.start',email,purpose:'login'};this.connect();}
 magicComplete(email:string,code:string){this.accountRequest={type:'account.magic.complete',email,code,role:'phone'};this.connect();}
 register(email:string,password:string){this.accountRequest={type:'account.register',email,password,role:'phone'};this.connect();}
 login(email:string,password:string){this.accountRequest={type:'account.login',email,password,role:'phone'};this.connect();}
 async logout(){this.close();this.token=undefined;memory=undefined;await nativeStore?.clear();try{if(typeof window!=='undefined')window.localStorage.removeItem('agentdeck');}catch{}}
 pair(code:string){if(!/^\d{6}$/.test(code))throw Error('请输入六位配对码');this.pairing=code;this.token=undefined;this.connect();}
 auth(token:string){this.token=token;this.pairing=undefined;this.connect();}
 private connect(){if(!this.relayUrl.startsWith('wss://'))throw Error('中转地址必须使用 wss://');this.stopped=false;if(this.timer)clearTimeout(this.timer);if(this.ws){this.ws.onclose=null;this.ws.close();}this.onConnection?.(false);const ws=new WebSocket(this.relayUrl);this.ws=ws;
 ws.onopen=()=>{const request=this.accountRequest;this.accountRequest=undefined;this.send(request??(this.token?{type:'auth',role:'device',token:this.token}:{type:'pair.complete',code:this.pairing??''}));};
 ws.onmessage=async e=>{if(this.ws!==ws)return;let raw:unknown;try{raw=JSON.parse(String(e.data));}catch{return;}const parsed=WSMessage.safeParse(raw);if(!parsed.success)return;const m=parsed.data;
 if(m.type==='account.granted'){this.token=m.token;await save({token:m.token,relayUrl:this.relayUrl},this.onError);if(this.ws!==ws||this.stopped)return;this.send({type:'auth',role:'device',token:m.token});}
 else if(m.type==='pair.granted'){this.token=m.token;this.pairing=undefined;save({token:m.token,relayUrl:this.relayUrl},this.onError);this.ready();}
 else if(m.type==='account.magic.sent')this.onMagicSent?.(m.via);
 else if(m.type==='auth.ok'){this.onAccount?.(!!m.accountId);this.ready();}
 else if(m.type==='account.deleted'){try{await this.logout();}catch{this.onError?.('令牌没清掉 去系统设置里清除应用数据');}this.onAccount?.(false);this.onAccountDeleted?.();}
 else if(m.type==='error'){if(m.code==='MACHINE_OFFLINE'){this.onMachineOffline?.();}this.onError?.(m.message);}
 else if(m.type==='fleet.snapshot')this.onFleet?.(m.machines);
 else if(m.type==='routing.decision')this.onRoutingDecision?.(m.decision);
 else if(m.type==='machine.snapshot')this.onMachine?.(m.machine);
 else if(m.type==='session.list.result')this.onSessions?.(m.sessions);
 else if(m.type==='session.accepted')this.onAccepted?.(m.session);
 else if(m.type==='session.snapshot'&&m.snapshot.session.id===this.openSession){this.events.clear();this.pending.clear();this.lastSeq=m.snapshot.session.seq;for(const event of m.snapshot.recent)this.events.set(event.seq,event);this.recovering=false;this.onSnapshot?.(m.snapshot);this.flush();}
 else if(m.type==='event'&&m.event.sessionId===this.openSession)this.merge(m.event);
 };
 ws.onclose=event=>{if(this.ws!==ws)return;this.onConnection?.(false);if(event.code===1008){this.token=undefined;memory=undefined;void nativeStore?.clear().catch(()=>this.onError?.('无法清除设备令牌，请在设置中清除应用数据'));try{if(typeof window!=='undefined')window.localStorage.removeItem('agentdeck');}catch{}this.onUnauthorized?.();this.onError?.('配对已失效，请重新连接');return;}if(!this.stopped&&this.token)this.timer=setTimeout(()=>this.connect(),Math.min(15000,500*2**this.attempt++));};ws.onerror=()=>this.onError?.('连接失败，请检查中转地址与 TLS 证书');
 }
 private ready(){this.attempt=0;this.onConnection?.(true);this.onReady?.();this.list();this.send({type:'machine.register'});if(this.openSession)this.subscribe({sessionId:this.openSession,...(this.lastSeq>=1?{since:this.lastSeq}:{})});}
 private merge(event:EventEnvelope){if(!this.openSession)return;if(event.seq<=this.lastSeq)return;if(this.recovering){this.pending.set(event.seq,event);return;}if(event.seq!==this.lastSeq+1){this.pending.set(event.seq,event);this.recovering=true;this.send({type:'session.subscribe',sessionId:this.openSession});return;}this.events.set(event.seq,event);this.lastSeq=event.seq;this.onEvent?.(event);this.flush();}
 private flush(){for(const seq of [...this.pending.keys()])if(seq<=this.lastSeq)this.pending.delete(seq);while(this.openSession){const next=this.pending.get(this.lastSeq+1);if(!next)break;this.pending.delete(next.seq);this.events.set(next.seq,next);this.lastSeq=next.seq;this.onEvent?.(next);}}
 private send(message:WSMessage){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(message));else throw Error('连接尚未就绪');}
 deleteAccount(){this.send({type:'account.delete',confirm:true});}
 list(){this.send({type:'session.list'});}
 create(prompt:string,options:{route:'direct'|'auto';agent?:'claude'|'codex'|'grok'|'ollama';machineId?:string;cwd?:string}){this.send({type:'session.create',prompt,...options,clientMsgId:this.id()});}
 subscribe(options:{sessionId:string;since?:number}){if(options.sessionId!==this.openSession){this.openSession=options.sessionId;this.lastSeq=0;this.events.clear();this.pending.clear();}this.recovering=false;this.send({type:'session.subscribe',...options});}
 sendText(sessionId:string,text:string){this.send({type:'session.send',sessionId,text,clientMsgId:this.id()});}
 interject(sessionId:string,text:string){this.send({type:'session.interject',sessionId,text,clientMsgId:this.id()});}
 approve(approvalId:string,decision:'allow'|'allow_always'|'deny'){this.send({type:'approval.resolve',approvalId,decision});}
 result(sessionId:string,decision:'accept'|'reject'){this.send({type:'result.resolve',sessionId,decision});}
 refresh(){if(this.token)this.auth(this.token);}
 halt(){this.send({type:'runtime.halt'});}
 private id(){return `${Date.now()}-${Math.random().toString(36).slice(2)}`;}
 close(){this.stopped=true;if(this.timer)clearTimeout(this.timer);if(this.ws)this.ws.onclose=null;this.ws?.close();}
}
