import { accounts } from './accounts.js';
import nodemailer from 'nodemailer';
import { createServer } from 'node:https';
function secureMode(path:string,mode:number){if(process.platform!=='win32')chmodSync(path,mode);}
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { WSMessage } from '@agentdeck/protocol';
import { route } from './scheduler.js';
import type { Machine, Session } from '@agentdeck/protocol';
import QRCode from 'qrcode';
export interface RelayOptions {home?:string;host?:string;port?:number;tlsCert?:string;tlsKey?:string;publicUrl?:string;now?:()=>number}
interface Device {accountId?:string;hash:string;deviceId:string;machineId:string;createdAt:number;revokedAt?:number}
interface Identity {accountToken?:boolean;accountId?:string;role:'daemon'|'device';machineId:string;deviceId?:string}
export const generatePairSvg=(text:string):Promise<string>=>QRCode.toString(text,{type:'svg',margin:2,width:360});
export const generatePairQr=(text:string):Promise<string>=>QRCode.toString(text,{type:'terminal',small:true});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function startRelay(options:RelayOptions={}) {
 const home=options.home??join(homedir(),'.agentdeck'),host=options.host??'127.0.0.1',port=options.port??8443,now=options.now??Date.now;
 if(options.publicUrl&&!options.publicUrl.startsWith('wss://'))throw Error('public URL must use wss://');
 if(!!options.tlsCert!==!!options.tlsKey)throw Error('both TLS certificate and key are required');
 mkdirSync(home,{recursive:true,mode:0o700});secureMode(home,0o700);
 const secretFile=join(home,'relay.json');
 if(!existsSync(secretFile)){writeFileSync(secretFile,JSON.stringify({relaySecret:randomBytes(32).toString('hex')}),{mode:0o600,flag:'wx'});process.stderr.write(`relay secret stored at ${secretFile}\n`);}
 secureMode(secretFile,0o600);const secret=JSON.parse(readFileSync(secretFile,'utf8')).relaySecret as string;
 const cert=options.tlsCert??join(home,'tls-cert.pem'),key=options.tlsKey??join(home,'tls-key.pem');
 if(!options.tlsCert&&(!existsSync(cert)||!existsSync(key))){try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','365','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});}catch{throw Error('无法生成 TLS 证书：请安装 openssl 或传入 --tls-cert 与 --tls-key');}secureMode(key,0o600);}
 const deviceFile=join(home,'devices.json');let devices:Device[]=existsSync(deviceFile)?JSON.parse(readFileSync(deviceFile,'utf8')):[];
 if(existsSync(deviceFile))secureMode(deviceFile,0o600);
 const persist=()=>writeFileSync(deviceFile,JSON.stringify(devices),{mode:0o600});
 const account=accounts(home,now);
 const joins=new Map<string,{accountId?:string;machineId:string;expiresAt:number}>();
 const relayUrl=()=>options.publicUrl??`wss://${host.includes(':')?'['+host+']':host}:${(server.address() as {port:number}).port}`;
 const offers=new Map<string,{accountId?:string;machineId:string;expiresAt:number}>(),identities=new Map<WebSocket,Identity>(),daemons=new Map<string,WebSocket>();
 const fleetFile=join(home,'fleet.json');
 const fleet=new Map<string,Machine & {accountId?:string}>((existsSync(fleetFile)?JSON.parse(readFileSync(fleetFile,'utf8')):[]).map((m:Machine)=>[m.id,{...m,online:false}]));
 const sessions=new Map<string,Session[]>(),owners=new Map<string,string>(),approvalOwners=new Map<string,string>(),selected=new Map<WebSocket,string>();
 const persistFleet=()=>writeFileSync(fleetFile,JSON.stringify([...fleet.values()]),{mode:0o600});
 const server=createServer({cert:readFileSync(cert),key:readFileSync(key)},(_req,res)=>{res.writeHead(404);res.end();});const wss=new WebSocketServer({server,maxPayload:4*1024*1024});
 wss.on('error',()=>{});
 const send=(ws:WebSocket,m:unknown)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));};
 const visible=(id:Identity,machineId:string)=>{const machine=fleet.get(machineId);if(machine)return machine.accountId===id.accountId;const daemon=daemons.get(machineId);return !!daemon&&identities.get(daemon)?.accountId===id.accountId;};
 const fleetSnapshot=(id:Identity)=>({type:'fleet.snapshot',machines:[...fleet.values()].filter(m=>m.accountId===id.accountId)});
 const listSnapshot=(id:Identity)=>({type:'session.list.result',sessions:[...sessions.entries()].filter(([mid])=>daemons.has(mid)&&visible(id,mid)).flatMap(([,items])=>items)});
 const broadcast=(m:{type:string},source?:Identity)=>{for(const [socket,id] of identities)if(id.role==='device'&&(!source||source.accountId===id.accountId))send(socket,m.type==='fleet.snapshot'?fleetSnapshot(id):m.type==='session.list.result'?listSnapshot(id):m);};
 wss.on('connection',ws=>{
 const fail=(message:string,close=false)=>{send(ws,{type:'error',code:'RELAY_ERROR',message});if(close)ws.close(1008,'authorization failed');};
 ws.on('close',()=>{const id=identities.get(ws);if(id?.role==='daemon'&&daemons.get(id.machineId)===ws){daemons.delete(id.machineId);const machine=fleet.get(id.machineId);if(machine){machine.online=false;persistFleet();}broadcast({type:'fleet.snapshot'});broadcast({type:'session.list.result'});}identities.delete(ws);selected.delete(ws);});
 ws.on('error',()=>{});
 ws.on('message',async data=>{try{
 const m=WSMessage.parse(JSON.parse(data.toString())),id=identities.get(ws);
 if(m.type==='account.register'||m.type==='account.login'||m.type==='account.magic.complete'){
 if(id)throw Error('already authenticated');
 const accountId=m.type==='account.magic.complete'?await account.complete(m.email,m.code):await account.password(m.email,m.password,m.type==='account.register');
 send(ws,{type:'account.granted',...account.issue(accountId,m.role),relayUrl:relayUrl()});return;
 }
 if(m.type==='account.magic.start'){
 if(id)throw Error('already authenticated');const magic=await account.start(m.email,m.purpose);const smtp=process.env.AGENTDECK_SMTP_URL;
 if(smtp&&magic.code){try{await nodemailer.createTransport(smtp).sendMail({from:process.env.AGENTDECK_SMTP_FROM??'AgentDeck <login@agentdeck.test>',to:m.email.trim().toLowerCase(),subject:'AgentDeck 验证码',text:`验证码 ${magic.code} 10 分钟内有效`});}catch{throw Error('验证码发送失败');}}
 else if(magic.accountId&&magic.code)for(const [socket,other] of identities)if(other.role==='daemon'&&other.accountId===magic.accountId)send(socket,{type:'account.magic.code',code:magic.code,expiresAt:magic.expiresAt});
 send(ws,{type:'account.magic.sent',via:smtp?'smtp':'desktop',expiresAt:magic.expiresAt});return;
 }
 if(m.type==='auth'){
 if(id)throw Error('already authenticated');
 if(m.role==='daemon'){
 const t=m.token?account.token(m.token,'computer'):undefined;
 if(!m.machineId||(m.token?!t:!m.relaySecret||!timingSafeEqual(Buffer.from(hash(m.relaySecret)),Buffer.from(hash(secret)))))return fail('invalid credentials',true);
 const previous=fleet.get(m.machineId);if(previous&&previous.accountId!==t?.accountId)return fail('invalid credentials',true);
 const old=daemons.get(m.machineId);if(old&&identities.get(old)?.accountId!==t?.accountId)return fail('invalid credentials',true);if(old){identities.delete(old);old.close(1008,'daemon replaced');}identities.set(ws,{role:'daemon',machineId:m.machineId,accountId:t?.accountId});daemons.set(m.machineId,ws);send(ws,{type:'auth.ok',role:'daemon',machineId:m.machineId});send(ws,{type:'machine.register'});
 }else{const t=account.token(m.token??'','phone');const d=t?{...t,machineId:''}:devices.find(d=>d.hash===hash(m.token??'')&&d.revokedAt===undefined);if(!d)return fail('invalid credentials',true);identities.set(ws,{role:'device',machineId:d.machineId,deviceId:d.deviceId,accountId:d.accountId,accountToken:!!t});send(ws,{type:'auth.ok',role:'device',machineId:d.machineId,deviceId:d.deviceId,accountId:t?.accountId});send(ws,fleetSnapshot(identities.get(ws)!));}return;
 }
 if(m.type==='daemon.join'){
 if(id)throw Error('already authenticated');
 const digest=Buffer.from(hash(m.ticket));let found:string|undefined;
 for(const key of joins.keys())if(timingSafeEqual(Buffer.from(key),digest))found=key;
 const offer=found?joins.get(found):undefined;
 if(!offer||offer.expiresAt<=now()){if(found)joins.delete(found);return fail('invalid or expired join ticket',true);}
 joins.delete(found!);send(ws,offer.accountId?{type:'daemon.joined',...account.issue(offer.accountId,'computer'),relayUrl:relayUrl()}:{type:'daemon.joined',relaySecret:secret,relayUrl:relayUrl()});return;
 }
 if(m.type==='pair.complete'){
 if(id)throw Error('already authenticated');const offer=offers.get(m.code);if(!offer||offer.expiresAt<=now()){offers.delete(m.code);return fail('invalid or expired pairing code',true);}offers.delete(m.code);
 const token=randomBytes(32).toString('base64url'),d:Device={hash:hash(token),deviceId:randomUUID(),machineId:offer.machineId,accountId:offer.accountId,createdAt:now()};devices.push(d);persist();identities.set(ws,{role:'device',machineId:d.machineId,deviceId:d.deviceId,accountId:d.accountId});send(ws,{type:'pair.granted',token,deviceId:d.deviceId,machineId:d.machineId});send(ws,fleetSnapshot(identities.get(ws)!));return;
 }
 if(!id)return fail('authentication required',true);
 if(m.type==='account.delete'){
 if(!id.accountId||!id.accountToken)throw Error('这个连接没有账号');
 const accountId=id.accountId;
 account.delete(accountId);
 devices=devices.filter(d=>d.accountId!==accountId);persist();
 for(const [key,offer] of joins)if(offer.accountId===accountId)joins.delete(key);
 for(const [key,offer] of offers)if(offer.accountId===accountId)offers.delete(key);
 const removed=new Set<string>();
 for(const [mid,machine] of fleet)if(machine.accountId===accountId){fleet.delete(mid);removed.add(mid);}
 for(const [socket,other] of identities)if(other.accountId===accountId&&other.role==='daemon')removed.add(other.machineId);
 for(const mid of removed){daemons.delete(mid);sessions.delete(mid);}
 for(const [sid,mid] of owners)if(removed.has(mid))owners.delete(sid);
 for(const [aid,mid] of approvalOwners)if(removed.has(mid))approvalOwners.delete(aid);
 persistFleet();
 send(ws,{type:'account.deleted'});
 for(const [socket,other] of identities)if(other.accountId===accountId){identities.delete(socket);selected.delete(socket);socket.close(1008,'account deleted');}
 return;
 }
 if(m.type==='join.start'){
 if(id.role!=='daemon')throw Error('daemon required');
 for(const [key,offer] of joins)if(offer.expiresAt<=now()||offer.machineId===id.machineId)joins.delete(key);
 const ticket=randomBytes(32).toString('base64url'),expiresAt=now()+300000,url=relayUrl();
 joins.set(hash(ticket),{machineId:id.machineId,accountId:id.accountId,expiresAt});
 const link=`agentdeck://join?${new URLSearchParams({relay:url,ticket})}`;
 send(ws,{type:'join.offer',ticket,expiresAt,relayUrl:url,command:`agentdeck join '${link}'`});return;
 }
 if(m.type==='pair.start'){
 if(id.role!=='daemon')throw Error('daemon required');for(const [code,o] of offers)if(o.expiresAt<=now()||o.machineId===id.machineId)offers.delete(code);
 let code:string;do{code=String(randomInt(1000000)).padStart(6,'0');}while(offers.has(code));const expiresAt=now()+300000;offers.set(code,{machineId:id.machineId,accountId:id.accountId,expiresAt});const relayUrl=options.publicUrl??`wss://${host.includes(':')?'['+host+']':host}:${(server.address() as {port:number}).port}`;
 const query=new URLSearchParams({relay:relayUrl,code});send(ws,{type:'pair.offer',code,expiresAt,relayUrl,qrText:`agentdeck://pair?${query}`});return;
 }
 if(m.type==='device.revoke'){
 const d=devices.find(d=>d.deviceId===m.deviceId);if(!d||d.accountId!==id.accountId||(id.role==='device'&&id.deviceId!==d.deviceId))throw Error('unauthorized revocation');d.revokedAt=now();persist();send(ws,{type:'device.revoked',deviceId:d.deviceId,accountId:d.accountId});for(const [socket,other] of identities)if(other.deviceId===d.deviceId){identities.delete(socket);socket.close(1008,'device revoked');}return;
 }
 if(m.type.startsWith('account.')||m.type.startsWith('join.')||m.type==='daemon.joined'||m.type.startsWith('pair.')||m.type==='auth.ok'||m.type==='device.revoked')throw Error('reserved relay message');
 if(id.role==='device'){
 if(m.type==='machine.register'){send(ws,fleetSnapshot(identities.get(ws)!));return;}
 if(m.type==='session.list'){for(const [mid,daemon] of daemons)if(visible(id,mid))send(daemon,m);send(ws,listSnapshot(id));return;}
 let machineId:string|undefined;
 let outgoing:unknown=m;
 if(m.type==='session.create'){
 if(m.route==='auto'){const decision=route(m.prompt,[...fleet.values()].filter(x=>x.accountId===id.accountId));machineId=decision.machineId;send(ws,{type:'routing.decision',decision});outgoing={...m,machineId,agent:decision.agentId,routingDecision:decision};}
 else {machineId=m.machineId??id.machineId;if(!m.agent)outgoing={...m,agent:'claude'};const machine=fleet.get(machineId);const agentId=(outgoing as {agent?:string}).agent??m.agent??'claude';const agent=machine?.agents.find(a=>a.id===agentId);
 const daemonOnline=daemons.has(machineId);
 if(machine&&(!machine.online||agent?.installed===false||agent?.dispatchable===false||agentId==='grok'))throw Error('所选设备或 AI 当前不可派发');
 if(!daemonOnline&&!machine?.online)throw Error('所选设备或 AI 当前不可派发');}
 }else if(m.type==='approval.resolve')machineId=approvalOwners.get(m.approvalId);
 else if('sessionId' in m&&m.sessionId){machineId=owners.get(m.sessionId)??id.machineId;if(m.type==='session.subscribe'&&machineId)selected.set(ws,machineId);}
 else if(m.type==='runtime.halt')machineId=m.machineId??selected.get(ws);
 if(!machineId)throw Error('找不到任务所属设备，请刷新任务列表');
 if(!visible(id,machineId))throw Error('找不到任务所属设备，请刷新任务列表');
 const target=daemons.get(machineId);if(target)send(target,outgoing);else send(ws,{type:'error',code:'MACHINE_OFFLINE',message:'电脑离线，等待重新连接'});
 }else {
 const claimed=m.type==='session.list.result'?m.sessions.map(s=>s.id):m.type==='session.accepted'?[m.session.id]:m.type==='session.snapshot'?[m.snapshot.session.id]:m.type==='event'?[m.event.sessionId]:[];
 if(claimed.some(s=>owners.has(s)&&owners.get(s)!==id.machineId))throw Error('session identity mismatch');
 if((m.type==='session.accepted'&&m.session.machineId!==id.machineId)||(m.type==='session.snapshot'&&m.snapshot.session.machineId!==id.machineId))throw Error('session identity mismatch');
 if(m.type==='machine.snapshot'){if(m.machine.id!==id.machineId)throw Error('machine identity mismatch');fleet.set(id.machineId,{...m.machine,accountId:id.accountId,online:true,lastSeen:now()});persistFleet();broadcast({type:'fleet.snapshot'});return;}
 if(m.type==='session.list.result'){if(m.sessions.some(s=>s.machineId!==id.machineId))throw Error('session identity mismatch');sessions.set(id.machineId,m.sessions);for(const session of m.sessions)owners.set(session.id,id.machineId);broadcast({type:'session.list.result'});return;}
 if(m.type==='session.accepted')owners.set(m.session.id,id.machineId);
 if(m.type==='event')owners.set(m.event.sessionId,id.machineId);
 if(m.type==='session.snapshot'){owners.set(m.snapshot.session.id,id.machineId);for(const approval of m.snapshot.pendingApprovals)approvalOwners.set(approval.approvalId,id.machineId);}
 if(m.type==='event'&&m.event.type==='approval.request')approvalOwners.set(m.event.payload.approvalId,id.machineId);
 broadcast(m,id);
 }

 }catch(err){fail(err instanceof Error&&!(err.name==='ZodError')?err.message:'invalid request',!identities.has(ws)&&!data.toString().includes('account.'));}});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {server,wss,peekMagic:account.peek,async close(){for(const ws of wss.clients)ws.terminate();await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}};
}
