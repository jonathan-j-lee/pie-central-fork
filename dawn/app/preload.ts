'use strict';

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('runtime', {
  connect: (options = {}) => ipcRenderer.invoke('connect', options),
  handleSetup: handler => ipcRenderer.on('setup', handler),
  handleUpdate: (handler) => ipcRenderer.on('update', handler),
  handleEvent: (handler) => ipcRenderer.on('log-event', handler),
  request: (address, method, ...args) =>
    ipcRenderer.invoke('request', address, method, ...args),
  notify: (address, method, ...args) =>
    ipcRenderer.send('notify', address, method, ...args),
  sendControl: gamepads => ipcRenderer.send('send-control', gamepads),
});

contextBridge.exposeInMainWorld('file', {
  open: (encoding) => ipcRenderer.invoke('file-open', encoding),
  savePrompt: () => ipcRenderer.invoke('file-save-prompt'),
  save: (filePath, contents, encoding) =>
    ipcRenderer.invoke('file-save', filePath, contents, encoding),
});
