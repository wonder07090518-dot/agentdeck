import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { SessionMode, UserInput, EventDraft, Workspace } from '@agentdeck/protocol';
import type { AgentAdapter } from '@agentdeck/adapters';
export interface SessionDriver {readonly kind:SessionMode;start():Promise<void>;send(input:UserInput):Promise<void>;interject(input:UserInput):Promise<void>;interrupt():Promise<void>;dispose():Promise<void>}
export class DelegateDriver implements SessionDriver {
 readonly kind='delegate';private child?:ChildProcess;private queue:string[]=[];private active?:Promise<void>;private stopped=false;private replacement?:string;private ref?:string;
 constructor(private adapter:AgentAdapter,private workspace:Workspace,private prompt:string,private emit:(e:EventDraft)=>void|Promise<void>,private onRef:(ref:string)=>void,private fixture?:string){}
 start(){if(this.active)throw Error('already started');this.active=this.loop();return this.active;}
 async send(i:UserInput){if(this.adapter.id!=='claude')throw Error('此代理暂不支持续跑，请新建任务');if(this.stopped)throw Error('任务已停止');this.queue.push(i.text);}
 async interject(i:UserInput){if(this.adapter.id!=='claude')throw Error('此代理暂不支持插话续跑');if(!this.ref)throw Error('尚未获得代理会话 ID，请稍后再试');this.replacement=i.text;await this.kill();}
 async interrupt(){this.stopped=true;this.queue=[];await this.kill();}
 async dispose(){await this.interrupt();await this.active?.catch(()=>{});}
 private async kill(){const child=this.child;if(!child?.pid)return;const pid=child.pid;try{process.kill(-pid,'SIGINT');}catch{}
 // Kill the process group even if the parent exits before its descendants.
 await new Promise(r=>setTimeout(r,100));try{process.kill(-pid,'SIGKILL');}catch{}
 }
 private async line(line:string){const p=this.adapter.parse(line);if(p.sessionRef){this.ref=p.sessionRef;this.onRef(p.sessionRef);}for(const e of p.events)await this.emit(e);if(p.result)this.result=p.result;}
 private result?:{ok:boolean;reason?:string};
 private async turn(prompt:string){this.result=undefined;
 if(this.fixture){for(const line of (await readFile(this.fixture,'utf8')).split(/\r?\n/)){if(this.stopped||this.replacement)break;if(line.trim())await this.line(line);}return;}
 const spec=this.adapter.buildDelegateRun({prompt,workspace:this.workspace,sessionRef:this.ref});
 const child=spawn(spec.cmd,spec.args,{cwd:spec.cwd,env:spec.env,detached:true,stdio:['ignore','pipe','pipe']});this.child=child;
 let stderr='';child.stderr!.on('data',b=>{stderr=(stderr+b.toString()).slice(-8192);});
 const exited=new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1));});
 // Attach rejection handling before consuming stdout.
 void exited.catch(()=>{});
 try{for await(const line of createInterface({input:child.stdout!})){if(line.trim())await this.line(line);}const code=await exited;
 if(!this.stopped&&!this.replacement){const exit=this.adapter.mapExit(code,stderr);if(!exit.ok)throw Error(exit.reason);}
 }finally{await this.kill();this.child=undefined;}
 }
 private async loop(){let prompt=this.prompt;while(!this.stopped){await this.turn(prompt);if(this.replacement){prompt=this.replacement;this.replacement=undefined;continue;}if(this.stopped)break;if(!this.result)throw Error('代理退出但未返回完成事件');if(!this.result.ok)throw Error(this.result.reason||'代理执行失败');const next=this.queue.shift();if(next===undefined)break;if(!this.ref)throw Error('尚未获得代理会话 ID，请稍后再试');prompt=next;}}
}
export class AttachDriver implements SessionDriver {readonly kind='attach';async start():Promise<void>{throw Error('not_implemented');}async send(_i:UserInput):Promise<void>{throw Error('not_implemented');}async interject(_i:UserInput):Promise<void>{throw Error('not_implemented');}async interrupt(){}async dispose(){}}
