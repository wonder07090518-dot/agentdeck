import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { claude, codex, grok, ollama } from '@agentdeck/adapters';
import type { Session, SessionStatus, EventDraft, EventEnvelope, UserInput } from '@agentdeck/protocol';
import { Store } from './store.js';
import { DelegateDriver } from './driver.js';
import { policy } from './policy.js';
export function uuidv7(){const b=randomBytes(16);b.writeUIntBE(Date.now(),0,6);b[6]=(b[6]&15)|112;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function transition(from:SessionStatus,to:SessionStatus){const allowed:Record<SessionStatus,SessionStatus[]>={pending:['starting','cancelled','failed'],starting:['running','failed','cancelled'],running:['needs_approval','paused','done','failed','cancelled'],needs_approval:['running','paused','failed','cancelled'],paused:['running','failed','cancelled'],done:[],failed:[],cancelled:[]};if(!allowed[from].includes(to))throw Error(`invalid transition ${from} -> ${to}`);}
export class Runtime extends EventEmitter {
 drivers=new Map<string,DelegateDriver>();private remembered=new Map<string,Set<string>>();private waiters=new Map<string,{sessionId:string;resolve:(d:string)=>void;timer:NodeJS.Timeout}>();
 constructor(readonly store:Store){super();}
 event(id:string,d:EventDraft){const e=this.store.append(id,d);this.emit('event',e);return e;}
 status(id:string,to:SessionStatus,reason?:string){const s=this.store.session(id);transition(s.status,to);this.event(id,{type:'session.status',origin:'runtime',payload:{from:s.status,to,reason}});s.status=to;s.seq=this.store.session(id).seq;if(['done','failed','cancelled'].includes(to))s.endedAt=Date.now();this.store.save(s);}
 resolve(id:string,decision:'allow'|'allow_always'|'deny') {const w=this.waiters.get(id);if(!w)throw Error('审批已处理或已过期');this.store.resolve(id,decision);clearTimeout(w.timer);this.waiters.delete(id);this.event(w.sessionId,{type:'approval.resolve',origin:'user',ref:{approvalId:id},payload:{approvalId:id,decision}});w.resolve(decision);}
 private async consume(id:string,e:EventDraft){this.event(id,e);if(e.type==='cost.update'){const s=this.store.session(id);s.cost=e.payload;this.store.save(s);}
 if(e.type!=='tool.call')return;
 let action:'allow'|'ask'|'deny';try{action=policy(e.payload.name,e.payload.input,this.store.session(id).workspace.path);}catch{action='deny';}
 if(action==='ask'&&this.remembered.get(id)?.has(JSON.stringify({name:e.payload.name,input:e.payload.input})))return;if(action==='allow')return;if(action==='deny')throw Error('policy denied tool: '+e.payload.name);
 const approvalId=randomUUID();const approval={approvalId,sessionId:id,kind: /shell|bash/i.test(e.payload.name)?'shell' as const:'spawn' as const,summary:e.payload.name,detail:JSON.stringify(e.payload.input).slice(0,2000),risk:'medium' as const,options:['allow','allow_always','deny'] as ('allow'|'allow_always'|'deny')[],expiresAt:Date.now()+30000};
 this.store.approval(approval);this.status(id,'needs_approval');
 const decision=await new Promise<string>(resolve=>{const timer=setTimeout(()=>this.resolve(approvalId,'deny'),30000);this.waiters.set(approvalId,{sessionId:id,resolve,timer});this.event(id,{type:'approval.request',origin:'runtime',ref:{approvalId},payload:approval});});
 if(decision==='deny')throw Error('审批已拒绝，任务已停止');if(decision==='allow_always'){const rules=this.remembered.get(id)??new Set<string>();rules.add(JSON.stringify({name:e.payload.name,input:e.payload.input}));this.remembered.set(id,rules);}if(this.store.session(id).status==='needs_approval')this.status(id,'running');
 }
 async run(prompt:string,cwd:string,machineId:string,fixture?:string,clientMsgId:string=randomUUID(),agentId:string='claude'){const adapter={claude,codex,grok,ollama}[agentId as 'claude'|'codex'|'grok'|'ollama'];if(!adapter)throw Error('不支持此代理');if(agentId==='grok')throw Error('Grok Bot 尚未实现运行支持（not_implemented）');const id=uuidv7();const s:Session={id,taskId:null,machineId,agentId,workspace:{machineId,path:cwd},mode:'delegate',status:'pending',title:prompt.slice(0,120),startedAt:Date.now(),seq:0};try{s.workspace.gitRoot=execFileSync('git',['-C',cwd,'rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* Plain directories remain usable; never initialize a repository implicitly. */}this.store.save(s);this.event(id,{type:'session.created',origin:'runtime',payload:s});this.status(id,'starting');
 const driver=new DelegateDriver(adapter,s.workspace,prompt,e=>this.consume(id,e),ref=>{this.store.ref(id,ref);},fixture);this.drivers.set(id,driver);
 let status:'done'|'failed'|'cancelled'='done';let reason:string|undefined;
 try{this.status(id,'running');this.event(id,{type:'user.input',origin:'user',payload:{text:prompt,clientMsgId}});await driver.start();if(this.store.session(id).status==='cancelled')status='cancelled';}
 catch(err){status=this.store.session(id).status==='cancelled'?'cancelled':'failed';reason=err instanceof Error?err.message:String(err);this.event(id,{type:'error',origin:'runtime',payload:{code:'RUN_FAILED',message:reason,retriable:false}});}
 finally{await driver.dispose();this.drivers.delete(id);this.remembered.delete(id);for(const [aid,w] of this.waiters)if(w.sessionId===id)this.resolve(aid,'deny');}
 if(this.store.session(id).status!==status)this.status(id,status,reason);this.event(id,{type:'session.ended',origin:'runtime',payload:{status,reason,cost:this.store.session(id).cost||{inputTokens:0,outputTokens:0},summary:status==='done'?'本轮任务已完成':'本轮任务已结束'}});return this.store.session(id);
 }
 async send(id:string,input:UserInput){const d=this.drivers.get(id);if(!d)throw Error('任务已结束，无法追加指令，请新建任务');await d.send(input);this.event(id,{type:'user.input',origin:'user',payload:input});}
 async interject(id:string,input:UserInput){const d=this.drivers.get(id);if(!d)throw Error('任务已结束，无法追加指令，请新建任务');if(this.store.session(id).status==='needs_approval')throw Error('请先处理待审批请求');await d.interject(input);this.event(id,{type:'user.input',origin:'user',payload:input});}
 resolveResult(id:string,decision:'accept'|'reject'){if(this.store.session(id).status!=='done')throw Error('只能审阅已完成任务');if(this.store.events(id).some(e=>e.type==='result.resolve'))throw Error('结果已审阅');this.event(id,{type:'result.resolve',origin:'user',payload:{decision}});}
 async halt(){for(const [id,d] of this.drivers){for(const [aid,w] of this.waiters)if(w.sessionId===id)this.resolve(aid,'deny');if(['running','paused','needs_approval','starting'].includes(this.store.session(id).status))this.status(id,'cancelled');await d.interrupt();}}
}
