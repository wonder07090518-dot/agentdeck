import { z } from 'zod';
export { z };
export const SessionMode = z.enum(['delegate','attach']);
export const SessionStatus = z.enum(['pending','starting','running','needs_approval','paused','done','failed','cancelled']);
export const Cost = z.object({inputTokens:z.number(),outputTokens:z.number(),usd:z.number().optional()});
export const Quota = z.discriminatedUnion('known',[z.object({known:z.literal(false)}),z.object({known:z.literal(true),remaining:z.number().finite(),limit:z.number().optional(),unit:z.string(),raw:z.string().optional()})]);
export const RoutingDecision = z.object({machineId:z.string(),machineName:z.string(),agentId:z.string(),reason:z.string(),rule:z.string(),candidates:z.array(z.object({machineId:z.string(),agentId:z.string(),eligible:z.boolean(),note:z.string()}))});
export type RoutingDecision=z.infer<typeof RoutingDecision>;
export const AgentInfo = z.object({id:z.string(),version:z.string(),authenticated:z.boolean(),installed:z.boolean().optional(),dispatchable:z.boolean().optional(),models:z.array(z.string()).optional(),quota:Quota.default({known:false}),accountHint:z.string().optional(),supports:z.object({jsonOut:z.boolean(),resume:z.boolean(),interactive:z.boolean(),permissions:z.boolean()}),rateLimitHint:z.string().optional()});
export const Machine = z.object({id:z.string(),name:z.string(),os:z.enum(['darwin','win32','linux']),online:z.boolean(),lastSeen:z.number(),agents:z.array(AgentInfo),labels:z.array(z.string())});
export const Workspace = z.object({machineId:z.string(),path:z.string(),gitRoot:z.string().optional(),defaultBranch:z.string().optional()});
export const Session = z.object({id:z.string().uuid(),taskId:z.string().nullable(),machineId:z.string(),agentId:z.string(),workspace:Workspace,mode:SessionMode,status:SessionStatus,worktree:z.object({path:z.string(),branch:z.string()}).optional(),title:z.string(),startedAt:z.number(),endedAt:z.number().optional(),cost:Cost.optional(),seq:z.number().int().nonnegative()});
export const Approval = z.object({approvalId:z.string(),sessionId:z.string(),kind:z.enum(['shell','write','network','spawn']),summary:z.string(),detail:z.string().optional(),risk:z.enum(['low','medium','high']),options:z.array(z.enum(['allow','allow_always','deny'])),expiresAt:z.number()});
export const UserInput = z.object({text:z.string(),attachments:z.array(z.unknown()).optional(),clientMsgId:z.string()});
export const DiffSummary = z.object({filesChanged:z.number(),insertions:z.number(),deletions:z.number(),baseRef:z.string()});
const payloads = {
 'session.created':Session,
 'routing.decision':RoutingDecision,
 'session.status':z.object({from:SessionStatus,to:SessionStatus,reason:z.string().optional()}),
 'user.input':UserInput,
 'agent.message':z.object({delta:z.string().optional(),text:z.string().optional(),final:z.boolean().optional()}),
 'agent.reasoning':z.object({summary:z.string()}),
 'tool.call':z.object({toolCallId:z.string(),name:z.string(),input:z.unknown()}),
 'tool.result':z.object({toolCallId:z.string(),ok:z.boolean(),output:z.unknown().optional(),error:z.string().optional()}),
 'command.exec':z.object({cmd:z.string(),cwd:z.string(),exitCode:z.number(),durationMs:z.number()}),
 'output.chunk':z.object({stream:z.enum(['stdout','stderr','pty']),data:z.string(),truncated:z.boolean().optional()}),
 'file.change':z.object({path:z.string(),kind:z.enum(['add','modify','delete']),patch:z.string().optional()}),
 'diff.snapshot':DiffSummary,
 'test.result':z.object({cmd:z.string(),ok:z.boolean(),failed:z.number(),total:z.number().optional()}),
 'approval.request':Approval,
 'approval.resolve':z.object({approvalId:z.string(),decision:z.enum(['allow','allow_always','deny']),remember:z.boolean().optional()}),
 'result.resolve':z.object({decision:z.enum(['accept','reject'])}),
 'cost.update':Cost,
 'error':z.object({code:z.string(),message:z.string(),retriable:z.boolean()}),
 'session.ended':z.object({status:z.enum(['done','failed','cancelled']),reason:z.string().optional(),cost:Cost,summary:z.string()})
};
export const EventType = z.enum(Object.keys(payloads) as [keyof typeof payloads,...(keyof typeof payloads)[]]);
const common = {v:z.literal(1),sessionId:z.string(),seq:z.number().int().positive(),ts:z.number(),origin:z.enum(['user','agent','runtime','policy']),ref:z.object({toolCallId:z.string().optional(),approvalId:z.string().optional(),parentSeq:z.number().int().optional()}).optional()};
// The mapped union retains each payload's relationship to its event type.
type Events = {[K in keyof typeof payloads]: z.ZodObject<typeof common & {type:z.ZodLiteral<K>;payload:(typeof payloads)[K]}>}[keyof typeof payloads];
const variants = Object.entries(payloads).map(([type,payload])=>z.object({...common,type:z.literal(type),payload})) as unknown as [Events,Events,...Events[]];
export const EventEnvelope = z.discriminatedUnion('type',variants);
export const SessionSnapshot = z.object({session:Session,recent:z.array(EventEnvelope),pendingApprovals:z.array(Approval),diff:DiffSummary,tail:z.string()});
export const WSMessage = z.discriminatedUnion('type',[
 z.object({type:z.literal('account.delete'),confirm:z.literal(true).optional()}),
 z.object({type:z.literal('account.deleted')}),
 z.object({type:z.literal('account.register'),email:z.string().max(254),password:z.string().max(1024),role:z.enum(['phone','computer']),machineId:z.string().optional()}),
 z.object({type:z.literal('account.login'),email:z.string().max(254),password:z.string().max(1024),role:z.enum(['phone','computer']),machineId:z.string().optional()}),
 z.object({type:z.literal('account.magic.start'),email:z.string().max(254),purpose:z.enum(['login','register'])}),
 z.object({type:z.literal('account.magic.sent'),via:z.enum(['smtp','desktop']),expiresAt:z.number()}),
 z.object({type:z.literal('account.magic.code'),code:z.string(),expiresAt:z.number()}),
 z.object({type:z.literal('account.magic.complete'),email:z.string().max(254),code:z.string().max(16),role:z.enum(['phone','computer']),machineId:z.string().optional()}),
 z.object({type:z.literal('account.granted'),accountId:z.string(),token:z.string(),role:z.enum(['phone','computer']),deviceId:z.string(),relayUrl:z.string().optional()}),
 z.object({type:z.literal('auth'),role:z.enum(['daemon','device']),machineId:z.string().optional(),relaySecret:z.string().optional(),token:z.string().optional()}),
 z.object({type:z.literal('auth.ok'),accountId:z.string().optional(),role:z.enum(['daemon','device']),machineId:z.string(),deviceId:z.string().optional()}),
 z.object({type:z.literal('join.start')}),
 z.object({type:z.literal('join.offer'),ticket:z.string(),expiresAt:z.number(),relayUrl:z.string(),command:z.string()}),
 z.object({type:z.literal('daemon.join'),ticket:z.string().min(1).max(512)}),
 z.object({type:z.literal('daemon.joined'),relaySecret:z.string().optional(),token:z.string().optional(),accountId:z.string().optional(),relayUrl:z.string()}),
 z.object({type:z.literal('pair.start')}),
 z.object({type:z.literal('pair.offer'),code:z.string(),expiresAt:z.number(),relayUrl:z.string(),qrText:z.string()}),
 z.object({type:z.literal('pair.complete'),code:z.string()}),
 z.object({type:z.literal('pair.granted'),token:z.string(),deviceId:z.string(),machineId:z.string()}),
 z.object({type:z.literal('device.revoke'),deviceId:z.string()}),
 z.object({type:z.literal('device.revoked'),deviceId:z.string()}),
 z.object({type:z.literal('session.list')}),
 z.object({type:z.literal('session.list.result'),sessions:z.array(Session)}),
 z.object({type:z.literal('session.create'),prompt:z.string(),cwd:z.string().optional(),agent:z.enum(['claude','codex','grok','ollama']).optional(),machineId:z.string().optional(),route:z.enum(['direct','auto']).optional(),routingDecision:RoutingDecision.optional(),clientMsgId:z.string()}),
 z.object({type:z.literal('session.accepted'),session:Session}),
 z.object({type:z.literal('session.send'),sessionId:z.string(),text:z.string(),clientMsgId:z.string()}),

 z.object({type:z.literal('hello'),v:z.literal(1),machineId:z.string()}),
 z.object({type:z.literal('machine.register')}),
 z.object({type:z.literal('machine.snapshot'),machine:Machine}),
 z.object({type:z.literal('fleet.snapshot'),machines:z.array(Machine)}),
 z.object({type:z.literal('routing.decision'),decision:RoutingDecision}),
 z.object({type:z.literal('session.subscribe'),sessionId:z.string(),since:z.number().int().nonnegative().optional()}),
 z.object({type:z.literal('session.snapshot'),snapshot:SessionSnapshot}),
 z.object({type:z.literal('event'),event:EventEnvelope}),
 z.object({type:z.literal('approval.resolve'),approvalId:z.string(),decision:z.enum(['allow','allow_always','deny'])}),
 z.object({type:z.literal('session.interject'),sessionId:z.string(),text:z.string().min(1),clientMsgId:z.string()}),
 z.object({type:z.literal('result.resolve'),sessionId:z.string(),decision:z.enum(['accept','reject'])}),
 z.object({type:z.literal('runtime.halt'),sessionId:z.string().optional(),machineId:z.string().optional()}),
 z.object({type:z.literal('error'),code:z.string(),message:z.string()})
]).superRefine((m,ctx)=>{if(m.type==='auth'&&((m.role==='daemon'&&(!m.machineId||(!m.relaySecret&&!m.token)||(!!m.relaySecret&&!!m.token)))||(m.role==='device'&&!m.token)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'missing auth credentials'});});
export type Quota=z.infer<typeof Quota>;
export type Cost=z.infer<typeof Cost>;
export type DiffSummary=z.infer<typeof DiffSummary>;
export type Machine=z.infer<typeof Machine>;
export type AgentInfo=z.infer<typeof AgentInfo>;
export type Workspace=z.infer<typeof Workspace>;
export type Session=z.infer<typeof Session>;
export type SessionMode=z.infer<typeof SessionMode>;
export type SessionStatus=z.infer<typeof SessionStatus>;
export type EventEnvelope=z.infer<typeof EventEnvelope>;
export type EventType=z.infer<typeof EventType>;
export type EventDraft=EventEnvelope extends infer E ? E extends EventEnvelope ? Omit<E,'v'|'sessionId'|'seq'|'ts'> : never : never;
export type SessionSnapshot=z.infer<typeof SessionSnapshot>;
export type Approval=z.infer<typeof Approval>;
export type UserInput=z.infer<typeof UserInput>;
export type WSMessage=z.infer<typeof WSMessage>;
