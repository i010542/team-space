const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');

async function harness({ argv = ["Team Space.exe"], holdLoad = false, userData, serviceMap } = {}) {
  const calls = { apply: [], restore: [], dialogs: [], open: [], notifications: [], focus: 0, restored: 0, updates: 0, bindings: [], pickers: [] };
  const events = new Map();
  let finishLoad;
  const loading = holdLoad ? new Promise(resolve => { finishLoad = resolve; }) : Promise.resolve();
  let releaseUpdate;
  let updateGate;
  const handlers = new Map();
  const workspace = { id: 'test-workspace', bound: true, path: 'C:\\Synthetic\\fva' };
  const preview = { previewId: 'test-preview', canApply: true, workspace,
    files: [{ path: 'SKILL.md', status: 'conflict' }] };
  const status = { workspace, lastBackup: { id: 'test-backup', createdAt: '2026-11-09T00:00:00Z' } };
  const service = {
    status: async () => status,
    bindWorkspace: async directory => { calls.bindings.push(directory); return {...workspace,path:directory}; },
    updateWorkspace: async () => { calls.updates++; await updateGate; return preview; },
    applyUpdates: async (input) => { calls.apply.push(input); return { workspace }; },
    restoreUpdate: async (input) => { calls.restore.push(input); return { workspace }; },
  };
  let win;
  const electron = {
    app: { setName() {}, requestSingleInstanceLock(data) { calls.activation = data; return true; },
      on: (name, callback) => events.set(name, callback),
      whenReady: () => Promise.resolve(), getPath: () => userData || 'C:\\Synthetic', quit() {} },
    BrowserWindow: class {
      constructor() { win = this; this.webContents = {
        mainFrame: { url: 'teamspace://workspace/index.html' },
        setWindowOpenHandler() {}, on() {}, send: (...args) => calls.notifications.push(args),
      }; }
      once() {} async loadURL() { await loading; } isDestroyed() { return false; }
      isMinimized() { return true; } restore() { calls.restored++; } focus() { calls.focus++; }
    },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, net: {}, shell: { async openExternal(url) { calls.open.push(url); } },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    dialog: { response: 1, selection: {canceled:true,filePaths:[]}, showErrorBox() {},
      async showOpenDialog(_window, options) { calls.pickers.push(options); return this.selection; }, async showMessageBox(_window, data) {
      calls.dialogs.push(data); return { response: this.response };
    } },
  };
  const filename = path.join(__dirname, '../src/main.cjs');
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    require: (name) => name === 'electron' ? electron : name === './core.cjs' ? { createService: (options) => serviceMap?.[options?.project?.id] || service } :
      name.startsWith('./') ? require(path.join(path.dirname(filename), name)) : require(name),
    __dirname: path.dirname(filename), process: { resourcesPath: 'C:\\Synthetic', argv }, URL, Response,
  }, { filename });
  await new Promise(resolve => setImmediate(resolve));
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const invoke = (name, input, sender = event) => handlers.get('team-space:' + name)(sender, input);
  return {
    calls, preview, status, electron, event, invoke,
    async finishLoad() { finishLoad(); await new Promise(resolve => setImmediate(resolve)); },
    second(args, data) { events.get('second-instance')({}, args, 'C:\\Synthetic', data); },
    holdUpdate() { updateGate = new Promise(resolve => { releaseUpdate = resolve; }); return releaseUpdate; },
  };
}

test('usage IPC only reads the native file selection, requires the active project, and opens fixed issue links', async (t) => {
  const dir = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'team-space-usage-picker-'));
  const filename = path.join(dir, 'chat.txt');
  await fs.writeFile(filename, '导入的示例聊天', 'utf8');
  t.after(async () => { await fs.unlink(filename); await fs.rmdir(dir); });
  const writes = [];
  let target = 'https://github.com/i010542/fva/issues/12';
  const h = await harness({ serviceMap: { fva: {
    usageSave: async input => { writes.push(input); return { number: 12 }; },
    usageOpen: async () => target,
  } } });
  assert.equal((await h.invoke('usageImport', { project: 'fva', filename })).ok, false);
  assert.equal(h.calls.pickers.length, 0);
  assert.equal((await h.invoke('usageImport', { project: 'fva' })).value, null);
  h.electron.dialog.selection = { canceled: false, filePaths: [filename] };
  const imported = await h.invoke('usageImport', { project: 'fva' });
  assert.equal(imported.ok, true);
  assert.equal(imported.value.text, '导入的示例聊天');
  assert.equal(imported.value.project, 'fva');
  assert.equal(writes.length, 0);
  const draft = { project: 'fva', title: '示例', tool: '', text: imported.value.text };
  assert.equal((await h.invoke('usageSave', { ...draft, project: 'ugc-reference-ad-workflow' })).ok, false);
  assert.equal((await h.invoke('usageSave', { ...draft, repo: 'public/repo' })).ok, false);
  assert.equal(writes.length, 0);
  assert.equal((await h.invoke('usageSave', draft)).value.project, 'fva');
  assert.deepEqual(writes, [draft]);
  assert.equal(h.calls.dialogs.length, 0);
  assert.equal((await h.invoke('usageOpen', { project: 'fva', number: 12 })).ok, true);
  target = 'https://github.com/i010542/other/issues/12';
  assert.equal((await h.invoke('usageOpen', { project: 'fva', number: 12 })).ok, false);
  assert.deepEqual(h.calls.open, ['https://github.com/i010542/fva/issues/12']);
});

test('update IPC rejects untrusted frames and stale previews before any confirmation or write', async () => {
  const h = await harness();
  assert.equal((await h.invoke('updateWorkspace', undefined, { ...h.event, senderFrame: { url: 'teamspace://workspace/index.html' } })).ok, false);
  await h.invoke('updateWorkspace');
  assert.equal((await h.invoke('applyUpdates', { previewId: 'old', resolutions: { 'SKILL.md': 'team' } })).ok, false);
  assert.equal(h.calls.dialogs.length, 0);
  assert.equal(h.calls.apply.length, 0);
});

test('update IPC requires every conflict choice and current bound workspace', async () => {
  const h = await harness();
  await h.invoke('updateWorkspace');
  for (const resolutions of [{}, { 'SKILL.md': 'overwrite' }, { 'SKILL.md': 'mine', 'extra.md': 'team' }]) {
    assert.equal((await h.invoke('applyUpdates', { previewId: 'test-preview', resolutions })).ok, false);
  }
  h.status.workspace = { ...h.status.workspace, id: 'different-workspace' };
  assert.equal((await h.invoke('applyUpdates', { previewId: 'test-preview', resolutions: { 'SKILL.md': 'team' } })).ok, false);
  assert.equal(h.calls.dialogs.length, 0);
  assert.equal(h.calls.apply.length, 0);
});

test('cancelled update does not write; confirmed update passes only the preview and choices', async () => {
  const h = await harness();
  await h.invoke('updateWorkspace');
  const input = { previewId: 'test-preview', resolutions: { 'SKILL.md': 'mine' }, directory: 'C:\\NeverUseRendererPath' };
  h.electron.dialog.response = 0;
  assert.equal((await h.invoke('applyUpdates', input)).ok, false);
  assert.equal(h.calls.apply.length, 0);
  h.electron.dialog.response = 1;
  assert.equal((await h.invoke('applyUpdates', input)).ok, true);
  assert.equal(JSON.stringify(h.calls.apply), JSON.stringify([{ previewId: input.previewId, resolutions: input.resolutions }]));
  assert.match(h.calls.dialogs[1].detail, /Synthetic/);
  assert.equal((await h.invoke('applyUpdates', input)).ok, false);
  assert.equal(h.calls.apply.length, 1);
});

test('restore IPC rejects other backups and requires native confirmation', async () => {
  const h = await harness();
  assert.equal((await h.invoke('restoreUpdate', { backupId: 'other-backup' })).ok, false);
  assert.equal(h.calls.dialogs.length, 0);
  h.electron.dialog.response = 0;
  assert.equal((await h.invoke('restoreUpdate', { backupId: 'test-backup' })).ok, false);
  assert.equal(h.calls.restore.length, 0);
  h.electron.dialog.response = 1;
  assert.equal((await h.invoke('restoreUpdate', { backupId: 'test-backup' })).ok, true);
  assert.equal(h.calls.restore.length, 1);
});


test('cold and warm deep links stay queued until the renderer is ready, then expose only route enums', async () => {
  const h = await harness({ argv: ['Team Space.exe', '--', 'teamspace-app://project/fva/docs'], holdLoad: true });
  assert.deepEqual(h.calls.activation, { focus: true, navigation: 'docs' });
  h.second(['Team Space.exe', '--original-process-start-time=0'], { focus: true, navigation: 'updates' });
  assert.deepEqual(h.calls.notifications, []);
  assert.equal(h.calls.focus, 0);
  await h.finishLoad();
  assert.deepEqual(h.calls.notifications, [['team-space:navigation']]);
  assert.equal(h.calls.focus, 1);
  assert.equal(h.calls.restored, 1);
  const untrusted = { ...h.event, senderFrame: { url: 'teamspace-app://project/fva' } };
  assert.equal((await h.invoke('takeNavigation', undefined, untrusted)).ok, false);
  assert.equal((await h.invoke('takeNavigation', 'C:\\Synthetic\\fva')).ok, false);
  assert.deepEqual((await h.invoke('takeNavigation')).value, { project: 'fva', view: 'docs' });
  assert.deepEqual((await h.invoke('takeNavigation')).value, { project: 'fva', view: 'updates' });
  assert.equal((await h.invoke('takeNavigation')).value, null);
  assert.equal(h.calls.updates, 0);
  assert.deepEqual(h.calls.apply, []);
});

test('a link received during an update waits and cannot replace its preview or trigger another operation', async () => {
  const h = await harness();
  const finish = h.holdUpdate();
  const update = h.invoke('updateWorkspace');
  h.second(['Team Space.exe', 'teamspace-app://project/fva'], { focus: true, navigation: 'docs' });
  assert.equal((await h.invoke('takeNavigation')).value, null);
  assert.equal(h.calls.focus, 0);
  assert.deepEqual(h.calls.notifications, []);
  finish();
  assert.equal((await update).value.previewId, h.preview.previewId);
  assert.equal(h.calls.updates, 1);
  assert.deepEqual(h.calls.notifications, [['team-space:navigation']]);
  assert.deepEqual((await h.invoke('takeNavigation')).value, { project: 'fva', view: 'docs' });
  assert.equal((await h.invoke('applyUpdates', { previewId: h.preview.previewId, resolutions: { 'SKILL.md': 'mine' } })).ok, true);
});

test('warm navigation ignores raw argv, invalid envelopes, and arbitrary external URLs', async () => {
  const h = await harness({ argv: ['Team Space.exe', 'teamspace-app://project/fva/docs?x=1'] });
  assert.deepEqual(h.calls.activation, { focus: false, navigation: null });
  h.second(['Team Space.exe', 'teamspace-app://project/fva']);
  h.second(['Team Space.exe'], { focus: true, navigation: 'teamspace-app://project/fva/updates' });
  h.second(['Team Space.exe'], { focus: true, navigation: 'workspace', path: 'C:\\Synthetic' });
  assert.equal(h.calls.focus, 0);
  assert.deepEqual(h.calls.notifications, []);
  assert.equal((await h.invoke('takeNavigation')).value, null);
  assert.equal((await h.invoke('openExternal', 'https://example.test/')).ok, false);
  for (const key of ['portal', 'portalProject', 'portalDocs', 'branches', 'pulls', 'issues']) assert.equal((await h.invoke('openExternal', key)).ok, true);
  assert.equal((await h.invoke('openExternal', 'portalFva')).ok, false);
  assert.deepEqual(h.calls.open, [
    'https://i010542.github.io/team-space/',
    'https://i010542.github.io/team-space/projects/fva/',
    'https://i010542.github.io/team-space/docs/',
    'https://github.com/i010542/fva/branches',
    'https://github.com/i010542/fva/pulls',
    'https://github.com/i010542/fva/issues',
  ]);
});

 test('collaboration links open fixed Pages guides and reject arbitrary destinations', async()=>{
 const h=await harness();
 for(const [key,suffix] of Object.entries({portalFiles:'team/files/',portalVersions:'team/versions/',portalReviews:'team/reviews/',portalSuggestions:'team/suggestions/',portalDocs:'docs/'})){
 assert.equal((await h.invoke('openExternal',key)).ok,true);
 assert.equal(h.calls.open.at(-1),'https://i010542.github.io/team-space/'+suffix);
 }
 const before=h.calls.open.length;
 for(const input of ['https://example.com','file:///C:/Synthetic','portalFiles?next=evil', {key:'portalFiles'}])assert.equal((await h.invoke('openExternal',input)).ok,false);
 assert.equal(h.calls.open.length,before);
 });

test('Skill picker binds only the chosen SKILL.md parent after confirmation', async t => {
 const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(),'team-space-picker-'));
 t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
 const skill=path.join(tmp,'SKILL.md'); await fs.writeFile(skill,'name: fva');
 const other=path.join(tmp,'README.md'); await fs.writeFile(other,'test');
 const folder=path.join(tmp,'nested','SKILL.md'); await fs.mkdir(folder,{recursive:true});
 const h=await harness();
 assert.equal((await h.invoke('bindWorkspace')).value,null);
 assert.deepEqual(Array.from(h.calls.pickers[0].properties),['openFile']);
 for(const file of [other,folder,path.join(tmp,'missing','SKILL.md')]){
  h.electron.dialog.selection={canceled:false,filePaths:[file]};
  assert.equal((await h.invoke('bindWorkspace')).ok,false);
 }
 assert.equal(h.calls.bindings.length,0); assert.equal(h.calls.dialogs.length,0);
 h.electron.dialog.selection={canceled:false,filePaths:[skill]}; h.electron.dialog.response=0;
 assert.equal((await h.invoke('bindWorkspace')).value,null);assert.equal(h.calls.bindings.length,0);
 h.electron.dialog.response=1;
 assert.equal((await h.invoke('bindWorkspace')).ok,true);
 assert.deepEqual(h.calls.bindings,[tmp]);
 assert.match(h.calls.dialogs.at(-1).detail,/不只是 SKILL.md/);
});

test('selectProject rejects unknown ids and in-flight calls, then stamps the service that actually ran', async (t) => {
  const os = require('node:os');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'team-space-active-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  let release;
  const fvaStatus = new Promise((resolve) => { release = resolve; });
  const fvaService = {
    status: () => fvaStatus,
    reviewStatus: async () => ({ state: 'none', from: 'fva' }),
    changes: async () => ({ files: [], from: 'fva' }),
  };
  const adService = {
    status: async () => ({ authenticated: true, authorized: true, tools: { git: true, gh: true }, workspace: { id: 'ad-ws', bound: true, path: 'C:\\Ad' }, from: 'ad' }),
    reviewStatus: async () => ({ state: 'open', number: 8, from: 'ad' }),
    changes: async () => ({ files: [{ path: 'ad.md' }], from: 'ad' }),
  };
  const h = await harness({ userData, serviceMap: { fva: fvaService, 'ugc-reference-ad-workflow': adService } });
  assert.equal((await h.invoke('selectProject', 'nope')).ok, false);
  assert.equal((await h.invoke('selectProject', 'FVA')).ok, false);
  const pending = h.invoke('status');
  const blocked = await h.invoke('selectProject', 'ugc-reference-ad-workflow');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /请稍候再切换/);
  release({ authenticated: true, authorized: true, tools: { git: true, gh: true }, workspace: { id: 'fva-ws', bound: true, path: 'C:\\Fva' }, from: 'fva' });
  const first = await pending;
  assert.equal(first.ok, true);
  assert.equal(first.value.project.id, 'fva');
  assert.equal(first.value.project.name, 'FVA');
  assert.equal(first.value.from, 'fva');
  assert.equal(first.value.workspace.id, 'fva-ws');
  assert.equal((await h.invoke('reviewStatus')).value.project, 'fva');
  assert.equal((await h.invoke('changes')).value.project, 'fva');
  assert.equal((await h.invoke('selectProject', 'ugc-reference-ad-workflow')).ok, true);
  assert.equal((await h.invoke('openExternal', 'repository')).ok, true);
  assert.equal(h.calls.open.at(-1), 'https://github.com/i010542/ugc-reference-ad-workflow');
  assert.equal((await h.invoke('openExternal', 'portalProject')).ok, true);
  assert.equal(h.calls.open.at(-1), 'https://i010542.github.io/team-space/projects/ugc-reference-ad-workflow/');
  const switched = await h.invoke('status');
  assert.equal(switched.value.project.id, 'ugc-reference-ad-workflow');
  assert.equal(switched.value.project.name, '广告制作');
  assert.equal(switched.value.from, 'ad');
  assert.equal(switched.value.workspace.id, 'ad-ws');
  assert.equal((await h.invoke('reviewStatus')).value.project, 'ugc-reference-ad-workflow');
  assert.equal((await h.invoke('changes')).value.from, 'ad');
  assert.equal((await h.invoke('changes')).value.project, 'ugc-reference-ad-workflow');
});

test('selectProject keeps the original skill when remembering the choice fails', async (t) => {
  const os = require('node:os');
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'team-space-blocked-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const blocked = path.join(parent, 'user-data-file');
  await fs.writeFile(blocked, 'not a directory');
  const fvaService = {
    status: async () => ({ authenticated: true, workspace: { id: 'fva-ws' }, from: 'fva' }),
  };
  const adService = {
    status: async () => ({ authenticated: true, workspace: { id: 'ad-ws' }, from: 'ad' }),
  };
  const h = await harness({ userData: blocked, serviceMap: { fva: fvaService, 'ugc-reference-ad-workflow': adService } });
  const failed = await h.invoke('selectProject', 'ugc-reference-ad-workflow');
  assert.equal(failed.ok, false);
  assert.equal(failed.error, '没能记住要使用的 Skill，请重试。');
  const stayed = await h.invoke('status');
  assert.equal(stayed.value.project.id, 'fva');
  assert.equal(stayed.value.from, 'fva');
  assert.equal(stayed.value.workspace.id, 'fva-ws');
  await fs.rm(blocked);
  await fs.mkdir(blocked);
  assert.equal((await h.invoke('selectProject', 'ugc-reference-ad-workflow')).ok, true);
  const switched = await h.invoke('status');
  assert.equal(switched.value.project.id, 'ugc-reference-ad-workflow');
  assert.equal(switched.value.from, 'ad');
  assert.equal(switched.value.workspace.id, 'ad-ws');
});
