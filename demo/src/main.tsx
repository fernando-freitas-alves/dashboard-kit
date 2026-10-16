import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Dashboard,DashboardDialog,createHttpAdapter,type DashboardOptions,type EditorProps} from '@loadsmart/dashboard-kit';
import '@loadsmart/dashboard-kit/styles.css';
import './style.css';
import {createBrowserAdapter,starters} from './browserAdapter';
const browserDemo = import.meta.env.MODE === 'pages';
const base = import.meta.env.BASE_URL;

function Editor({chart,onSave,onClose}:EditorProps){
 const q=chart?.query?JSON.parse(chart.query):{metric:'revenue',group:'region'};
 const [title,setTitle]=useState(chart?.title||'Revenue by region');
 const [metric,setMetric]=useState(q.metric),[group,setGroup]=useState(q.group),[kind,setKind]=useState(chart?.kind||'hbar'),[error,setError]=useState('');
 return <DashboardDialog title={chart?'Edit chart':'Create a chart'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();if(!title.trim()){setError('Name your chart.');return;}onSave({id:chart?.id||crypto.randomUUID(),title:title.trim(),prompt:title.trim(),kind,query:JSON.stringify({metric,group}),mapping:{x:'label',y:'value',label:'label',value:'value'},status:'ready',createdAt:chart?.createdAt||Date.now(),updatedAt:Date.now()});}}>
 <div className="ldk-modal-body"><label>Chart title<input value={title} maxLength={160} onChange={e=>{setTitle(e.target.value);setError('')}}/></label>
 <div className="ldk-fields"><label>Measure<select value={metric} onChange={e=>setMetric(e.target.value)}>{['revenue','orders','tickets','satisfaction'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Group by<select value={group} onChange={e=>setGroup(e.target.value)}>{['month','channel','region','product','none'].map(x=><option key={x}>{x}</option>)}</select></label></div>
 <label>Chart type<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>{['bar','area','line','hbar','donut','kpi','table'].map(x=><option key={x}>{x}</option>)}</select></label>
 {error&&<p role="alert">{error}</p>}<p>Fictional sales data. No API key needed.</p></div>
 <footer className="editor-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save chart</button></footer></form></DashboardDialog>
}
async function boot(){
 let session={ai:false,csrf:''};
 if(!browserDemo){const r=await fetch('/api/session');if(!r.ok)throw Error('The demo server is unavailable. Start it with npm run demo.');session=await r.json();}
 const options:DashboardOptions={namespace:'dashboard-kit-demo:sales:v1:local',adapter:browserDemo?createBrowserAdapter():createHttpAdapter('/api/dashboards',{headers:()=>({'X-Dashboard-CSRF':session.csrf})}),
 starters,
 caption:browserDemo?'Fictional data · Saved in this browser':'Fictional data · Saved on this computer',aiDisclosure:browserDemo?'Starters use fixed chart definitions. Live AI requires the Python demo.':'With AI enabled, your prompt and the sample schema go to OpenAI. Data rows and credentials stay on the server.',
 palette:['#5b5bd6','#11a78f','#f59e0b','#df77b0','#6499e9'],features:{sharing:false},slots:{Editor}};
 function App(){const [dark,setDark]=useState(false);return <div data-theme={dark?"dark":"light"} className={`demo ${dark?'dark':'light'}`}><header className="site-header"><a href={base} className="wordmark"><img src={`${base}mark.svg`} alt=""/>dashboard<span>kit</span></a><div className="header-links"><span className="local-chip">{browserDemo?"Browser playground":"Local playground"}</span><button onClick={()=>setDark(!dark)}>{dark?'Light':'Dark'} theme</button><a href={`${base}guide.html`}>Integration guide ↗</a></div></header>
 <main><section className="intro"><div><p className="eyebrow">YOUR DATA. YOUR WORKSPACE.</p><h1>Make room for your next insight.</h1><p>Build a chart. Move it. Make it yours.</p></div><span className={`ai-state ${session.ai?'connected':''}`}><i/>{session.ai?'AI configured':'Manual mode'}</span></section>
 <section className="dashboard-shell" aria-label="Interactive dashboard"><Dashboard options={options}/></section>
 <footer className="demo-footer"><span>{browserDemo?"Changes stay in this browser. Export a board to keep a copy.":"React UI + Python backend. Bring your own data."}</span><span>Demo data is fictional. {browserDemo?<a href="https://github.com/fernando-freitas-alves/dashboard-kit/tree/main/demo#enable-ai">Run locally for live AI ↗</a>:session.ai?'AI uses your server key.':'Add an OpenAI key in demo/.env to try AI.'}</span></footer></main></div>}
 createRoot(document.getElementById('root')!).render(<App/>);
}
boot().catch(e=>{createRoot(document.getElementById('root')!).render(<main className="startup-error"><h1>{browserDemo?"Could not open the demo":"Start the demo server"}</h1><p>{e.message}</p><code>{browserDemo?"Allow site storage, then reload.":"npm run demo"}</code></main>)});
