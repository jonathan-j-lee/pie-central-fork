'use strict';

import * as path from 'path';
import { contextBridge, ipcRenderer } from 'electron';
import * as shellEscape from 'shell-escape';

const MAIN_SYNC_CHANNELS = [
  'request',
  'exec',
  'load-settings',
  'save-settings',
  'open-file',
  'open-file-prompt',
  'save-file',
  'save-file-prompt',
];
const MAIN_ASYNC_CHANNELS = [
  'notify',
  'send-control',
  'quit',
  'reload',
  'force-reload',
];
const RENDERER_CHANNELS = ['update-devices', 'append-event', 'exit'];

contextBridge.exposeInMainWorld('ipc', {
  on(channel, handler) {
    if (RENDERER_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => handler(...args));
    }
  },
  removeListeners(channel) {
    if (RENDERER_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  invoke(channel, ...args) {
    if (MAIN_SYNC_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`invalid channel: ${channel}`));
  },
  send(channel, ...args) {
    if (MAIN_ASYNC_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
});

contextBridge.exposeInMainWorld('ssh', {
  upload: (config, remotePath, contents) =>
    ipcRenderer.invoke(
      'exec',
      config,
      { command: `mkdir -p ${shellEscape([path.dirname(remotePath)])}` },
      { command: `cat > ${shellEscape([remotePath])}`, options: { stdin: contents } }
    ),
  download: (config, remotePath) =>
    ipcRenderer
      .invoke('exec', config, { command: `cat ${shellEscape([remotePath])}` })
      .then(([response]) => response.stdout),
});
