import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const found=new Map();
function visit(name,from){
 const req=createRequire(resolve(from,'package.json'));
 let path;try{path=req.resolve(name+'/package.json')}catch{let d=dirname(req.resolve(name));while(!existsSync(resolve(d,'package.json')))d=dirname(d);path=resolve(d,'package.json')}
 const dir=dirname(path),pkg=JSON.parse(readFileSync(path,'utf8')),id=`${pkg.name}@${pkg.version}`;
 if(found.has(id))return;
 const licenseFiles=readdirSync(dir).filter(n=>/^(licen[cs]e|copying|notice|copyright)(\.|$)/i.test(n));
 if(!licenseFiles.length)throw Error('Missing license text: '+id);
 found.set(id,{pkg,text:licenseFiles.map(n=>readFileSync(resolve(dir,n),'utf8')).join('\n\n')});
 for(const dep of Object.keys(pkg.dependencies||{}))visit(dep,dir);
}
const front=JSON.parse(readFileSync(resolve(root,'frontend/package.json'),'utf8'));
for(const dep of Object.keys({...front.dependencies,...front.peerDependencies}))visit(dep,resolve(root,'frontend'));
const body='# Third-party notices\n\nDashboard Kit is MIT licensed. The following notices cover its JavaScript runtime dependencies and distributed map assets. Dependency code remains under its respective license.\n\nMap data: world-atlas uses Natural Earth public-domain data; us-atlas uses U.S. Census Bureau geographic data. The package notices below apply to their distribution tooling.\n\n'+[...found].sort(([a],[b])=>a.localeCompare(b)).map(([id,{pkg,text}])=>`## ${id}\n\nLicense: ${pkg.license||'See text below'}\n\n\`\`\`text\n${text.trim()}\n\`\`\`\n`).join('\n');
writeFileSync(resolve(root,'THIRD_PARTY_NOTICES.md'),body);writeFileSync(resolve(root,'frontend/THIRD_PARTY_NOTICES.md'),body);console.log('Included notices for',found.size,'runtime packages.');
