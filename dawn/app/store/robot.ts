import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';
import { Editor } from 'ace-builds';
import { prompt } from './editor';
import log, { append } from './log';
import peripherals from './peripherals';
import { LogLevel, LogOpenCondition } from './settings';

export enum Mode {
  AUTO = 'auto',
  TELEOP = 'teleop',
  IDLE = 'idle',
  ESTOP = 'estop',
};

export enum Alliance {
  BLUE = 'blue',
  GOLD = 'gold',
};

export enum ConnectionStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DISCONNECTED = 'disconnected',
};

const RATE_DECAY = 0.5;
const HEALTHY_THRESHOLD = 0.9;
const DISCONNECT_TIMEOUT = 8;
const MAX_TIMESTAMPS = 50;

const initialState = {
  status: ConnectionStatus.DISCONNECTED,
  mode: Mode.IDLE,
  alliance: null,
  updates: [],
  updateRate: 0,
  relUpdateRate: 0,
  error: false,
  updateInterval: 0.1,  // FIXME: remove
};

export const download = createAsyncThunk<
  { contents: string },
  { editor?: Editor },
  { state: { robot: typeof initialState, editor: { dirty: boolean } } }
>(
  'robot/download',
  async ({ editor }, thunkAPI) => {
    const state = thunkAPI.getState();
    if (state.editor.dirty) {
      await thunkAPI.dispatch(prompt()).unwrap();
    }
    const settings = state.settings.runtime;
    const config = { host: settings.host, ...settings.credentials };
    const contents = await window.ssh.download(config, settings.admin.remotePath);
    editor?.setValue(contents);
    return { contents };
  },
);

export const upload = createAsyncThunk<
  void,
  { editor?: Editor },
  { state: { robot: typeof initialState } }
>(
  'robot/upload',
  async ({ editor }, thunkAPI) => {
    const settings = thunkAPI.getState().settings.runtime;
    const config = { host: settings.host, ...settings.credentials };
    if (editor) {
      const contents = editor.getValue();
      await window.ssh.upload(config, settings.admin.remotePath, contents);
    }
  },
);

export const changeMode = createAsyncThunk<{ mode?: Mode }, Mode>(
  'robot/start',
  async (mode, thunkAPI) => {
    if (mode === Mode.ESTOP) {
      window.ipc.send('notify', 'executor-service', 'estop');
    } else {
      await window.ipc.invoke('request', 'executor-service', mode);
      const { openCondition } = thunkAPI.getState().settings.log;
      if (mode !== Mode.IDLE && openCondition === LogOpenCondition.START) {
        thunkAPI.dispatch(log.actions.open());
      }
    }
    return { mode };
  },
);

export const restart = createAsyncThunk<
  any,
  void,
  { state: { robot: typeof initialState } }
>(
  'robot/restart',
  async (arg, thunkAPI) => {
    const settings = thunkAPI.getState().settings.runtime;
    const config = { host: settings.host, ...settings.credentials };
    await window.ipc.invoke('exec', config, { command: settings.admin.restartCommand });
  },
);

const slice = createSlice({
  name: 'robot',
  initialState,
  reducers: {
    updateRate(state, action) {
      state.updateRate *= RATE_DECAY;
      let timeElapsed = DISCONNECT_TIMEOUT;
      if (state.updates.length > 0) {
        timeElapsed = (action.payload - state.updates[state.updates.length - 1]) / 1000;
        // Mix in current rate
        const timeSinceFirst = (action.payload - state.updates[0]) / 1000;
        state.updateRate += (1 - RATE_DECAY) * state.updates.length / timeSinceFirst;
      }
      state.updates.splice(0, state.updates.length - MAX_TIMESTAMPS);
      const expectedUpdateRate = 1 / state.updateInterval;
      state.relUpdateRate = Math.min(1, state.updateRate / expectedUpdateRate);
      if (timeElapsed >= DISCONNECT_TIMEOUT) {
        state.status = ConnectionStatus.DISCONNECTED;
        state.mode = Mode.IDLE;
        state.error = false;
      } else {
        if (state.relUpdateRate > 0.9) {
          state.status = ConnectionStatus.HEALTHY;
        } else {
          state.status = ConnectionStatus.UNHEALTHY;
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(changeMode.fulfilled, (state, action) => {
        state.mode = action.payload.mode || state.mode;
        if (state.mode === Mode.IDLE) {
          state.error = false;
        } else if (state.mode === Mode.ESTOP) {
          state.error = true;
        }
      })
      .addCase(append.fulfilled, (state, action) => {
        const { level } = action.payload.payload;
        state.error = state.error || level === LogLevel.ERROR || level === LogLevel.CRITICAL;
      })
      .addCase(peripherals.actions.update, (state, action) => {
        if (!action.payload.disconnect && action.payload.type !== 'gamepad') {
          state.updates.push(action.payload.timestamp);
        }
      });
  },
});

export default slice;
export const updateRate = () => slice.actions.updateRate(Date.now());
