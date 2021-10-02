import { contextBridge, ipcRenderer } from 'electron';
import { SSHExecCommandOptions } from 'node-ssh';
import * as path from 'path';
import * as shellEscape from 'shell-escape';

export interface SSHConfig {
  host: string;
  username: string;
  password: string;
  privateKey: string;
}

export interface SSHCommand {
  command: string;
  options?: SSHExecCommandOptions;
}

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
  on(channel: string, handler: (...args: any) => void) {
    if (RENDERER_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => handler(...args));
    }
  },
  removeListeners(channel: string) {
    if (RENDERER_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  invoke(channel: string, ...args: any) {
    if (MAIN_SYNC_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`invalid channel: ${channel}`));
  },
  send(channel: string, ...args: any) {
    if (MAIN_ASYNC_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
});

contextBridge.exposeInMainWorld('ssh', {
  upload: async (config: SSHConfig, remotePath: string, contents: string) => {
    const commands = [
      { command: `mkdir -p ${shellEscape([path.dirname(remotePath)])}` },
      { command: `cat > ${shellEscape([remotePath])}`, options: { stdin: contents } },
    ];
    return await ipcRenderer.invoke('exec', config, ...commands);
  },
  download: async (config: SSHConfig, remotePath: string) => {
    const command = { command: `cat ${shellEscape([remotePath])}` };
    const [response] = await ipcRenderer.invoke('exec', config, command);
    return response.stdout;
  },
});
