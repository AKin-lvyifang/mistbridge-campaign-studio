const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installAssetSelection } = require('./asset-selection.cjs');
function harness(dialogResult, transport) {
 let handler;const frame={url:'studio://app/'};const contents={mainFrame:frame};
 installAssetSelection({ipcMain:{handle(_name,fn){handler=fn;}},dialog:{async showOpenDialog(){return dialogResult;}},getWindow:()=>({webContents:contents}),getService:()=>({origin:'http://127.0.0.1:9000',token:'private'}),transport});
 return { call:()=>handler({sender:contents,senderFrame:frame}),bad:()=>handler({sender:{},senderFrame:frame}) };
}
test('cancel does not transmit a directory or change status',async()=>{
 const h=harness({canceled:true,filePaths:[]},()=>{throw Error('must not fetch');});
 assert.deepEqual(await h.call(),{cancelled:true});
});
test('only main window can open picker',async()=>{
 const h=harness({canceled:true,filePaths:[]},()=>{throw Error('must not fetch');});
 assert.match((await h.bad()).error,/主窗口/);
});
test('selected absolute directory stays between main and owned service',async()=>{
 let request;const h=harness({canceled:false,filePaths:['/private/user/game']},async(url,options)=>{request={url,options};return {ok:true,json:async()=>({mounted:true,counts:{dds:1}})};});
 const result=await h.call();assert.equal(result.status.mounted,true);assert(!JSON.stringify(result).includes('/private/'));
 assert.equal(request.options.headers['X-Studio-Asset-Selection'],'dialog');assert.equal(request.options.headers['X-Studio-Instance'],'private');
 assert.equal(JSON.parse(request.options.body).directory,'/private/user/game');
});
