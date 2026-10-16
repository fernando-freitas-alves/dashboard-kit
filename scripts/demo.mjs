import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
execFileSync('npm',['run','build'],{cwd:root,stdio:'inherit'});
const children=[spawn('uv',['run','--project','demo/server','python','demo/server/app.py'],{cwd:root,stdio:'inherit'}),spawn('npm',['run','dev','-w','dashboard-kit-demo'],{cwd:root,stdio:'inherit'})];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const p of children)p.kill('SIGTERM');process.exitCode=code;}
for(const p of children){p.on('error',e=>{console.error(e.message);stop(1)});p.on('exit',code=>{if(!stopping)stop(code||0)})}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
console.log('\nDashboard Kit demo: http://127.0.0.1:8781 (local only)\n');
