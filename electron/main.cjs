'use strict';
const { app, BrowserWindow, Menu, shell, session, dialog, protocol, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { NativeService } = require('./native-service.cjs');
const { installAssetSelection } = require('./asset-selection.cjs');
const { STUDIO_URL, sameDestination, createNativeHandler } = require('./native-protocol.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false
} }]);
let win = null, native = null, readyUrl = null, initialized = false, windowPromise = null;
let quitting = false, shutdownFinished = false, startup = true, failureShown = false;
const root = path.resolve(__dirname, '..');
const smokeMode = process.argv.includes('--studio-smoke-test');
if (smokeMode) {
  // CI gets an empty profile, never the user's autosaved project/preferences.
  app.setPath('userData', path.join(app.getPath('temp'), 'mistbridge-smoke-' + process.pid));
  app.disableHardwareAcceleration();
}
const send = command => { if (win && !win.isDestroyed()) win.webContents.send('studio-command', command); };

async function createWindow() {
  if (quitting) return;
  if (win && !win.isDestroyed()) { win.show(); return; }
  if (windowPromise) return windowPromise;
  windowPromise = (async () => {
    const created = new BrowserWindow({ width: 1536, height: 980, minWidth: 960, minHeight: 680,
      title: '雾桥 · Campaign Studio', backgroundColor: '#1e2229',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true } });
    win = created;
    created.on('closed', () => { if (win === created) win = null; });
    created.webContents.setWindowOpenHandler(({ url }) => {
      try { if (new URL(url).protocol === 'https:') void shell.openExternal(url); } catch {}
      return { action: 'deny' };
    });
    created.webContents.on('will-navigate', (event, url) => {
      try {
        if (!readyUrl || !sameDestination(url, readyUrl)) event.preventDefault();
      } catch { event.preventDefault(); }
    });
    if (readyUrl) await created.loadURL(readyUrl);
    else await created.loadFile(path.join(root, 'dist/index.html'));
  })();
  try { await windowPromise; } finally { windowPromise = null; }
}

async function showServiceFailure(error) {
  if (failureShown || quitting || startup) return;
  failureShown = true;
  readyUrl = null;
  // Preserve the open editor so an unsaved project can still be downloaded.
  await dialog.showMessageBox({ type: 'error', title: '原生服务已停止',
    message: '场景导入和导出暂时不可用。请先保存工程，然后重新启动应用。', detail: error.message });
}

async function startNative() {
  if (!app.isPackaged && process.env.STUDIO_DEV_URL) {
    const url = new URL(process.env.STUDIO_DEV_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password)
      throw new Error('STUDIO_DEV_URL must be a local HTTP development origin.');
    readyUrl = url.origin;
    return;
  }
  native = new NativeService({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, root });
  native.on('failure', error => { void showServiceFailure(error); });
  await native.start();
  // A stable standard/secure origin preserves autosave across launches even
  // though the private owned loopback port changes. CSP remains enforced.
  protocol.handle('studio', createNativeHandler(native));
  readyUrl = STUDIO_URL;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (initialized) void createWindow(); });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    try { await startNative(); }
    catch (error) {
      if (smokeMode) throw error;
      const result = await dialog.showMessageBox({ type: 'error', title: '无法启动原生服务',
        message: '本地场景转换服务无法启动。', detail: error.message,
        buttons: ['退出', '仅打开工程编辑器'], defaultId: 0, cancelId: 0 });
      if (result.response === 0) { app.quit(); return; }
      readyUrl = null;
    }
    installAssetSelection({ ipcMain, dialog, getWindow: () => win, getService: () => native });
    startup = false;
    await createWindow();
    initialized = true;
    installMenu();
    if (smokeMode) await desktopSmoke();
  }).catch(async error => {
    if (smokeMode) { console.error(error); await native?.stop(); app.exit(1); }
    else { dialog.showErrorBox('雾桥启动失败', error.message); app.quit(); }
  });
}

async function desktopSmoke() {
  if (!native || !readyUrl) throw new Error('Smoke test requires the bundled native service.');
  const check = async () => {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 10000;
      while (!document.querySelector('#root')?.children.length && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 100));
      const health = await fetch('/api/health').then(response => response.json());
      const lui = await fetch('/api/lui/status').then(response => response.json());
      return { rendered: !!document.querySelector('#root')?.children.length,
        bridge: typeof window.studio?.onCommand === 'function', health, lui };
    })()`);
    if (!result.rendered || !result.bridge || result.health.status !== 'ok') throw new Error('Packaged renderer smoke failed.');
    if (result.lui.configured !== false || result.lui.storage !== 'session-memory') throw new Error('Packaged LUI status smoke failed.');
  };
  await check();
  await win.webContents.executeJavaScript("localStorage.setItem('studio-smoke-continuity', 'ok')");
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  if (await win.webContents.executeJavaScript("localStorage.getItem('studio-smoke-continuity')") !== 'ok')
    throw new Error('Stable desktop origin did not preserve localStorage.');
  await check();
  let reopened = false;
  if (process.platform === 'darwin') {
    await new Promise(resolve => { win.once('closed', resolve); win.close(); });
    await createWindow();
    await check();
    reopened = true;
  }
  if (process.env.STUDIO_SMOKE_SCREENSHOT) {
    fs.writeFileSync(process.env.STUDIO_SMOKE_SCREENSHOT, (await win.capturePage()).toPNG());
  }
  console.log('STUDIO_APP_SMOKE ' + JSON.stringify({ ok: true, packaged: app.isPackaged,
    renderer: true, native: true, stableStorage: true, macCloseReopen: reopened, gameTested: false }));
  app.quit();
}

function installMenu() {
 const mac=process.platform==='darwin';
 const menu=[...(mac?[{label:app.name,submenu:[{label:'关于雾桥',click:()=>send('about')},{label:'大模型服务设置',accelerator:'CmdOrCtrl+,',click:()=>send('settings')},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}]:[]),{label:'文件',submenu:[{label:'新建地图',accelerator:'CmdOrCtrl+N',click:()=>send('new')},{label:'打开工程 / 场景',accelerator:'CmdOrCtrl+O',click:()=>send('open')},{label:'保存工程',accelerator:'CmdOrCtrl+S',click:()=>send('save')},{type:'separator'},{label:'导出场景',click:()=>send('export')},{label:'大模型服务设置',click:()=>send('settings')},...(mac?[]:[{type:'separator'},{role:'quit'}])]},{label:'编辑',submenu:[{label:'撤销场景编辑',accelerator:'CmdOrCtrl+Alt+Z',click:()=>send('undo')},{label:'重做场景编辑',click:()=>send('redo')},{type:'separator'},{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'视图',submenu:[{label:'适合窗口',click:()=>send('fit')},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'},...(!app.isPackaged?[{role:'toggleDevTools'}]:[])]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},...(mac?[{role:'front'}]:[])]},{label:'帮助',submenu:[{label:'关于与兼容性',click:()=>send('about')}]}];
 Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (shutdownFinished) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  Promise.resolve(native?.stop()).catch(error => console.error(error.message)).finally(() => {
    shutdownFinished = true;
    app.quit();
  });
});
app.on('activate', () => { if (initialized && !quitting) void createWindow(); });
