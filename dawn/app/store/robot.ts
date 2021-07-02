import { createSlice } from '@reduxjs/toolkit';
import { makeUpdateReducer } from './util';

export enum Mode {
  AUTO = 'auto',
  TELEOP = 'teleop',
  IDLE = 'idle',
};

export enum Alliance {
  BLUE = 'blue',
  GOLD = 'gold',
};

export default createSlice({
  name: 'robot',
  initialState: {
    mode: Mode.IDLE,
    alliance: null,
    updateRate: 0,
    host: 'localhost',
    updateInterval: 0.1,
    error: false,
  },
  reducers: {
    setUpdateRate: makeUpdateReducer('updateRate'),
    setError: state => ({ ...state, error: true }),
    clearError: state => ({ ...state, error: false }),
  },
});
