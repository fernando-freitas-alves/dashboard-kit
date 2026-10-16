import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync,symlinkSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=(args,cwd=root)=>execFileSync(process.execPath,args,{cwd,encoding:'utf8'});
test('packed frontend is compiled, importable without DOM, typed, and excludes local files',()=>{
 const sentinels=['frontend/.env.package-test','frontend/private.sqlite','frontend/dist/.env.package-test'];
 const temp=mkdtempSync(join(root,'.package-test-'));
 try{
  for(const p of sentinels)writeFileSync(join(root,p),'PACKAGE_TEST_SECRET');
  const [pack]=JSON.parse(execFileSync('npm',['pack','--workspace','@loadsmart/dashboard-kit','--ignore-scripts','--pack-destination',temp,'--json'],{cwd:root,encoding:'utf8'}));
  const files=pack.files.map(f=>f.path);
  assert(files.includes('dist/index.js'));assert(files.includes('dist/types/src/index.d.ts'));assert(files.includes('LICENSE'));assert(files.includes('THIRD_PARTY_NOTICES.md'));
  assert(!files.some(p=>/(\.env|sqlite|\.tsx?$|node_modules|docs\/media)/.test(p)&&!p.endsWith('.d.ts')));
  execFileSync('tar',['-xzf',join(temp,pack.filename),'-C',temp]);
  assert.match(run(['--input-type=module','-e',`const m=await import(${JSON.stringify(join(temp,'package/dist/index.js'))});if(!m.Dashboard||!m.createHttpAdapter)throw Error('Missing exports');console.log('ok')`]),/ok/);
  const assets=readFileSync(join(temp,'package/dist/geoAssets.js'),'utf8');
  assert(!assets.includes('?url'));assert(files.includes('dist/assets/countries-110m.json'));
 }finally{for(const p of sentinels)rmSync(join(root,p),{force:true});rmSync(temp,{recursive:true,force:true})}
});
test('source packages remain private until explicit release review',()=>{
 for(const p of ['package.json','frontend/package.json','node/package.json'])assert.equal(JSON.parse(readFileSync(join(root,p))).private,true);
});
function fixture(fn){const temp=mkdtempSync(join(tmpdir(),'dashboard-vendor-'));try{
 const source=join(temp,'source');mkdirSync(join(source,'scripts'),{recursive:true});mkdirSync(join(source,'frontend'));
 copyFileSync(join(root,'scripts/vendor.mjs'),join(source,'scripts/vendor.mjs'));
 writeFileSync(join(source,'frontend/index.js'),'export const ok=true;');writeFileSync(join(source,'distribution-files.json'),'["frontend/index.js"]');
 fn({temp,source,consumer:join(temp,'consumer'),vendor:(...args)=>spawnSync(process.execPath,[join(source,'scripts/vendor.mjs'),...args],{encoding:'utf8'})});
 }finally{rmSync(temp,{recursive:true,force:true})}}
test('vendor allowlist excludes secrets and databases, verifies extra files and tampering',()=>fixture(({source,consumer,vendor})=>{
 writeFileSync(join(source,'frontend/.env'),'SECRET');writeFileSync(join(source,'frontend/data.sqlite'),'PRIVATE');
 assert.equal(vendor(consumer).status,0);assert.equal(vendor('--check',consumer).status,0);
 const output=join(consumer,'vendor/dashboard-kit');writeFileSync(join(output,'.env'),'EXTRA');assert.notEqual(vendor('--check',consumer).status,0);rmSync(join(output,'.env'));
 writeFileSync(join(output,'frontend/index.js'),'tampered');assert.notEqual(vendor('--check',consumer).status,0);
}));
test('vendor rejects source symlinks and traversal',()=>fixture(({temp,source,consumer,vendor})=>{
 const file=join(source,'frontend/index.js');rmSync(file);symlinkSync(join(temp,'secret'),file);writeFileSync(join(temp,'secret'),'private');
 assert.notEqual(vendor(consumer).status,0);
 writeFileSync(join(source,'distribution-files.json'),'["../secret"]');assert.notEqual(vendor(consumer).status,0);
}));
test('vendor never replaces an unrelated directory or follows destination symlinks',()=>fixture(({temp,consumer,vendor})=>{
 const output=join(consumer,'vendor/dashboard-kit');mkdirSync(output,{recursive:true});writeFileSync(join(output,'mine'),'keep');
 assert.notEqual(vendor(consumer).status,0);assert.equal(readFileSync(join(output,'mine'),'utf8'),'keep');
 rmSync(join(consumer,'vendor'),{recursive:true});const outside=join(temp,'outside');mkdirSync(outside);symlinkSync(outside,join(consumer,'vendor'));
 assert.notEqual(vendor(consumer).status,0);
}));
