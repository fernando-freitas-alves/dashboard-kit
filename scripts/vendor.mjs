import {readFileSync,writeFileSync,lstatSync,mkdirSync,copyFileSync,readdirSync,rmSync,existsSync,mkdtempSync,renameSync} from 'node:fs';
import {resolve,dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),check=args.includes('--check'),dest=args.find(a=>a!=='--check');
if(!dest)throw Error('Usage: node scripts/vendor.mjs [--check] <consumer-directory>');
const target=resolve(dest,'vendor/dashboard-kit');
if(target===root || root.startsWith(target+sep) || target.startsWith(root+sep))throw Error('Choose a consumer outside Dashboard Kit.');
for(let current=target;;current=dirname(current)){
 if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Destination symlinks are not supported.');
 if(current===resolve(dest)||dirname(current)===current)break;
}
const paths=JSON.parse(readFileSync(join(root,'distribution-files.json'),'utf8'));
function safeFile(base,p){
 if(typeof p!=='string'||p.includes('\\')||p.startsWith('/')||p.split('/').some(x=>x==='..'||x==='.'||!x))throw Error('Invalid distribution path');
 let current=base;
 for(const part of p.split('/')){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw Error('Symlinks are not distributable: '+p)}
 if(!lstatSync(current).isFile())throw Error('Expected a regular file: '+p);
 return current;
}
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest={version:'0.1.0',files:Object.fromEntries(paths.map(p=>[p,{sha256:hash(safeFile(root,p))}]))};
function walk(base,p=''){return readdirSync(join(base,p),{withFileTypes:true}).flatMap(e=>{const q=p?`${p}/${e.name}`:e.name;if(e.isSymbolicLink())throw Error('Symlink in snapshot: '+q);return e.isDirectory()?walk(base,q):[q]}).sort()}
if(check){
 const existing=JSON.parse(readFileSync(join(target,'manifest.json'),'utf8'));
 if(JSON.stringify(existing)!==JSON.stringify(manifest))throw Error('Dashboard Kit snapshot is stale.');
 if(JSON.stringify(walk(target))!==JSON.stringify([...paths,'manifest.json'].sort()))throw Error('Unexpected files in snapshot.');
 for(const p of paths)if(hash(safeFile(target,p))!==manifest.files[p].sha256)throw Error('Modified vendor file: '+p);
 console.log('Snapshot verified.');
}else{
 if(existsSync(target)&&(!existsSync(join(target,'manifest.json'))||lstatSync(target).isSymbolicLink()))throw Error('Refusing to replace a directory without a Dashboard Kit manifest.');
 mkdirSync(dirname(target),{recursive:true});
 const stage=mkdtempSync(join(dirname(target),'.dashboard-kit-'));
 try{
  for(const p of paths){const to=join(stage,p);mkdirSync(dirname(to),{recursive:true});copyFileSync(safeFile(root,p),to)}
  writeFileSync(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  rmSync(target,{recursive:true,force:true});renameSync(stage,target);
 }finally{rmSync(stage,{recursive:true,force:true})}
 console.log('Snapshot updated.');
}
