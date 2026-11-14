import { execFile } from 'node:child_process';
import type { AgentInfo, EventDraft, Workspace } from '@agentdeck/protocol';
export interface RunRequest { prompt:string; workspace:Workspace; sessionRef?:string }
export interface SpawnSpec {cmd:string;args:string[];cwd:string;env:NodeJS.ProcessEnv;stdin:'closed'|'pty';parseMode:'jsonl'|'json'|'text'}
export interface Parsed {events:EventDraft[];sessionRef?:string;result?:{ok:boolean;reason?:string}}
export interface AgentAdapter {id:string;detect():Promise<AgentInfo|null>;buildDelegateRun(req:RunRequest):SpawnSpec;buildAttachRun(req:RunRequest):SpawnSpec;parse(line:string):Parsed;resumeArgs(id:string):string[];mapExit(code:number,stderr:string):{ok:boolean;reason?:string}}
export function detectBinary(id:string,bin:string):Promise<AgentInfo|null> {return new Promise(resolve=>execFile(bin,['--version'],{timeout:3000},(err,out)=>resolve(err?null:{id,version:out.trim(),authenticated:false,installed:true,dispatchable:id!=='grok',quota:{known:false},supports:{jsonOut:true,resume:true,interactive:true,permissions:true}})));}
export { claude } from './claude.js';
export { codex } from './codex.js';
export { grok } from './grok.js';
export function stub(id:string):AgentAdapter {const fail=():never=>{throw new Error('not_implemented');};return {id,detect:()=>detectBinary(id,id),buildDelegateRun:fail,buildAttachRun:fail,parse:fail,resumeArgs:fail,mapExit:fail};}

export { ollama, localModels } from './ollama.js';
