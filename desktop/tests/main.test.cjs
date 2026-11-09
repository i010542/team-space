const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');

async function harness() {
  const calls = { apply: [], restore: [], dialogs: [] };
  const handlers = new Map();
  const workspace = { id: 'test-workspace', bound: true, path: 'C:\\Synthetic\\fva' };
  const preview = { previewId: 'test-preview', canApply: true, workspace,
    files: [{ path: 'SKILL.md', status: 'conflict' }] };
  const status = { workspace, lastBackup: { id: 'test-backup', createdAt: '2026-11-09T00:00:00Z' } };
  const service = {
    status: async () => status,
    updateWorkspace: async () => preview,
    applyUpdates: async (input) => { calls.apply.push(input); return { workspace }; },
    restoreUpdate: async (input) => { calls.restore.push(input); return { workspace }; },
  };
  let win;
  const electron = {
    app: { setName() {}, requestSingleInstanceLock: () => true, on() {},
      whenReady: () => Promise.resolve(), getPath: () => 'C:\\Synthetic', quit() {} },
    BrowserWindow: class {
      constructor() { win = this; this.webContents = {
        mainFrame: { url: 'teamspace://workspace/index.html' },
        setWindowOpenHandler() {}, on() {}, send() {},
      }; }
      once() {} async loadURL() {} isDestroyed() { return false; }
    },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, net: {}, shell: {},
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    dialog: { response: 1, showErrorBox() {}, async showMessageBox(_window, data) {
      calls.dialogs.push(data); return { response: this.response };
    } },
  };
  const filename = path.join(__dirname, '../src/main.cjs');
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    require: (name) => name === 'electron' ? electron : name === './core.cjs' ? { createService: () => service } : require(name),
    __dirname: path.dirname(filename), process: { resourcesPath: 'C:\\Synthetic' }, URL, Response,
  }, { filename });
  await new Promise(resolve => setImmediate(resolve));
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const invoke = (name, input, sender = event) => handlers.get('team-space:' + name)(sender, input);
  return { calls, preview, status, electron, event, invoke };
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
