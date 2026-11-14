import type { EventDraft } from '@agentdeck/protocol';
import { detectBinary, type AgentAdapter } from './index.js';
export function redact(text:string):string {return text.replace(/(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|authorization|token|password)\s*[:=]\s*[^\s,}]+)/gi,'[REDACTED]');}
export const claude:AgentAdapter={
 id:'claude',detect:()=>detectBinary('claude',process.env.AGENTDECK_CLAUDE_BIN||'claude'),
 buildDelegateRun:r=>({cmd:process.env.AGENTDECK_CLAUDE_BIN||'claude',args:['-p','--verbose','--output-format','stream-json','--permission-mode','acceptEdits','--permission-prompts','none',...(r.sessionRef?['--resume',r.sessionRef]:[]),r.prompt],cwd:r.workspace.path,env:process.env,stdin:'closed',parseMode:'jsonl'}),
 buildAttachRun:()=>{throw new Error('not_implemented');},resumeArgs:id=>['--resume',id],
 mapExit:(code,stderr)=>({ok:code===0,...(code?{reason:redact(stderr)||`exit ${code}`}:{})}),
 parse(line){
 const events:EventDraft[]=[];
 try {
 const o=JSON.parse(line);const sessionRef=typeof o.session_id==='string'?o.session_id:undefined;
 if(o.type==='system'&&o.subtype==='init')return {events,sessionRef};
 if(o.type==='assistant'||o.type==='user') {
 for(const c of o.message?.content||[]) {
 if(c.type==='text')events.push({type:'agent.message',origin:'agent',payload:{text:redact(c.text),final:true}});
 if(c.type==='tool_use')events.push({type:'tool.call',origin:'agent',ref:{toolCallId:c.id},payload:{toolCallId:c.id,name:c.name,input:c.input}});
 if(c.type==='tool_result')events.push({type:'tool.result',origin:'agent',ref:{toolCallId:c.tool_use_id},payload:{toolCallId:c.tool_use_id,ok:!c.is_error,output:c.content}});
 }return {events,sessionRef};
 }
 if(o.type==='result')return {events:[{type:'cost.update',origin:'runtime',payload:{inputTokens:o.usage?.input_tokens||0,outputTokens:o.usage?.output_tokens||0,...(typeof o.total_cost_usd==='number'?{usd:o.total_cost_usd}:{})}}],sessionRef,result:{ok:!o.is_error&&o.subtype==='success',reason:o.is_error?'Claude result error':undefined}};
 }catch{}
 return {events:[{type:'output.chunk',origin:'runtime',payload:{stream:'stdout',data:Buffer.from(redact(line)).toString('base64')}}]};
 }
};
