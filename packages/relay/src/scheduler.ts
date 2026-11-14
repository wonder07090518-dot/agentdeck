import type { Machine, RoutingDecision } from '@agentdeck/protocol';
export function route(prompt:string,machines:Machine[]):RoutingDecision {
 const code=/代码|实现|重构|bug|编译|测试失败|implement|refactor|compile|coding/i;
 const review=/UI|界面|审美|质量审查|review|文案润色|审查/i;
 const light=/短文本|翻译|摘要|轻量|translate|summari/i;
 const rule=code.test(prompt)?'code':review.test(prompt)?'review':light.test(prompt)?'light':'general';
 const orders:Record<string,string[]>={code:['codex','claude','ollama'],review:['claude','codex','ollama'],light:['ollama','claude','codex'],general:['codex','claude','ollama']};
 const entries=machines.flatMap(machine=>machine.agents.map(agent=>{
 // Public threshold: any positive reported remaining amount is sufficient; zero is excluded.
 const note=!machine.online?'设备离线':agent.installed===false?'未安装':agent.dispatchable===false||!orders[rule].includes(agent.id)?'未实现执行':agent.id==='ollama'&&!agent.models?.length?'没有本地模型':agent.quota.known&&agent.quota.remaining<=0?'余量不足':agent.id==='ollama'?'本地模型，无云端额度限制':agent.quota.known?`剩余 ${agent.quota.remaining} ${agent.quota.unit}`:'余量未知';
 return {machine,agent,eligible:!['设备离线','未安装','未实现执行','没有本地模型','余量不足'].includes(note),note};
 }));
 const available=entries.filter(e=>e.eligible).sort((a,b)=>orders[rule].indexOf(a.agent.id)-orders[rule].indexOf(b.agent.id)||Number(b.agent.authenticated)-Number(a.agent.authenticated)||b.machine.lastSeen-a.machine.lastSeen||a.machine.id.localeCompare(b.machine.id)||a.agent.id.localeCompare(b.agent.id));
 const chosen=available[0];if(!chosen)throw Error('当前没有在线且可派发的 AI');
 return {machineId:chosen.machine.id,machineName:chosen.machine.name,agentId:chosen.agent.id,rule,reason:`${{code:'任务偏代码实现',review:'任务偏界面或质量审查',light:'任务偏轻量文本',general:'按通用优先级'}[rule]}，选择「${chosen.machine.name}」上的 ${chosen.agent.id}（在线，${chosen.agent.authenticated?'已验证登录':'登录未验证'}，${chosen.note}；已知余量须大于 0，未知额度不编造）。`,candidates:entries.map(e=>({machineId:e.machine.id,agentId:e.agent.id,eligible:e.eligible,note:e.note}))};
}
