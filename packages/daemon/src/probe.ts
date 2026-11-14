import { spawnSync } from 'node:child_process';

export type KnownQuota = {known:true;remaining:number;limit?:number;unit:string;raw?:string};
export type QuotaResult = {known:false} | KnownQuota;

const SUB: Record<string,string> = {pro:'Pro 订阅',max:'Max 订阅',team:'Team 订阅',enterprise:'Enterprise 订阅',free:'免费计划'};

/** Only treat a remaining amount as known when the CLI printed a finite number. Never invent. */
export function parseQuotaFromText(text:string):QuotaResult|null {
  const patterns=[
    /remaining(?:\s*(?:quota|usage|credits?|requests?|tokens?))?[^\d]{0,20}(\d+(?:\.\d+)?)\s*(%|percent|tokens?|requests?|credits?|USD|usd)?/i,
    /(\d+(?:\.\d+)?)\s*(%|tokens?|requests?|credits?)\s*(?:remaining|left|剩余)/i,
    /剩余[^\d]{0,12}(\d+(?:\.\d+)?)\s*(%|次|token|请求|积分)?/i,
  ];
  for(const re of patterns){
    const m=text.match(re);
    if(!m)continue;
    const remaining=Number(m[1]);
    if(!Number.isFinite(remaining))continue;
    const unit=(m[2]||'units').replace(/^percent$/i,'%');
    return {known:true,remaining,unit,raw:m[0].slice(0,80)};
  }
  return null;
}

export function parseQuotaFromObject(value:unknown):QuotaResult|null {
  if(!value||typeof value!=='object')return null;
  const o=value as Record<string,unknown>;
  const bags:Record<string,unknown>[]=[o];
  for(const k of ['usage','quota','rateLimit','rate_limit','limits','entitlements']){
    const v=o[k];
    if(v&&typeof v==='object'&&!Array.isArray(v))bags.push(v as Record<string,unknown>);
  }
  for(const b of bags){
    const remaining=Number(b.remaining??b.remaining_percent??b.percent_remaining??b.creditsRemaining??b.credits_remaining??b.requestsRemaining??b.requests_remaining);
    if(!Number.isFinite(remaining))continue;
    const unit=String(b.unit??b.units??(b.remaining_percent!=null||b.percent_remaining!=null?'%':'units'));
    const limit=Number(b.limit??b.total??b.cap);
    return {known:true,remaining,unit,...(Number.isFinite(limit)?{limit}:{})};
  }
  return null;
}

export function probeAuthAndQuota(id:string,bin:string):{authenticated:boolean;quota:QuotaResult;accountHint?:string} {
  let authenticated=false;
  let quota:QuotaResult={known:false};
  let accountHint:string|undefined;
  // Codex prints "Logged in using ChatGPT" on stderr; always combine both streams.
  const run=(args:string[],ms=4000)=>{
    const r=spawnSync(bin,args,{encoding:'utf8',timeout:ms,stdio:['ignore','pipe','pipe'],env:process.env,windowsHide:true});
    if(r.error)throw r.error;
    return `${r.stdout??''}
${r.stderr??''}`;
  };
  if(id==='codex'){
    try{
      const status=run(['login','status']);
      authenticated=/Logged in/i.test(status);
      quota=parseQuotaFromText(status)??quota;
    }catch{/* login probe failed — stay unauthenticated, quota unknown */}
  }else if(id==='claude'){
    try{
      const raw=run(['auth','status','--json']);
      const start=raw.indexOf('{');
      const end=raw.lastIndexOf('}');
      const json=start>=0&&end>start?raw.slice(start,end+1):raw;
      const j=JSON.parse(json) as Record<string,unknown>;
      authenticated=j.loggedIn===true;
      const sub=typeof j.subscriptionType==='string'?SUB[j.subscriptionType.toLowerCase()]:undefined;
      if(sub)accountHint=sub;
      quota=parseQuotaFromObject(j)??parseQuotaFromText(raw)??quota;
    }catch{/* auth probe failed */}
  }else if(id==='ollama'){
    accountHint='本地运行，无云端额度';
  }
  return {authenticated,quota,accountHint};
}
