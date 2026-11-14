import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEnvelope, Session, Machine, Approval, type EventDraft } from '@agentdeck/protocol';
export class Store {
 db:DatabaseSync;
 constructor(home:string){mkdirSync(home,{recursive:true,mode:0o700});this.db=new DatabaseSync(join(home,'agentdeck.db'));this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS machines(id TEXT PRIMARY KEY,name TEXT,os TEXT,last_seen INTEGER,labels_json TEXT);
 CREATE TABLE IF NOT EXISTS agents(machine_id TEXT,agent_id TEXT,version TEXT,authenticated INTEGER,supports_json TEXT,PRIMARY KEY(machine_id,agent_id));
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,task_id TEXT,machine_id TEXT,agent_id TEXT,workspace_json TEXT,mode TEXT,status TEXT,worktree_json TEXT,title TEXT,started_at INTEGER,ended_at INTEGER,cost_json TEXT,seq INTEGER);
 CREATE INDEX IF NOT EXISTS sessions_status ON sessions(status);
 CREATE TABLE IF NOT EXISTS events(session_id TEXT REFERENCES sessions(id),seq INTEGER,ts INTEGER,type TEXT,origin TEXT,ref_json TEXT,payload_json TEXT,PRIMARY KEY(session_id,seq));
 CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,session_id TEXT,kind TEXT,summary TEXT,risk TEXT,state TEXT,expires_at INTEGER,resolved_at INTEGER,object_json TEXT);
 CREATE TABLE IF NOT EXISTS artifacts(session_id TEXT,kind TEXT,path TEXT,meta_json TEXT);
 CREATE TABLE IF NOT EXISTS session_metadata(session_id TEXT PRIMARY KEY,claude_session_id TEXT);
 CREATE TRIGGER IF NOT EXISTS events_contiguous BEFORE INSERT ON events BEGIN SELECT CASE WHEN NEW.seq != (SELECT seq+1 FROM sessions WHERE id=NEW.session_id) THEN RAISE(ABORT,'non-contiguous seq') END; END;
 CREATE TRIGGER IF NOT EXISTS events_advance AFTER INSERT ON events BEGIN UPDATE sessions SET seq=NEW.seq WHERE id=NEW.session_id; END;`);}
 machine(m:Machine){Machine.parse(m);this.db.prepare('INSERT OR REPLACE INTO machines VALUES(?,?,?,?,?)').run(m.id,m.name,m.os,m.lastSeen,JSON.stringify(m.labels));for(const a of m.agents)this.db.prepare('INSERT OR REPLACE INTO agents VALUES(?,?,?,?,?)').run(m.id,a.id,a.version,+a.authenticated,JSON.stringify(a.supports));}
 save(s:Session){Session.parse(s);this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.id,s.taskId,s.machineId,s.agentId,JSON.stringify(s.workspace),s.mode,s.status,JSON.stringify(s.worktree??null),s.title,s.startedAt,s.endedAt??null,JSON.stringify(s.cost??null),s.seq);}
 sessions():Session[]{return (this.db.prepare('SELECT id FROM sessions ORDER BY started_at DESC, rowid DESC').all() as {id:string}[]).map(r=>this.session(r.id));}
 session(id:string):Session {const r=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as any;if(!r)throw Error('unknown session');return Session.parse({id:r.id,taskId:r.task_id,machineId:r.machine_id,agentId:r.agent_id,workspace:JSON.parse(r.workspace_json),mode:r.mode,status:r.status,worktree:JSON.parse(r.worktree_json)||undefined,title:r.title,startedAt:r.started_at,endedAt:r.ended_at??undefined,cost:JSON.parse(r.cost_json)||undefined,seq:r.seq});}
 append(id:string,d:EventDraft,seq=this.session(id).seq+1){const e=EventEnvelope.parse({...d,v:1,sessionId:id,seq,ts:Date.now()});this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(id,seq,e.ts,e.type,e.origin,JSON.stringify(e.ref??null),JSON.stringify(e.payload));return e;}
 events(id:string,since=0):EventEnvelope[]{return this.db.prepare('SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq').all(id,since).map((r:any)=>EventEnvelope.parse({v:1,sessionId:id,seq:r.seq,ts:r.ts,type:r.type,origin:r.origin,ref:JSON.parse(r.ref_json)||undefined,payload:JSON.parse(r.payload_json)}));}
 ref(id:string,value?:string):string|undefined {if(value)this.db.prepare('INSERT OR REPLACE INTO session_metadata VALUES(?,?)').run(id,value);return (this.db.prepare('SELECT claude_session_id FROM session_metadata WHERE session_id=?').get(id) as any)?.claude_session_id;}
 approval(a:Approval){this.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?)').run(a.approvalId,a.sessionId,a.kind,a.summary,a.risk,'pending',a.expiresAt,null,JSON.stringify(a));}
 pending(id:string):Approval[]{return this.db.prepare("SELECT object_json FROM approvals WHERE session_id=? AND state='pending'").all(id).map((r:any)=>Approval.parse(JSON.parse(r.object_json)));}
 resolve(id:string,decision:string){const r=this.db.prepare("UPDATE approvals SET state=?,resolved_at=? WHERE id=? AND state='pending'").run(decision,Date.now(),id);if(r.changes!==1)throw Error('invalid approvalId');}
 close(){this.db.close();}
}
