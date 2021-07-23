import { createAsyncThunk, createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';
import { Editor } from 'ace-builds';
import { prompt } from './editor';
import log, { Level } from './log';
import peripherals from './peripherals';

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

const RATE_DECAY = 0.5;
const HEALTHY_THRESHOLD = 0.9;
const DISCONNECT_TIMEOUT = 8;
const MAX_TIMESTAMPS = 50;

const deviceNameAdapter = createEntityAdapter<{ alias: string, uid: string }>({
  selectId: (name) => name.alias,
});

export const deviceNameSelectors = deviceNameAdapter.getSelectors();

const execTimeoutAdapter = createEntityAdapter<{ pattern: string, duration: number }>({
  selectId: (timeout) => timeout.pattern,
});

export const execTimeoutSelectors = execTimeoutAdapter.getSelectors();

const initialState = {
  status: ConnectionStatus.DISCONNECTED,
  mode: Mode.IDLE,
  alliance: null,
  updates: [],
  updateRate: 0,
  relUpdateRate: 0,
  host: 'localhost',
  remotePath: 'studentcode.py',
  restartCommand: 'systemctl restart runtime.service',
  updateCommand: 'systemctl restart runtime-update.service',
  credentials: {
    username: '',
    password: '',
    privateKey: '',
  },
  ports: {
    callPort: 6000,
    logPort: 6001,
    controlPort: 6002,
    updatePort: 6003,
    vsdPort: 6004,
  },
  updateInterval: 0.1,
  pollingInterval: 0.04,
  controlInterval: 0.05,
  healthCheckInterval: 30,
  logLevel: Level.INFO,
  baudRate: 115200,
  multicastGroup: '224.1.1.1',
  debug: false,
  threadPoolWorkers: 1,
  serviceWorkers: 5,
  deviceNames: deviceNameAdapter.getInitialState(),
  execTimeouts: execTimeoutAdapter.upsertMany(
    execTimeoutAdapter.getInitialState(),
    [
      { pattern: '.*_setup', duration: 1 },
      { pattern: '.*_teleop', duration: 0.05 },
    ],
  ),
  importTimeout: 1,
  error: false,
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
    const config = { host: state.robot.host, ...state.robot.credentials };
    const contents = await window.ssh.download(config, state.robot.remotePath);
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
    const state = thunkAPI.getState();
    const config = { host: state.robot.host, ...state.robot.credentials };
    if (editor) {
      const contents = editor.getValue();
      await window.ssh.upload(config, state.robot.remotePath, contents);
    }
  },
);

export const changeMode = createAsyncThunk<{ mode?: Mode }, Mode>(
  'robot/start',
  async (mode, thunkAPI) => {
    switch (mode) {
      case Mode.AUTO:
      case Mode.TELEOP:
      case Mode.IDLE:
        await window.ipc.invoke('request', 'executor-service', mode);
        break;
      case Mode.ESTOP:
        window.ipc.send('notify', 'executor-service', 'estop');
        break;
      default:
        return {};
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
    const state = thunkAPI.getState();
    const config = { host: state.robot.host, ...state.robot.credentials };
    await window.ipc.invoke('exec', config, { command: state.robot.restartCommand });
  },
);

const makeEntityReducer = (name, callback) => (state, action) => {
  state[name] = callback(state[name], action);
};

const slice = createSlice({
  name: 'robot',
  initialState,
  reducers: {
    toggle: (state, action) => ({ ...state, [action.payload]: !state[action.payload] }),
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
    updateSettings: (state, action) => _.merge({}, state, action.payload),
    upsertDeviceName: makeEntityReducer('deviceNames', deviceNameAdapter.upsertOne),
    updateDeviceName: makeEntityReducer('deviceNames', deviceNameAdapter.updateOne),
    removeDeviceName: makeEntityReducer('deviceNames', deviceNameAdapter.removeOne),
    upsertExecTimeout: makeEntityReducer('execTimeouts', execTimeoutAdapter.upsertOne),
    updateExecTimeout: makeEntityReducer('execTimeouts', execTimeoutAdapter.updateOne),
    removeExecTimeout: makeEntityReducer('execTimeouts', execTimeoutAdapter.removeOne),
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
      .addCase(log.actions.append, (state, action) => {
        const { level } = action.payload;
        state.error = state.error || level === Level.ERROR || level === Level.CRITICAL;
      })
      .addCase(peripherals.actions.updatePeripherals, (state, action) => {
        if (!action.payload.disconnect) {
          state.updates.push(action.payload.timestamp);
        }
      });
  },
});

export default slice;
export const updateRate = () => slice.actions.updateRate(Date.now());
