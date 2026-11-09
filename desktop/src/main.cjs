const { app, BrowserWindow, ipcMain, protocol, net, session, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createService } = require('./core.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'teamspace', privileges: { standard: true, secure: true, supportFetchAPI: false } }]);
app.setName('Team Space');
let window, service, busy = false;
const pages = new Set(['/index.html', '/styles.css', '/renderer.js']);
const external = Object.freeze({
  repository: 'https://github.com/i010542/fva',
  skill: 'https://github.com/i010542/fva/blob/main/SKILL.md',
  install: 'https://github.com/i010542/fva/blob/main/INSTALL.md',
  structure: 'https://github.com/i010542/fva/blob/main/STRUCTURE.md',
  changelog: 'https://github.com/i010542/fva/blob/main/CHANGELOG.md',
  device: 'https://github.com/login/device'
});
const mutators = new Set(['login', 'startWorkspace', 'submit', 'updateWorkspace', 'recoverWorkspace']);
function safeError(error) {
  return String(error?.message || '操作未完成，请重试。')
    .replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[已隐藏]')
    .replace(/(authorization\s*[:=]\s*)([^\r\n]+)/gi, '$1[已隐藏]').slice(0, 1200);
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'teamspace:' && url.host === 'workspace' && url.pathname === '/index.html' && url.search === '';
  } catch { return false; }
}
function wire() {
  for (const name of ['status','login','startWorkspace','changes','submit','openWorkspace','updateWorkspace','recoverWorkspace','reviewStatus','openExternal']) {
    ipcMain.handle('team-space:' + name, async (event, input) => {
      if (!trusted(event)) return {ok:false,error:'不允许的页面请求。'};
      if (busy && !(name === 'openExternal' && input === 'device')) return {ok:false,error:'正在处理上一项操作，请稍候。'};
      const mutate = mutators.has(name);
      if (mutate) busy = true;
      try {
        let value;
        if (name === 'openExternal') {
          let url = typeof input === 'string' && Object.hasOwn(external,input) ? external[input] : null;
          if (input === 'pr') {
            const review = await service.reviewStatus();
            if (/^https:\/\/github\.com\/i010542\/fva\/pull\/[1-9]\d*$/.test(review.url || '')) url = review.url;
          }
          if (!url) throw new Error('这个链接暂时不可用。');
          await shell.openExternal(url); value = true;
        } else if (name === 'openWorkspace') {
          const directory = await service.openWorkspace();
          const result = await shell.openPath(directory);
          if (result) throw new Error('无法打开工作文件夹。');
          value = true;
        } else if (name === 'login') {
          value = await service.login(progress => {
            if (!window?.isDestroyed()) window.webContents.send('team-space:progress', progress);
          });
        } else if (name === 'recoverWorkspace') {
          const answer = await dialog.showMessageBox(window,{type:'question',title:'保留旧文件并另开任务',message:'保留当前文件夹，并从团队最新版本准备一个新任务？',detail:'旧文件和本地提交都会保留，但不会自动复制到新文件夹，也不会自动发送到 GitHub。需要的修改请稍后从旧文件夹中挑选复制。',buttons:['取消','保留文件，另开任务'],defaultId:0,cancelId:0,noLink:true});
          if(answer.response!==1)throw new Error('已取消，继续保留当前任务。');
          value=await service.recoverWorkspace();
        } else if (name === 'submit') {
          let title, count, retryInput;
          if (input?.retry === true) {
            const current = await service.status();
            if (!current.workspace?.pending) throw new Error('没有需要继续的提交，请刷新改动。');
            title = current.workspace.pendingTitle || '继续上次提交';
            count = current.workspace.pendingFiles?.length || 0;
            retryInput = {retry:true,workspaceId:current.workspace.id,pendingId:current.workspace.pendingId};
          } else {
            if (!input || typeof input.title !== 'string' || !Array.isArray(input.files) || input.files.length > 100 || typeof input.previewId !== 'string') throw new Error('请先刷新改动并填写修改说明。');
            title = input.title; count = input.files.length;
          }
          const answer = await dialog.showMessageBox(window, {type:'question',title:'提交审核',message:input?.retry ? '继续将上次提交发送到 GitHub 并发起审核？' : '将选中的修改提交到你的个人分支，并发起审核？',detail:title.slice(0,200) + '\n\n共 ' + count + ' 个文件；不会直接修改正式版本。',buttons:['取消','提交审核'],defaultId:0,cancelId:0,noLink:true});
          if (answer.response !== 1) throw new Error('已取消提交，文件保持原样。');
          value = await service.submit(input.retry === true ? retryInput : input);
        } else value = await service[name]();
        return {ok:true,value};
      } catch (error) { return {ok:false,error:safeError(error)}; }
      finally { if (mutate) busy = false; }
    });
  }
}
async function start() {
  const toolsRoot = app.isPackaged ? path.join(process.resourcesPath,'tools') : path.join(__dirname,'..','vendor');
  // Packaged apps never depend on a colleague's PATH or global Git installation.
  const gitPath = path.join(toolsRoot,'git','cmd','git.exe');
  const ghPath = path.join(toolsRoot,'gh','bin','gh.exe');
  service = createService({root:path.join(app.getPath('userData'),'workspaces'),gitPath,ghPath});
  protocol.handle('teamspace', request => {
    const u = new URL(request.url);
    if (u.hostname !== 'workspace' || !pages.has(u.pathname) || request.method !== 'GET') return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(__dirname,u.pathname.slice(1))).href);
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  wire();
  window = new BrowserWindow({width:1180,height:820,minWidth:900,minHeight:650,title:'团队共创空间',icon:path.join(__dirname,'..','assets','icon.png'),backgroundColor:'#f6f8fc',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.on('will-attach-webview', e => e.preventDefault());
  window.once('ready-to-show',()=>window.show());
  await window.loadURL('teamspace://workspace/index.html');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{ if(window){if(window.isMinimized())window.restore();window.focus();} });
  app.whenReady().then(start).catch(error=>{dialog.showErrorBox('无法启动团队共创空间',safeError(error));app.quit();});
  app.on('window-all-closed',()=>app.quit());
}
