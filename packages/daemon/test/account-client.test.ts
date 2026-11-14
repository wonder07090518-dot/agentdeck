import { it, expect, vi } from 'vitest';
import { Client, configureStorage } from '../../../apps/mobile/src/client.js';
import { WSMessage } from '@agentdeck/protocol';
it('mobile saves account token before standard auth, reconnects and logs out without saving passwords',async()=>{
 class Socket {
  static OPEN=1;static sockets:Socket[]=[];readyState=0;sent:WSMessage[]=[];
  onopen?:()=>void;onclose?:((e:{code:number})=>void)|null;onmessage?:(e:{data:string})=>Promise<void>;onerror?:()=>void;
  constructor(public url:string){Socket.sockets.push(this);}
  open(){this.readyState=1;this.onopen?.();}send(raw:string){this.sent.push(WSMessage.parse(JSON.parse(raw)));}close(){this.readyState=3;}
 }
 vi.stubGlobal('WebSocket',Socket);let finish!:()=>void;const save=vi.fn(()=>new Promise<void>(resolve=>finish=resolve)),clear=vi.fn(async()=>{});configureStorage({save,clear});const c=new Client('wss://relay');
 try{
 c.login('phone@example.com','fixture-password');const ws=Socket.sockets[0];ws.open();expect(ws.sent[0].type).toBe('account.login');
 const handling=ws.onmessage!({data:JSON.stringify({type:'account.granted',accountId:'a',deviceId:'d',role:'phone',token:'fixture-token'})});
 expect(save).toHaveBeenCalledWith({token:'fixture-token',relayUrl:'wss://relay'});expect(ws.sent.some(m=>m.type==='auth')).toBe(false);finish();await handling;expect(ws.sent.at(-1)).toEqual({type:'auth',role:'device',token:'fixture-token'});
 c.refresh();const again=Socket.sockets[1];again.open();expect(again.sent[0]).toEqual({type:'auth',role:'device',token:'fixture-token'});expect(clear).not.toHaveBeenCalled();
 const account=vi.fn(),deleted=vi.fn();c.onAccount=account;c.onAccountDeleted=deleted;
 await again.onmessage!({data:JSON.stringify({type:'auth.ok',role:'device',machineId:'',accountId:'a'})});expect(account).toHaveBeenLastCalledWith(true);
 c.deleteAccount();expect(again.sent.at(-1)).toEqual({type:'account.delete',confirm:true});expect(clear).not.toHaveBeenCalled();
 await again.onmessage!({data:JSON.stringify({type:'account.deleted'})});expect(clear).toHaveBeenCalledOnce();expect(deleted).toHaveBeenCalledOnce();expect(account).toHaveBeenLastCalledWith(false);expect(again.readyState).toBe(3);
 }finally{c.close();configureStorage({save:async()=>{},clear:async()=>{}});vi.unstubAllGlobals();}
});
