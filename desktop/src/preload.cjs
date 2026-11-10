const { contextBridge, ipcRenderer } = require('electron');
const call = (method, input) => ipcRenderer.invoke('team-space:' + method, input).then(result => {
  if (!result.ok) throw new Error(result.error || '操作未完成，请重试。');
  return result.value;
});
contextBridge.exposeInMainWorld('teamSpace', Object.freeze({
  status: () => call('status'), login: () => call('login'),
  startWorkspace: () => call('startWorkspace'), changes: () => call('changes'),
  bindWorkspace: () => call('bindWorkspace'),
  submit: input => call('submit', input), openWorkspace: () => call('openWorkspace'),
  updateWorkspace: () => call('updateWorkspace'), recoverWorkspace: () => call('recoverWorkspace'), reviewStatus: () => call('reviewStatus'),
  applyUpdates: input => call('applyUpdates', input), restoreUpdate: input => call('restoreUpdate', input),
  openExternal: key => call('openExternal', key),
  projects: () => call('projects'),
  selectProject: id => call('selectProject', id),
  usageList: input => call('usageList', input),
  usageDetail: input => call('usageDetail', input),
  usageImport: input => call('usageImport', input),
  usageSave: input => call('usageSave', input),
  usageOpen: input => call('usageOpen', input),
  takeNavigation: () => call('takeNavigation'),
  onNavigation: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('team-space:navigation', listener);
    return () => ipcRenderer.removeListener('team-space:navigation', listener);
  },
  onProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('team-space:progress', listener);
    return () => ipcRenderer.removeListener('team-space:progress', listener);
  }
}));
