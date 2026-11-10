const { app, BrowserWindow, ipcMain, protocol, net, session, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createService } = require('./core.cjs');
const { launchActivation, secondActivation, createNavigationQueue } = require('./deep-link.cjs');
const { projects, projectById, publicProject, rememberedId, chooseProject } = require('./projects.cjs');
const { externalUrl } = require('./links.cjs');
const { spaced } = require('./text.cjs');
const { readUsageFile, usageRequest } = require('./core/usage.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'teamspace', privileges: { standard: true, secure: true, supportFetchAPI: false } }]);
app.setName('Team Space');
let window, services = new Map(), activeId = 'fva', busy = false, inflight = 0, updatePreview = null;
let windowReady = false, focusPending = false;
const navigation = createNavigationQueue();
const pages = new Set(['/index.html', '/styles.css', '/renderer.js']);
function activeProject() { return projectById(activeId) || projectById('fva'); }
async function otherBindings(projectId, account) {
  const found = [];
  for (const project of projects) {
    if (project.id === projectId) continue;
    const other = services.get(project.id);
    if (typeof other?.binding !== 'function') continue;
    for (const boundPath of await other.binding(account)) found.push({ name: project.name, path: boundPath });
  }
  return found;
}
function readRemembered(userData) {
  try { return rememberedId(JSON.parse(fsSync.readFileSync(path.join(userData, 'active-project.json'), 'utf8'))); }
  catch { return 'fva'; }
}
async function rememberProject(userData, id) {
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(path.join(userData, 'active-project.json'), JSON.stringify({ id }) + '\n', { mode: 0o600 });
}
const mutators = new Set(['login', 'startWorkspace', 'submit', 'updateWorkspace', 'recoverWorkspace', 'bindWorkspace', 'applyUpdates', 'restoreUpdate', 'usageImport', 'usageSave']);
const usageFields = Object.freeze({ usageList: ['page'], usageDetail: ['number'], usageSave: ['title', 'tool', 'text'] });
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
  ipcMain.handle('team-space:projects', async (event, input) => {
    if (!trusted(event) || input !== undefined) return {ok:false,error:'不允许的页面请求。'};
    return {ok:true,value:{activeProject:activeProject().id,projects:projects.map(publicProject)}};
  });
  ipcMain.handle('team-space:selectProject', async (event, input) => {
    if (!trusted(event)) return {ok:false,error:'不允许的页面请求。'};
    if (busy || inflight > 0) return {ok:false,error:'正在处理上一项操作，请稍候再切换。'};
    const choice = chooseProject(input, false);
    if (!choice.ok) return {ok:false,error:choice.error};
    inflight += 1;
    try {
      if (choice.project.id !== activeId) {
        await rememberProject(app.getPath('userData'), choice.project.id);
        updatePreview = null;
        activeId = choice.project.id;
      }
      return {ok:true,value:{id:choice.project.id,name:choice.project.name}};
    } catch { return {ok:false,error:'没能记住要使用的 Skill，请重试。'}; }
    finally { inflight -= 1; }
  });
  for (const name of ['status','login','startWorkspace','bindWorkspace','changes','submit','openWorkspace','updateWorkspace','applyUpdates','restoreUpdate','recoverWorkspace','reviewStatus','openExternal','usageList','usageDetail','usageImport','usageSave','usageOpen']) {
    ipcMain.handle('team-space:' + name, async (event, input) => {
      if (!trusted(event)) return {ok:false,error:'不允许的页面请求。'};
      if (busy && !(name === 'openExternal' && input === 'device')) return {ok:false,error:'正在处理上一项操作，请稍候。'};
      const project = activeProject();
      const service = services.get(project.id);
      const sayProject = (before, after = '') => spaced(before, project.name, after);
      const mutate = mutators.has(name);
      if (mutate) busy = true;
      inflight += 1;
      try {
        let value;
        if (name === 'openExternal') {
          let url = externalUrl(project, input);
          if (input === 'pr') {
            const review = await service.reviewStatus();
            url = externalUrl(project, 'pr', review.url);
          }
          if (!url) throw new Error('这个链接暂时不可用。');
          await shell.openExternal(url); value = true;
        } else if (name === 'usageImport') {
          usageRequest(project, input, []);
          const selected = await dialog.showOpenDialog(window, {title:'选择聊天文本',properties:['openFile'],filters:[{name:'文本文件（Markdown 或 TXT）',extensions:['md','txt']}],buttonLabel:'导入文本'});
          if (selected.canceled || selected.filePaths.length !== 1) return {ok:true,value:null};
          value = { text: await readUsageFile(selected.filePaths[0]) };
        } else if (name === 'usageOpen') {
          usageRequest(project, input, ['number']);
          if (!Number.isSafeInteger(input.number) || input.number < 1) throw new Error('使用记录编号不正确。');
          const url = await service.usageOpen(input);
          if (url !== 'https://github.com/' + project.repo + '/issues/' + input.number) throw new Error('这个链接暂时不可用。');
          await shell.openExternal(url);
          value = true;
        } else if (Object.hasOwn(usageFields, name)) {
          usageRequest(project, input, usageFields[name]);
          value = await service[name](input);
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
          const selected = await dialog.showOpenDialog(window, {title:'选择正在使用的 SKILL.md',properties:['openFile'],filters:[{name:'Skill 说明文件（SKILL.md）',extensions:['md']}],buttonLabel:'选择这份 SKILL.md'});
          if(selected.canceled || selected.filePaths.length !== 1) return {ok:true,value:null};
          const skillPath = selected.filePaths[0];
          if (!path.isAbsolute(skillPath) || path.basename(skillPath).toLowerCase() !== 'skill.md') throw new Error('请选择正在使用的 SKILL.md 文件。');
          const skillFile = await fs.lstat(skillPath).catch(() => null);
          if (!skillFile?.isFile() || skillFile.isSymbolicLink()) throw new Error('请选择实际存在的 SKILL.md 文件，不能选择文件夹或快捷链接。');
          const directory = path.dirname(skillPath);
          const answer = await dialog.showMessageBox(window,{type:'question',title:'使用这份 Skill',message:'记住 SKILL.md 所在的文件夹？',detail:skillPath+'\n\nSkill 文件夹：'+directory+'\n\n以后照常在原来的工具中使用和修改。客户端会检查这个文件夹内的全部 Skill 改动，不只是 SKILL.md；确认发送后才会交给团队审核。选择文件不会搬动或改写现有内容。',buttons:['取消','使用这份 Skill'],defaultId:0,cancelId:0,noLink:true});
          if(answer.response!==1)return {ok:true,value:null};
          value=await service.bindWorkspace(directory);
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
          if (!current.workspace?.bound || current.workspace.id !== updatePreview.workspace.id || current.recoveryRequired) throw new Error(sayProject('', '文件夹或当前任务已变化，请回到工作台重新检查。'));
          const conflicts = updatePreview.files.filter(file => file.status === 'conflict');
          if (conflicts.some(file => !Object.hasOwn(choices, file.path)) || Object.keys(choices).some(name => !conflicts.some(file => file.path === name))) throw new Error('请为每个需要确认的文件选好用哪一份，再更新。');
          const selectedTeam = Object.values(choices).filter(choice => choice === 'team').length;
          const answer = await dialog.showMessageBox(window, {type:'question', title:sayProject('更新我的'), message:sayProject('先留一份备份，再更新正在使用的') + '？', detail:current.workspace.path + '\n\n需要你选择版本的文件：' + selectedTeam + ' 项用团队的，' + (conflicts.length - selectedTeam) + ' 项保留我的。\n请先保存文件，等更新完成后再继续修改。如果文件在检查后又变了，这次更新会停止。', buttons:['取消','备份并更新'], defaultId:0, cancelId:0, noLink:true});
          if (answer.response !== 1) throw new Error('已取消更新，使用中的文件保持原样。');
          value = await service.applyUpdates({previewId:input.previewId,resolutions:choices});
          updatePreview = null;
        } else if (name === 'restoreUpdate') {
          if (!input || typeof input.backupId !== 'string') throw new Error('请选择可恢复的更新备份。');
          const current = await service.status();
          if (current.lastBackup?.id !== input.backupId) throw new Error('备份已变化，请刷新工作台。');
          const answer = await dialog.showMessageBox(window, {type:'question', title:sayProject('恢复更新前的'), message:'将这次更新涉及的文件恢复到更新前？', detail:'备份时间：' + current.lastBackup.createdAt + '\n\n恢复前会检查文件。如果更新后又有修改，将停止恢复并保留现有文件。请在恢复完成前暂停编辑。', buttons:['取消','恢复更新前的文件'], defaultId:0, cancelId:0, noLink:true});
          if (answer.response !== 1) throw new Error('已取消恢复。');
          value = await service.restoreUpdate({backupId:input.backupId});
          updatePreview = null;
        } else if (name === 'recoverWorkspace') {
          const answer = await dialog.showMessageBox(window,{type:'question',title:'开始新一轮修改',message:'保留你的文件，重新准备一轮给团队的修改？',detail:sayProject('你正在使用的', '文件保持原样。') + '客户端会重新对照团队版本，检查这个文件夹的差别；旧的修改记录也会保留。等你选择文件并确认后，才会发给团队。',buttons:['取消','保留文件，开始新一轮'],defaultId:0,cancelId:0,noLink:true});
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
          const answer = await dialog.showMessageBox(window, {type:'question',title:'发给团队审核',message:input?.retry ? '继续发送上次没发完的修改，请团队审核？' : '将本次检查到的全部修改发给团队，请大家审核？',detail:title.slice(0,200) + '\n\n共 ' + count + ' 个文件。修改会通过 GitHub 发给团队，审核并采纳后才会进入团队正式版本。',buttons:['取消','发给团队审核'],defaultId:0,cancelId:0,noLink:true});
          if (answer.response !== 1) throw new Error('已取消提交，文件保持原样。');
          value = await service.submit(input.retry === true ? retryInput : input);
        } else value = await service[name]();
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          value.project = name === 'status' || name === 'login' ? { id: project.id, name: project.name } : project.id;
        }
        return {ok:true,value};
      } catch (error) { return {ok:false,error:safeError(error)}; }
      finally {
        inflight -= 1;
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
  const userData = app.getPath('userData');
  activeId = readRemembered(userData);
  services = new Map(projects.map((project) => [project.id, createService({
    root: path.join(userData, project.dataDir), gitPath, ghPath, project,
    bindings: (account) => otherBindings(project.id, account),
  })]));
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
