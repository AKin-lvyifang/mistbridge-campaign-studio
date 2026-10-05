const { contextBridge,ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('studio',{platform:process.platform,onCommand:(callback)=>{const listener=(_event,command)=>callback(command);ipcRenderer.on('studio-command',listener);return()=>ipcRenderer.removeListener('studio-command',listener)}});
