const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');

async function harness({ argv = ["Team Space.exe"], holdLoad = false } = {}) {
  const calls = { apply: [], restore: [], dialogs: [], open: [], notifications: [], focus: 0, restored: 0, updates: 0 };
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
    updateWorkspace: async () => { calls.updates++; await updateGate; return preview; },
    applyUpdates: async (input) => { calls.apply.push(input); return { workspace }; },
    restoreUpdate: async (input) => { calls.restore.push(input); return { workspace }; },
  };
  let win;
  const electron = {
    app: { setName() {}, requestSingleInstanceLock(data) { calls.activation = data; return true; },
      on: (name, callback) => events.set(name, callback),
      whenReady: () => Promise.resolve(), getPath: () => 'C:\\Synthetic', quit() {} },
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
    dialog: { response: 1, showErrorBox() {}, async showMessageBox(_window, data) {
      calls.dialogs.push(data); return { response: this.response };
    } },
  };
  const filename = path.join(__dirname, '../src/main.cjs');
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    require: (name) => name === 'electron' ? electron : name === './core.cjs' ? { createService: () => service } :
      name === './deep-link.cjs' ? require('../src/deep-link.cjs') : require(name),
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
  for (const key of ['portal', 'portalFva', 'portalDocs', 'branches', 'pulls', 'issues']) assert.equal((await h.invoke('openExternal', key)).ok, true);
  assert.deepEqual(h.calls.open, [
    'https://i010542.github.io/team-space/',
    'https://i010542.github.io/team-space/projects/fva/',
    'https://i010542.github.io/team-space/docs/',
    'https://github.com/i010542/fva/branches',
    'https://github.com/i010542/fva/pulls',
    'https://github.com/i010542/fva/issues',
  ]);
});
