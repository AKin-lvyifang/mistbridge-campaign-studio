const { app, BrowserWindow, Menu, shell, session }=require('electron');
const { spawn }=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
let win=null,server=null,serverFailed=false,readyUrl=null;
const root=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
const origin='http://127.0.0.1:8787';
const python=process.env.STUDIO_PYTHON || path.join(root,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const send=command=>{if(win&&!win.isDestroyed())win.webContents.send('studio-command',command)};
async function createWindow(){
 win=new BrowserWindow({width:1536,height:980,minWidth:960,minHeight:680,title:'雾桥 · Campaign Studio',backgroundColor:'#1e2229',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.on('closed',()=>{win=null});
 win.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https:'))void shell.openExternal(url);return{action:'deny'}});
 win.webContents.on('will-navigate',(event,url)=>{const allowed=readyUrl?new URL(url).origin===new URL(readyUrl).origin:url.startsWith('file:');if(!allowed)event.preventDefault();});
 if(readyUrl)await win.loadURL(readyUrl);else await win.loadFile(path.join(__dirname,'../dist/index.html'));
}
async function startNative(){
 if(process.env.STUDIO_DEV_URL){const u=new URL(process.env.STUDIO_DEV_URL);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.protocol!=='http:')throw Error('STUDIO_DEV_URL must be a local HTTP development origin.');readyUrl=u.toString();return;}
 // This source/developer shell does not pretend to contain a bundled Python runtime.
 if(!fs.existsSync(python)){console.warn('Native runtime missing; opening editor-only mode. Set STUDIO_PYTHON or install .venv.');return;}
 // Do not attach to arbitrary existing servers on the chosen port.
 try{await fetch(origin+'/api/health',{signal:AbortSignal.timeout(500)});console.error('Native port is already occupied. Refusing to reuse an unowned local service.');return;}catch{}
 server=spawn(python,['-m','uvicorn','server.app:app','--host','127.0.0.1','--port','8787'],{cwd:root,stdio:['ignore','pipe','pipe']});
 server.on('error',e=>{serverFailed=true;console.error('Native service failed:',e.message)});
 server.on('exit',()=>{serverFailed=true});server.stderr.on('data',d=>process.stderr.write(d));
 for(let i=0;i<40&&!serverFailed;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(500)});const h=await r.json();if(r.ok&&h.status==='ok'&&h.parserVersion==='0.9.4'&&h.isolatedWorkers===true){readyUrl=origin;return;}}catch{}await new Promise(r=>setTimeout(r,200));}
 console.error('Native service did not become ready; continuing in editor-only mode.');
}
app.whenReady().then(async()=>{
 session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 await startNative();await createWindow();
 const mac=process.platform==='darwin';
 const menu=[...(mac?[{label:app.name,submenu:[{label:'关于雾桥',click:()=>send('about')},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}]:[]),{label:'文件',submenu:[{label:'新建地图',accelerator:'CmdOrCtrl+N',click:()=>send('new')},{label:'打开工程 / 场景',accelerator:'CmdOrCtrl+O',click:()=>send('open')},{label:'保存工程',accelerator:'CmdOrCtrl+S',click:()=>send('save')},{type:'separator'},{label:'导出场景',click:()=>send('export')},...(mac?[]:[{type:'separator'},{role:'quit'}])]},{label:'编辑',submenu:[{label:'撤销场景编辑',accelerator:'CmdOrCtrl+Alt+Z',click:()=>send('undo')},{label:'重做场景编辑',click:()=>send('redo')},{type:'separator'},{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'视图',submenu:[{label:'适合窗口',click:()=>send('fit')},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'},...(!app.isPackaged?[{role:'toggleDevTools'}]:[])]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},...(mac?[{role:'front'}]:[])]},{label:'帮助',submenu:[{label:'关于与兼容性',click:()=>send('about')}]}];
 Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('before-quit',()=>server?.kill());
app.on('activate',()=>{if(app.isReady()){if(!win||win.isDestroyed())void createWindow();else win.show();}});
