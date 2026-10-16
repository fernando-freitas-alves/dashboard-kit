import {defineConfig} from 'vite';
export default defineConfig(({mode})=>({base:mode==='pages'?'./':'/',server:{host:'127.0.0.1',port:8781,strictPort:true,proxy:{'/api':'http://127.0.0.1:8782'}},build:{target:'es2022'}}));
