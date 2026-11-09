const { app, BrowserWindow, ipcMain, protocol, net, session, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createService } = require('./core.cjs');
const { launchActivation, secondActivation, createNavigationQueue } = require('./deep-link.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'teamspace', privileges: { standard: true, secure: true, supportFetchAPI: false } }]);
app.setName('Team Space');
let window, service, busy = false, updatePreview = null;
let windowReady = false, focusPending = false;
const navigation = createNavigationQueue();
const pages = new Set(['/index.html', '/styles.css', '/renderer.js']);
const external = Object.freeze({
  repository: 'https://github.com/i010542/fva',
  branches: 'https://github.com/i010542/fva/branches',
  pulls: 'https://github.com/i010542/fva/pulls',
  issues: 'https://github.com/i010542/fva/issues',
  skill: 'https://github.com/i010542/fva/blob/main/SKILL.md',
  install: 'https://github.com/i010542/fva/blob/main/INSTALL.md',
  structure: 'https://github.com/i010542/fva/blob/main/STRUCTURE.md',
  changelog: 'https://github.com/i010542/fva/blob/main/CHANGELOG.md',
  device: 'https://github.com/login/device',
  portal: 'https://i010542.github.io/team-space/',
  portalFva: 'https://i010542.github.io/team-space/projects/fva/',
  portalDocs: 'https://i010542.github.io/team-space/docs/'
});
const mutators = new Set(['login', 'startWorkspace', 'submit', 'updateWorkspace', 'recoverWorkspace', 'bindWorkspace', 'applyUpdates', 'restoreUpdate']);
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
function flushNavigation() {
  if (!windowReady || busy || !window || window.isDestroyed()) return;
  if (focusPending) {
    focusPending = false;
    if (window.isMinimized()) window.restore();
    window.focus();
  }
  if (navigation.pending) window.webContents.send('team-space:navigation');
}
function wire() {
  ipcMain.handle('team-space:takeNavigation', async (event, input) => {
    if (!trusted(event) || input !== undefined) return {ok:false,error:'不允许的导航请求。'};
    return {ok:true,value:busy ? null : navigation.take()};
  });
  for (const name of ['status','login','startWorkspace','bindWorkspace','changes','submit','openWorkspace','updateWorkspace','applyUpdates','restoreUpdate','recoverWorkspace','reviewStatus','openExternal']) {
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
        } else if (name === 'bindWorkspace') {
          const selected = await dialog.showOpenDialog(window, {title:'选择正在使用的 FVA 文件夹（直接包含 SKILL.md）',properties:['openDirectory'],buttonLabel:'选择这份 FVA'});
          if(selected.canceled || selected.filePaths.length !== 1) return {ok:true,value:null};
          const answer = await dialog.showMessageBox(window,{type:'question',title:'记住我的 FVA 文件夹',message:'以后都从这个文件夹查看你的修改？',detail:selected.filePaths[0]+'\n\n你继续在原来的工具里使用和修改这份 FVA。这里会记住它的位置，先与团队版本比较；等你选好文件并确认后，才会发给团队审核。选择文件夹不会搬动或改写其中的文件。',buttons:['取消','使用这个文件夹'],defaultId:0,cancelId:0,noLink:true});
          if(answer.response!==1)return {ok:true,value:null};
          value=await service.bindWorkspace(selected.filePaths[0]);
        } else if (name === 'updateWorkspace') {
          updatePreview = null;
          value = await service.updateWorkspace();
          if (value.previewId) updatePreview = value;
        } else if (name === 'applyUpdates') {
          if (!input || typeof input.previewId !== 'string' || !updatePreview || input.previewId !== updatePreview.previewId) throw new Error('更新预览已过期，请重新检查团队更新。');
          if (!updatePreview.canApply) throw new Error(updatePreview.blockedReason || '当前不能应用更新。');
          const choices = input.resolutions;
          if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).length > 500 || Object.values(choices).some(choice => choice !== 'mine' && choice !== 'team')) throw new Error('有些文件需要你确认，请逐个选择用哪一份。');
          const current = await service.status();
          if (!current.workspace?.bound || current.workspace.id !== updatePreview.workspace.id || current.recoveryRequired) throw new Error('FVA 文件夹或当前任务已变化，请回到工作台重新检查。');
          const conflicts = updatePreview.files.filter(file => file.status === 'conflict');
          if (conflicts.some(file => !Object.hasOwn(choices, file.path)) || Object.keys(choices).some(name => !conflicts.some(file => file.path === name))) throw new Error('请为每个需要确认的文件选好用哪一份，再更新。');
          const selectedTeam = Object.values(choices).filter(choice => choice === 'team').length;
          const answer = await dialog.showMessageBox(window, {type:'question', title:'更新我的 FVA', message:'先留一份备份，再更新正在使用的 FVA？', detail:current.workspace.path + '\n\n需要你选择版本的文件：' + selectedTeam + ' 项用团队的，' + (conflicts.length - selectedTeam) + ' 项保留我的。\n请先保存文件，等更新完成后再继续修改。如果文件在检查后又变了，这次更新会停止。', buttons:['取消','备份并更新'], defaultId:0, cancelId:0, noLink:true});
          if (answer.response !== 1) throw new Error('已取消更新，使用中的文件保持原样。');
          value = await service.applyUpdates({previewId:input.previewId,resolutions:choices});
          updatePreview = null;
        } else if (name === 'restoreUpdate') {
          if (!input || typeof input.backupId !== 'string') throw new Error('请选择可恢复的更新备份。');
          const current = await service.status();
          if (current.lastBackup?.id !== input.backupId) throw new Error('备份已变化，请刷新工作台。');
          const answer = await dialog.showMessageBox(window, {type:'question', title:'恢复更新前的 FVA', message:'将这次更新涉及的文件恢复到更新前？', detail:'备份时间：' + current.lastBackup.createdAt + '\n\n恢复前会检查文件。如果更新后又有修改，将停止恢复并保留现有文件。请在恢复完成前暂停编辑。', buttons:['取消','恢复更新前的文件'], defaultId:0, cancelId:0, noLink:true});
          if (answer.response !== 1) throw new Error('已取消恢复。');
          value = await service.restoreUpdate({backupId:input.backupId});
          updatePreview = null;
        } else if (name === 'recoverWorkspace') {
          const answer = await dialog.showMessageBox(window,{type:'question',title:'开始新一轮修改',message:'保留你的文件，重新准备一轮给团队的修改？',detail:'你正在使用的 FVA 文件保持原样。客户端会重新对照团队版本，检查这个文件夹的差别；旧的修改记录也会保留。等你选择文件并确认后，才会发给团队。',buttons:['取消','保留文件，开始新一轮'],defaultId:0,cancelId:0,noLink:true});
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
          const answer = await dialog.showMessageBox(window, {type:'question',title:'发给团队审核',message:input?.retry ? '继续发送上次没发完的修改，请团队审核？' : '将选中的修改发给团队，请大家审核？',detail:title.slice(0,200) + '\n\n共 ' + count + ' 个文件。修改会通过 GitHub 发给团队，审核并采纳后才会进入团队正式版本。',buttons:['取消','发给团队审核'],defaultId:0,cancelId:0,noLink:true});
          if (answer.response !== 1) throw new Error('已取消提交，文件保持原样。');
          value = await service.submit(input.retry === true ? retryInput : input);
        } else value = await service[name]();
        return {ok:true,value};
      } catch (error) { return {ok:false,error:safeError(error)}; }
      finally {
        if (mutate) {
          busy = false;
          flushNavigation();
        }
      }
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
  windowReady = true;
  flushNavigation();
}
const initialActivation = launchActivation(process.argv, process.defaultApp);
if (!app.requestSingleInstanceLock(initialActivation)) app.quit();
else {
  navigation.enqueue(initialActivation.navigation);
  // Chromium can reorder or append arguments in second-instance. The new
  // process validates its original argv before handing us this enum.
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    const activation = secondActivation(data);
    if (!activation) return;
    navigation.enqueue(activation.navigation);
    focusPending = true;
    flushNavigation();
  });
  app.whenReady().then(start).catch(error=>{dialog.showErrorBox('无法启动团队共创空间',safeError(error));app.quit();});
  app.on('window-all-closed',()=>app.quit());
}
