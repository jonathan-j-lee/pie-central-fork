'use strict';

import { app, BrowserWindow } from 'electron';

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
  });
  win.loadFile(`${__dirname}/index.html`);
};

app.whenReady().then(() => {
  createWindow();
});
