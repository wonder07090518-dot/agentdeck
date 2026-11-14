import { describe, it, expect } from 'vitest';
import type { AgentInfo, Machine } from '@agentdeck/protocol';
import { route } from '../../relay/dist/scheduler.js';
const agent=(id:string,extra:Partial<AgentInfo>={}):AgentInfo=>({id,version:'fake',installed:true,dispatchable:true,authenticated:false,quota:{known:false},supports:{jsonOut:true,resume:false,interactive:false,permissions:false},...extra});
const machine=(id:string,agents:AgentInfo[],extra:Partial<Machine>={}):Machine=>({id,name:id,os:'linux',online:true,lastSeen:1,labels:[],agents,...extra});
describe('M4 deterministic scheduler',()=>{
 const fleet=[machine('claude',[agent('claude')]),machine('codex',[agent('codex')]),machine('local',[agent('ollama',{models:['fake-local']})])];
 it.each([['实现代码','codex'],['review 界面','claude'],['翻译短文本','ollama']])('routes %s to %s',(prompt,id)=>expect(route(prompt,fleet).agentId).toBe(id));
 it('skips offline machines and exhausted known quotas',()=>{
  const result=route('实现代码',[machine('offline',[agent('codex')],{online:false}),machine('empty',[agent('codex',{quota:{known:true,remaining:0,unit:'requests'}})]),machine('negative',[agent('codex',{quota:{known:true,remaining:-1,unit:'requests'}})]),fleet[0]]);
  expect(result.machineId).toBe('claude');
  expect(result.candidates.filter(c=>!c.eligible).map(c=>c.note)).toEqual(['设备离线','余量不足','余量不足']);
 });
 it('reports unknown quota honestly',()=>expect(route('代码',[fleet[1]]).reason).toContain('余量未知'));
 it('rejects a fleet with no eligible candidate',()=>{
  expect(()=>route('hi',[machine('off',[agent('claude')],{online:false}),machine('missing',[agent('codex',{installed:false})]),machine('unsupported',[agent('grok',{dispatchable:false})]),machine('no-model',[agent('ollama',{models:[]})])])).toThrow('当前没有在线且可派发的 AI');
 });
 it('uses authentication, recency, and stable machine id to break ties',()=>{
  const a=machine('a',[agent('codex',{authenticated:true})]);
  const b=machine('b',[agent('codex',{authenticated:true})]);
  const c=machine('c',[agent('codex')],{lastSeen:999});
  expect(route('代码',[c,b,a]).machineId).toBe('a');
  expect(route('代码',[a,{...b,lastSeen:2},c]).machineId).toBe('b');
 });
});
