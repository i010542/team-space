const { contextBridge, ipcRenderer } = require('electron');
const call = (method, input) => ipcRenderer.invoke('team-space:' + method, input).then(result => {
  if (!result.ok) throw new Error(result.error || '操作未完成，请重试。');
  return result.value;
});
contextBridge.exposeInMainWorld('teamSpace', Object.freeze({
  status: () => call('status'), login: () => call('login'),
  startWorkspace: () => call('startWorkspace'), changes: () => call('changes'),
  submit: input => call('submit', input), openWorkspace: () => call('openWorkspace'),
  updateWorkspace: () => call('updateWorkspace'), recoverWorkspace: () => call('recoverWorkspace'), reviewStatus: () => call('reviewStatus'),
  openExternal: key => call('openExternal', key),
  onProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('team-space:progress', listener);
    return () => ipcRenderer.removeListener('team-space:progress', listener);
  }
}));
