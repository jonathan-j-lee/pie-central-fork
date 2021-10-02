import type { RootState } from '.';
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';

export enum EditorTheme {
  LIGHT = 'light',
  DARK = 'dark',
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export enum LogOpenCondition {
  START = 'start',
  ERROR = 'error',
  NEVER = 'never',
}

export const BAUD_RATES = [
  '50',
  '75',
  '110',
  '134',
  '150',
  '200',
  '300',
  '600',
  '1200',
  '1800',
  '2400',
  '4800',
  '9600',
  '19200',
  '38400',
  '57600',
  '115200',
];

interface EditorSettingsState {
  filePath: null | string;
  editorTheme: EditorTheme;
  syntaxTheme: string;
  fontSize: number;
  tabSize: number;
  encoding: string;
  syntaxHighlighting: boolean;
  lineNumbers: boolean;
  marginMarker: boolean;
  highlightLine: boolean;
  wrapLines: boolean;
  basicAutocomplete: boolean;
  liveAutocomplete: boolean;
  appendNewline: boolean;
  trimWhitespace: boolean;
}

interface LogSettingsState {
  maxEvents: number;
  openCondition: LogOpenCondition;
  showSystem: boolean;
  showTimestamp: boolean;
  showLevel: boolean;
  showTraceback: boolean;
  pinToBottom: boolean;
}

interface RuntimeSettingsState {
  host: string;
  deviceNames: { [name: string]: string };
  options: { [option: string]: string };
  admin: {
    remotePath: string;
    restartCommand: string;
    updateCommand: string;
  };
  credentials: {
    username: string;
    password: string;
    privateKey: string;
  };
  perf: {
    threadPoolWorkers: number;
    serviceWorkers: number;
    devUpdateInterval: number;
    devPollInterval: number;
    controlInterval: number;
    setupTimeout: number;
    mainInterval: number;
    baudRate: typeof BAUD_RATES[number];
  };
  addressing: {
    multicastGroup: '224.1.1.1';
    callPort: number;
    logPort: number;
    controlPort: number;
    updatePort: number;
    vsdPort: number;
  };
  monitoring: {
    healthCheckInterval: number;
    logLevel: LogLevel;
    debug: boolean;
  };
}

interface KeybindingSettingsState {
  [command: string]: { win: string; mac: string };
}

export interface SettingsState {
  editor: EditorSettingsState;
  log: LogSettingsState;
  runtime: RuntimeSettingsState;
  keybindings: KeybindingSettingsState;
}

const slice = createSlice({
  name: 'settings',
  initialState: {
    editor: {
      filePath: null,
      editorTheme: EditorTheme.LIGHT,
      syntaxTheme: 'tomorrow',
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
        baudRate: '115200',
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
  } as SettingsState,
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

export const save = createAsyncThunk<void, void, { state: RootState }>(
  'settings/save',
  async (arg, thunkAPI) => {
    await window.ipc.invoke('save-settings', thunkAPI.getState().settings);
  }
);

export const load = createAsyncThunk('settings/load', async (arg, thunkAPI) => {
  const settings = await window.ipc.invoke('load-settings');
  thunkAPI.dispatch(slice.actions.update({ value: settings }));
});
