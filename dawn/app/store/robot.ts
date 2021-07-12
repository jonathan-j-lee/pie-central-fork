import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';
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

const RATE_DECAY = 0.5;
const HEALTHY_THRESHOLD = 0.9;
const DISCONNECT_TIMEOUT = 8;
const MAX_TIMESTAMPS = 50;

export const exec = createAsyncThunk(
  'robot/exec',
  async (arg, thunkAPI) => {
    const state = thunkAPI.getState();
    const config = { host: state.robot.host, ...state.robot.credentials };
    await window.ipc.invoke('exec', config, { command: state.robot.restartCommand });
  },
);

const slice = createSlice({
  name: 'robot',
  initialState: {
    status: ConnectionStatus.DISCONNECTED,
    mode: Mode.IDLE,
    alliance: null,
    updates: [],
    updateRate: 0,
    relUpdateRate: 0,
    host: 'localhost',
    remotePath: 'studentcode.py',
    restartCommand: 'systemctl restart runtime.service',
    credentials: {
      username: '',
      password: '',
      privateKey: '',
    },
    updateInterval: 0.1,
    error: false,
  },
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
    updateSettings: (state, action) => _.merge({}, state, action.payload),
  },
  extraReducers: (builder) => {
    builder
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
