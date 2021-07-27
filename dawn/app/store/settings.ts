import { createAsyncThunk, createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';

export enum EditorTheme {
  LIGHT = 'light',
  DARK = 'dark',
};

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
};

export enum LogOpenCondition {
  START = 'start',
  ERROR = 'error',
  NEVER = 'never',
};

export const BAUD_RATES = [
  50,
  75,
  110,
  134,
  150,
  200,
  300,
  600,
  1200,
  1800,
  2400,
  4800,
  9600,
  19200,
  38400,
  57600,
  115200,
];

const slice = createSlice({
  name: 'settings',
  initialState: {
    editor: {
      editorTheme: EditorTheme.DARK,
      syntaxTheme: 'solarized_dark',
      fontSize: 13,
      tabSize: 4,
      encoding: 'utf8',
      syntaxHighlighting: true,
      lineNumbers: true,
      marginMarker: true,
      highlightLine: true,
      wrapLines: true,
      basicAutocomplete: true,
      liveAutocomplete: true,
      appendNewline: true,
      trimWhitespace: true,
    },
    log: {
      maxEvents: 250,
      openCondition: LogOpenCondition.START,
      showSystem: true,
      showTimestamp: true,
      showLevel: true,
      showTraceback: true,
      pinToBottom: true,
    },
    runtime: {
      host: 'localhost',
      deviceNames: {},
      options: {},
      admin: {
        remotePath: 'studentcode.py',
        restartCommand: 'systemctl restart runtime.service',
        updateCommand: 'systemctl restart runtime-update.service',
      },
      credentials: {
        username: '',
        password: '',
        privateKey: '',
      },
      perf: {
        threadPoolWorkers: 1,
        serviceWorkers: 5,
        devUpdateInterval: 0.1,
        devPollInterval: 0.04,
        controlInterval: 0.05,
        setupTimeout: 1,
        mainInterval: 0.05,
        baudRate: 115200,
      },
      addressing: {
        multicastGroup: '224.1.1.1',
        callPort: 6000,
        logPort: 6001,
        controlPort: 6002,
        updatePort: 6003,
        vsdPort: 6004,
      },
      monitoring: {
        healthCheckInterval: 30,
        logLevel: LogLevel.INFO,
        debug: false,
      },
    },
    keybindings: {
      newFile: { win: 'Ctrl+N', mac: 'Cmd+N' },
      openFile: { win: 'Ctrl+O', mac: 'Cmd+O' },
      saveFile: { win: 'Ctrl+S', mac: 'Cmd+S' },
      saveFileAs: { win: 'Ctrl+Shift+S', mac: 'Cmd+Shift+S' },
      downloadFile: { win: 'Ctrl+Shift+Enter', mac: 'Cmd+Shift+Enter' },
      uploadFile: { win: 'Ctrl+Enter', mac: 'Cmd+Enter' },
      cutText: { win: 'Ctrl+X', mac: 'Cmd+X' },
      copyText: { win: 'Ctrl+C', mac: 'Cmd+C' },
      pasteText: { win: 'Ctrl+V', mac: 'Cmd+V' },
      start: { win: 'Alt+1', mac: 'Alt+1' },
      stop: { win: 'Alt+2', mac: 'Alt+2' },
      estop: { win: 'Alt+3', mac: 'Alt+3' },
      toggleConsole: { win: 'Ctrl+Shift+O', mac: 'Cmd+Shift+Q' },
      copyConsole: { win: 'Ctrl+Shift+C', mac: 'Cmd+Shift+C' },
      clearConsole: { win: 'Ctrl+Shift+X', mac: 'Cmd+Shift+X' },
      lint: { win: 'Alt+L', mac: 'Alt+L' },
      restart: { win: 'Alt+R', mac: 'Alt+R' },
    },
  },
  reducers: {
    update(state, action) {
      const { path, value } = action.payload;
      if (path) {
        _.set(state, path, value);
      } else {
        _.merge(state, value);
      }
    },
  },
});

export default slice;

export const save = createAsyncThunk(
  'settings/save',
  async (arg, thunkAPI) => {
    await window.ipc.invoke('save-settings', thunkAPI.getState().settings);
  },
);

export const load = createAsyncThunk(
  'settings/load',
  async (arg, thunkAPI) => {
    const settings = await window.ipc.invoke('load-settings');
    thunkAPI.dispatch(slice.actions.update({ value: settings }));
  },
);
