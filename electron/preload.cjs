const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkspace', {
  isDesktop: true,
  selectVault: () => ipcRenderer.invoke('vault:select'),
  openRecentVault: (rootPath) => ipcRenderer.invoke('vault:open-recent', rootPath),
  listVault: (rootPath) => ipcRenderer.invoke('vault:list', rootPath),
  readDocument: (rootPath, relativePath) => ipcRenderer.invoke('vault:read-document', rootPath, relativePath),
  writeDocument: (rootPath, relativePath, content) => ipcRenderer.invoke('vault:write-document', rootPath, relativePath, content),
  createDocument: (rootPath, folderPath, name, parentRelativePath) => ipcRenderer.invoke('vault:create-document', rootPath, folderPath, name, parentRelativePath),
  createFolder: (rootPath, folderPath, name) => ipcRenderer.invoke('vault:create-folder', rootPath, folderPath, name),
  renameNode: (rootPath, relativePath, name) => ipcRenderer.invoke('vault:rename-node', rootPath, relativePath, name),
  deleteNode: (rootPath, relativePath) => ipcRenderer.invoke('vault:delete-node', rootPath, relativePath),
  exportDocument: (request) => ipcRenderer.invoke('document:export', request),
  reveal: (rootPath, relativePath) => ipcRenderer.invoke('vault:reveal', rootPath, relativePath),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: (changes) => ipcRenderer.invoke('preferences:save', changes),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('inkspace:command', listener);
    return () => ipcRenderer.removeListener('inkspace:command', listener);
  },
});
