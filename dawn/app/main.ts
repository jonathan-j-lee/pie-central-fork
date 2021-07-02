'use strict';

import * as fs from 'fs/promises';
import * as path from 'path';

import { app, dialog, ipcMain, BrowserWindow } from 'electron';
import Client from '@pioneers/runtime-client';

const client = new Client();
const isDevelopment = process.env.NODE_ENV === 'development';
const FILE_FILTERS = [{ name: 'Python (*.py)', extensions: ['py'] }];

ipcMain.handle('request', async (event, address, method, ...args) => {
  return await client.request(address, method, ...args);
});

ipcMain.on('notify', (event, address, method, ...args) => {
  client.notify(address, method, ...args);
});

ipcMain.on('send-control', (event, gamepads) => {
  client.sendControl(gamepads);
});

ipcMain.handle('file-open', (event, encoding) => {
  return dialog.showOpenDialog({ title: 'Open Student Code', filters: FILE_FILTERS })
    .then(({ canceled, filePaths: [filePath] }) => {
      if (canceled || !filePath) {
        throw new Error('file not selected');
      }
      return Promise.all([filePath, fs.readFile(filePath, { encoding })]);
    });
});

ipcMain.handle('file-save-prompt', () => {
  return dialog.showSaveDialog({
    title: 'Save Student Code',
    filters: FILE_FILTERS,
    properties: ['showOverwriteConfirmation'],
  })
    .then(({ canceled, filePath }) => {
      if (canceled || !filePath) {
        throw new Error('file not selected');
      }
      return filePath;
    });
});

ipcMain.handle('file-save', (event, filePath, contents, encoding) => {
  return fs.writeFile(filePath, contents, { encoding });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  client.close();
});

function createWindow() {
  const dir = path.dirname(__filename);
  const window = new BrowserWindow({
    webPreferences: {
      preload: path.join(dir, 'preload.js'),
    },
  });
  if (isDevelopment) {
    window.webContents.openDevTools();
  }

  window.webContents.on('did-finish-load', () => {
    ipcMain.removeHandler('connect');
    ipcMain.handle('connect', async (event, options) => {
      client.close(true);
      await client.open(
        (err, update) => window.webContents.send('update', err, update),
        (err, event) => window.webContents.send('log-event', err, event),
        options,
      );
    });
  });
  window.maximize();
  /** Ugly hack needed because __dirname needs to be altered by webpack.
   *  Also, using `loadFile` can be very slow to start up sometimes (~30s).
   *  https://github.com/electron/electron/issues/13829
   */
  window.loadURL(`file://${path.join(dir, 'index.html')}`);
};

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
