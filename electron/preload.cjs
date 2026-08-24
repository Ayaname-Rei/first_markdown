const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkspace', {
  isDesktop: true,
  selectVault: () => ipcRenderer.invoke('vault:select'),
  selectDocument: () => ipcRenderer.invoke('document:select'),
  openRecentVault: (rootPath) => ipcRenderer.invoke('vault:open-recent', rootPath),
  listVault: (rootPath) => ipcRenderer.invoke('vault:list', rootPath),
  readDocument: (rootPath, relativePath) => ipcRenderer.invoke('vault:read-document', rootPath, relativePath),
  writeDocument: (rootPath, relativePath, content) => ipcRenderer.invoke('vault:write-document', rootPath, relativePath, content),
  saveDocumentAs: (rootPath, relativePath, content) => ipcRenderer.invoke('document:save-as', rootPath, relativePath, content),
  createDocument: (rootPath, folderPath, name, parentRelativePath) => ipcRenderer.invoke('vault:create-document', rootPath, folderPath, name, parentRelativePath),
  createFolder: (rootPath, folderPath, name) => ipcRenderer.invoke('vault:create-folder', rootPath, folderPath, name),
  renameNode: (rootPath, relativePath, name) => ipcRenderer.invoke('vault:rename-node', rootPath, relativePath, name),
  deleteNode: (rootPath, relativePath) => ipcRenderer.invoke('vault:delete-node', rootPath, relativePath),
  exportDocument: (request) => ipcRenderer.invoke('document:export', request),
  reveal: (rootPath, relativePath) => ipcRenderer.invoke('vault:reveal', rootPath, relativePath),
  openDefaultAppSettings: () => ipcRenderer.invoke('app:open-default-app-settings'),
  completeClose: () => ipcRenderer.invoke('app:complete-close'),
  signalReady: () => ipcRenderer.send('app:renderer-ready'),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: (changes) => ipcRenderer.invoke('preferences:save', changes),
  onCommand: (callback) => {
    const listener = (_event, command, payload) => callback(command, payload);
    ipcRenderer.on('inkspace:command', listener);
    return () => ipcRenderer.removeListener('inkspace:command', listener);
  },
  onOpenDocument: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('inkspace:open-document', listener);
    return () => ipcRenderer.removeListener('inkspace:open-document', listener);
  },
  onRequestClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('inkspace:request-close', listener);
    return () => ipcRenderer.removeListener('inkspace:request-close', listener);
  },
});
