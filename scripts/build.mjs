import {build} from 'esbuild';
import {rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const front = resolve(root, 'frontend');
rmSync(resolve(front, 'dist'), {recursive:true, force:true});
await build({absWorkingDir:front,entryPoints:{index:'src/index.tsx',grid:'src/board/gridSizes.ts',geoAssets:'src/board/geoAssets.ts'},outdir:'dist',bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',packages:'external',jsx:'automatic',banner:{js:'"use client";'},chunkNames:'chunks/[name]-[hash]'});
await build({absWorkingDir:front,entryPoints:['src/styles.css'],outfile:'dist/styles.css',bundle:true,minify:true});
mkdirSync(resolve(front, 'dist/assets'),{recursive:true});
for(const [pkg,file] of [['world-atlas','countries-110m.json'],['us-atlas','states-10m.json']]) copyFileSync(resolve(root,'node_modules',pkg,file),resolve(front,'dist/assets',file));
execFileSync(resolve(root,'node_modules/.bin/tsc'),['-p',resolve(front,'tsconfig.json')],{stdio:'inherit'});

// Inventory only fresh build outputs and reviewed backend source files.
const inventoryPath=resolve(root,'distribution-files.json');
const backend=JSON.parse(readFileSync(inventoryPath,'utf8')).filter(p=>!p.startsWith('frontend/'));
function built(dir,prefix='frontend/dist') {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?built(resolve(dir,e.name),prefix+'/'+e.name):[prefix+'/'+e.name]);}
const metadata=['LICENSE','README.md','THIRD_PARTY_NOTICES.md','package.json'].map(p=>'frontend/'+p);
writeFileSync(inventoryPath,JSON.stringify([...metadata,...built(resolve(front,'dist')),...backend].sort(),null,2)+'\n');
