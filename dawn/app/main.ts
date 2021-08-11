import * as fs from 'fs/promises';
import * as path from 'path';
import * as bunyan from 'bunyan';
import {
  app,
  dialog,
  ipcMain,
  shell,
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
} from 'electron';
import { NodeSSH } from 'node-ssh';
import Client from '@pioneers/runtime-client';

const ssh = new NodeSSH();
const logger = bunyan.createLogger({ name: 'dawn' });
const client = new Client(); // TODO: fix no membership when not connected
const isDevelopment = process.env.NODE_ENV === 'development';

const SETTINGS_PATH = path.join(app.getPath('appData'), 'dawn', 'settings.json');
const FILE_FILTERS = [{ name: 'Python (*.py)', extensions: ['py'] }];
const PIE_WEBSITE_URL = 'https://pioneers.berkeley.edu';
const MENU_TEMPLATE: MenuItemConstructorOptions[] = [
  { role: 'fileMenu' },
  { role: 'editMenu' },
  {
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click(item, focusedWindow) {
          if (focusedWindow) {
            focusedWindow.webContents.send('exit', 'reload');
          }
        },
      },
      {
        label: 'Force Reload',
        accelerator: 'CmdOrCtrl+Shift+R',
        click(item, focusedWindow) {
          if (focusedWindow) {
            focusedWindow.webContents.send('exit', 'force-reload');
          }
        },
      },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  { role: 'windowMenu' },
  {
    label: 'Help',
    submenu: [
      {
        label: 'About',
      },
      {
        label: 'Pioneers in Engineering',
        async click() {
          await shell.openExternal(PIE_WEBSITE_URL);
        },
      },
    ],
  },
];

// TODO: reset client on error
// TODO: fix out-of-order messages

ipcMain.handle('request', async (event, address, method, ...args) => {
  const result = await client.request(address, method, ...args);
  logger.info({ address, method, args, result }, 'Sent request to Runtime');
  return result;
});

ipcMain.on('notify', (event, address, method, ...args) => {
  client.notify(address, method, ...args);
});

ipcMain.on('send-control', (event, gamepads) => {
  client.sendControl(gamepads);
});

ipcMain.handle('exec', async (event, config, ...commands) => {
  const connection = await ssh.connect(config);
  try {
    const results = [];
    for (const { command, options } of commands) {
      const response = await ssh.execCommand(command, options);
      if (response.code) {
        throw new Error(response.stderr);
      }
      logger.info(
        { command, username: config.username, host: config.host },
        'Executed command on remote machine'
      );
      results.push(response);
    }
    return results;
  } catch (err) {
    logger.error(
      { err, commands, username: config.username, host: config.host },
      'Failed to execute commands on remote machine'
    );
    throw err;
  } finally {
    ssh.dispose();
  }
});

ipcMain.handle('open-file-prompt', async () => {
  const {
    canceled,
    filePaths: [filePath],
  } = await dialog.showOpenDialog({
    title: 'Open Student Code',
    filters: FILE_FILTERS,
  });
  if (canceled || !filePath) {
    throw new Error('file not selected');
  }
  return filePath;
});

ipcMain.handle('open-file', async (event, filePath, encoding) => {
  const contents = await fs.readFile(filePath, { encoding });
  logger.info({ filePath, encoding }, 'Opened file');
  return contents;
});

ipcMain.handle('save-file-prompt', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Student Code',
    filters: FILE_FILTERS,
    properties: ['showOverwriteConfirmation'],
  });
  if (canceled || !filePath) {
    throw new Error('file not selected');
  }
  return filePath;
});

ipcMain.handle('save-file', async (event, filePath, contents, encoding) => {
  await fs.writeFile(filePath, contents, { encoding });
  logger.info({ filePath, encoding }, 'Saved file');
});

ipcMain.on('quit', (event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.destroy();
  }
  logger.info('Destroyed all windows');
});

ipcMain.on('reload', (event) => {
  const window = BrowserWindow.getFocusedWindow();
  window?.reload();
  logger.info('Reloaded window');
});

ipcMain.on('force-reload', (event) => {
  const window = BrowserWindow.getFocusedWindow();
  window?.webContents.reloadIgnoringCache();
  logger.info('Force reloaded window');
});

ipcMain.handle('load-settings', async (event) => {
  try {
    const contents = await fs.readFile(SETTINGS_PATH, { encoding: 'utf8' });
    const settings = JSON.parse(contents);
    logger.info({ path: SETTINGS_PATH }, 'Loaded settings');
    return settings;
  } catch (err) {
    logger.warn({ err }, 'Failed to load settings');
    return {};
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  client.close();
  logger.info('Closed client');
});

function createWindow() {
  const menu = Menu.buildFromTemplate(MENU_TEMPLATE);
  Menu.setApplicationMenu(menu);

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
    ipcMain.removeHandler('save-settings');
    ipcMain.handle('save-settings', async (event, settings) => {
      client.close(true);
      await client.open(
        (err, update) => {
          if (err) {
            logger.error({ err }, 'Error receiving update');
          } else {
            window.webContents.send('update-devices', update);
          }
        },
        (err, event) => {
          if (err) {
            logger.error({ err }, 'Error receiving log event');
          } else {
            window.webContents.send('append-event', event);
          }
        },
        { host: settings.runtime.host }
      );
      await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
      await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings));
      logger.info({ path: SETTINGS_PATH }, 'Saved settings');
    });

    window.removeAllListeners('close');
    window.on('close', (event) => {
      event.preventDefault();
      window.webContents.send('exit', 'quit');
      logger.info('Attempting to close main window');
    });

    logger.info('Window loaded');
  });

  window.maximize();
  /** Ugly hack needed because __dirname needs to be altered by webpack.
   *  Also, using `loadFile` can be very slow to start up sometimes (~30s).
   *  https://github.com/electron/electron/issues/13829
   */
  window.loadURL(`file://${path.join(dir, 'index.html')}`);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
