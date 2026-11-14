import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
export function policy(name:string,input:unknown,root:string):'allow'|'ask'|'deny' {
 const i=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;const cmd=String(i.command||'');
 if(/rm\s+-[^\n]*r[^\n]*f\s+\/|git\s+push\s+.*--force|curl[^\n]*\|\s*(?:ba)?sh|\bsudo\b/.test(cmd))return 'deny';
 for(const key of ['file_path','path','directory','cwd'])if(typeof i[key]==='string'){
 const p=resolve(root,i[key]);let ancestor=p;const suffix:string[]=[];while(!existsSync(ancestor)){suffix.unshift(basename(ancestor));ancestor=dirname(ancestor);}const canonical=resolve(realpathSync(ancestor),...suffix);
 const rel=relative(realpathSync(root),canonical);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))return 'deny';
 }
 if(/bash|shell|exec|terminal/i.test(name)||cmd)return 'ask';
 if(/web|fetch|network|install|http/i.test(name))return 'ask';
 if(/^(Edit|Write|MultiEdit)$/i.test(name)&&!['file_path','path'].some(k=>typeof i[k]==='string'))return 'deny';
 if(/^(Read|Grep|Glob|LS|Edit|Write|MultiEdit)$/i.test(name))return 'allow';
 return 'ask';
}
