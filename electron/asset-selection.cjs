'use strict';
const { isStudioUrl } = require('./native-protocol.cjs');
function installAssetSelection({ ipcMain, dialog, getWindow, getService, transport = fetch }) {
  let choosing = false;
  ipcMain.handle('studio-select-asset-directory', async event => {
    const win = getWindow(), service = getService();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isStudioUrl(event.senderFrame.url))
      return { error: '只能在本地桌面主窗口选择素材目录。' };
    if (!service?.origin || service.failure || service.stopping)
      return { error: '本地素材服务未连接，请重新启动桌面应用。' };
    if (choosing) return { error: '目录选择或扫描正在进行。' };
    choosing = true;
    try {
      const choice = await dialog.showOpenDialog(win, { title: '选择你有权使用的 AoE2 DE 或模组资源目录',
        message: '只读扫描 DDS / SLD / DAT。素材仅留在本机，不上传、不加入工程导出。',
        properties: ['openDirectory', 'dontAddToRecent'] });
      if (choice.canceled || choice.filePaths.length !== 1) return { cancelled: true };
      const result = await transport(service.origin + '/api/assets/mount', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-Instance': service.token,
                   Origin: service.origin, 'X-Studio-Asset-Selection': 'dialog' },
        body: JSON.stringify({ directory: choice.filePaths[0] }), redirect: 'error', signal: AbortSignal.timeout(25000) });
      const status = await result.json();
      if (!result.ok) return { error: typeof status.detail === 'string' ? status.detail : '目录扫描未完成。' };
      return { status }; // Never return the absolute host path to renderer or project data.
    } catch { return { error: '目录扫描未完成，请重试或选择较小的素材目录。' }; }
    finally { choosing = false; }
  });
}
module.exports = { installAssetSelection };
